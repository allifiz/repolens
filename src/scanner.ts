import path from 'node:path';
import fs from 'node:fs/promises';
import fg from 'fast-glob';
import ts from 'typescript';
import type {
  DatabaseUsage,
  Endpoint,
  EndpointTraceStep,
  ExternalCall,
  GraphEdge,
  GraphNode,
  NodeKind,
  RequestBinding,
  ScanResult,
} from './types.js';

const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All']);

const NON_TABLE_RELATIONS = new Set([
  'lateral',
  'filter',
  'values',
  'unnest',
  'generate_series',
  'json_array_elements',
  'json_array_elements_text',
  'json_each',
  'json_each_text',
  'json_object_keys',
  'jsonb_array_elements',
  'jsonb_array_elements_text',
  'jsonb_each',
  'jsonb_each_text',
  'jsonb_object_keys',
  'json_to_record',
  'json_to_recordset',
  'jsonb_to_record',
  'jsonb_to_recordset',
]);

interface ParsedMethod {
  className: string;
  classKind: NodeKind;
  classNodeId: string;
  methodName: string;
  nodeId: string;
  file: string;
  line: number;
  body?: ts.Block;
  source: ts.SourceFile;
  injections: Map<string, string>;
}

interface EndpointSeed {
  endpoint: Endpoint;
  methodNodeId: string;
}

function normalizePath(value: string): string {
  const cleaned = value.replace(/\\/g, '/').replace(/^\.\//, '');
  return cleaned || '.';
}

function decoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr)) {
    if (ts.isIdentifier(expr.expression)) return expr.expression.text;
    if (ts.isPropertyAccessExpression(expr.expression)) return expr.expression.name.text;
  }
  if (ts.isIdentifier(expr)) return expr.text;
  return undefined;
}

function decoratorStringArg(decorator: ts.Decorator): string {
  const expr = decorator.expression;
  if (!ts.isCallExpression(expr) || expr.arguments.length === 0) return '';
  const arg = expr.arguments[0];
  return ts.isStringLiteralLike(arg) ? arg.text : '';
}

function decoratorArgs(decorator: ts.Decorator, source: ts.SourceFile): string[] {
  const expr = decorator.expression;
  if (!ts.isCallExpression(expr)) return [];
  return expr.arguments.map((arg) => arg.getText(source));
}

function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function kindFromDecorators(decorators: readonly ts.Decorator[]): NodeKind {
  const names = new Set(decorators.map(decoratorName));
  if (names.has('Controller')) return 'controller';
  if (names.has('Module')) return 'module';
  if (names.has('Injectable')) return 'service';
  return 'class';
}

function joinRoute(base: string, child: string): string {
  const parts = [base, child].flatMap((part) => part.split('/')).filter(Boolean);
  return '/' + parts.join('/');
}

function resolveImport(
  fromFile: string,
  specifier: string,
  knownFiles: Set<string>,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;

  const base = normalizePath(
    path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier)),
  );

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];

  return candidates.find((candidate) => knownFiles.has(candidate));
}

function methodNameOf(member: ts.MethodDeclaration, source: ts.SourceFile): string {
  if (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name)) {
    return member.name.text;
  }
  return member.name.getText(source);
}

function constructorInjections(statement: ts.ClassDeclaration): Map<string, string> {
  const result = new Map<string, string>();

  for (const member of statement.members) {
    if (!ts.isConstructorDeclaration(member)) continue;

    for (const parameter of member.parameters) {
      if (!ts.isIdentifier(parameter.name)) continue;

      const typeName =
        parameter.type &&
        ts.isTypeReferenceNode(parameter.type) &&
        ts.isIdentifier(parameter.type.typeName)
          ? parameter.type.typeName.text
          : undefined;

      if (typeName) result.set(parameter.name.text, typeName);
    }
  }

  return result;
}

function visitCalls(node: ts.Node, visitor: (call: ts.CallExpression) => void): void {
  if (ts.isCallExpression(node)) visitor(node);
  node.forEachChild((child) => visitCalls(child, visitor));
}

function extractInjectedThisCall(
  call: ts.CallExpression,
): { property: string; method: string } | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;

  const outer = call.expression;
  if (!ts.isPropertyAccessExpression(outer.expression)) return undefined;

  const owner = outer.expression;
  if (owner.expression.kind !== ts.SyntaxKind.ThisKeyword) return undefined;

  return {
    property: owner.name.text,
    method: outer.name.text,
  };
}

function extractLocalThisCall(call: ts.CallExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;

  const expression = call.expression;
  if (expression.expression.kind !== ts.SyntaxKind.ThisKeyword) return undefined;

  return expression.name.text;
}

function extractPrismaUsage(
  call: ts.CallExpression,
  method: ParsedMethod,
): DatabaseUsage | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;

  const expressionText = call.expression.getText(method.source);
  const line = method.source.getLineAndCharacterOfPosition(call.getStart()).line + 1;

  const modelMatch = expressionText.match(
    /^this\.(?:prisma|prismaService)\.([A-Za-z0-9_]+)\.(findMany|findUnique|findFirst|create|createMany|update|updateMany|delete|deleteMany|upsert|count|aggregate|groupBy)$/,
  );

  if (!modelMatch) return undefined;

  return {
    kind: 'prisma',
    target: modelMatch[1],
    file: method.file,
    line,
  };
}

function extractCteNames(sql: string): Set<string> {
  const names = new Set<string>();
  const regex =
    /(?:\bWITH\b(?:\s+RECURSIVE)?|,)\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*(?:\([^)]*\)\s*)?AS\s*(?:NOT\s+MATERIALIZED\s+|MATERIALIZED\s+)?\(/gi;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(sql))) {
    const name = (match[1] ?? match[2])?.toLowerCase();
    if (name) names.add(name);
  }

  return names;
}

function normalizeRelationName(raw: string): string {
  return raw.replace(/["'`]/g, '');
}

function isProbablyTableReference(
  sql: string,
  relationStart: number,
  rawTarget: string,
  cteNames: Set<string>,
): boolean {
  const target = normalizeRelationName(rawTarget);
  const simpleName = target.split('.').pop()?.toLowerCase() ?? target.toLowerCase();

  if (!simpleName) return false;
  if (cteNames.has(simpleName)) return false;
  if (NON_TABLE_RELATIONS.has(simpleName)) return false;

  const after = sql.slice(relationStart + rawTarget.length).trimStart();
  return !after.startsWith('(');
}

function extractRawSqlTables(method: ParsedMethod): DatabaseUsage[] {
  if (!method.body) return [];

  const text = method.body.getText(method.source);

  if (!/\$(?:queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)/.test(text)) {
    return [];
  }

  const cteNames = extractCteNames(text);
  const tables = new Set<string>();
  const regex =
    /\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:ONLY\s+)?((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*))?)/gi;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(text))) {
    const rawTarget = match[1];
    const rawOffset = match.index + match[0].lastIndexOf(rawTarget);

    if (!isProbablyTableReference(text, rawOffset, rawTarget, cteNames)) continue;

    tables.add(normalizeRelationName(rawTarget).replace(/\s+/g, ''));
  }

  return [...tables].map((target) => ({
    kind: 'raw_sql' as const,
    target,
    file: method.file,
    line: method.line,
  }));
}

function requestSource(name: string | undefined): RequestBinding['source'] {
  switch (name) {
    case 'Body': return 'body';
    case 'Query': return 'query';
    case 'Param': return 'param';
    case 'Headers':
    case 'Header': return 'headers';
    case 'Req':
    case 'Request': return 'request';
    case 'Res':
    case 'Response': return 'response';
    default: return 'unknown';
  }
}

function extractRequestBindings(
  member: ts.MethodDeclaration,
  source: ts.SourceFile,
): RequestBinding[] {
  return member.parameters.flatMap((parameter) => {
    const decorators = getDecorators(parameter);

    return decorators.map((decorator) => {
      const name = decoratorName(decorator);
      const args = decoratorArgs(decorator, source);
      const type = parameter.type?.getText(source);

      return {
        source: requestSource(name),
        name: args[0]?.replace(/^['"]|['"]$/g, ''),
        type,
      };
    }).filter((binding) => binding.source !== 'unknown');
  });
}

function extractNamedDecoratorValues(
  decorators: readonly ts.Decorator[],
  wanted: string,
  source: ts.SourceFile,
): string[] {
  const values: string[] = [];

  for (const decorator of decorators) {
    if (decoratorName(decorator) !== wanted) continue;

    for (const arg of decoratorArgs(decorator, source)) {
      values.push(arg);
    }
  }

  return values;
}

function unwrapResponseType(typeText: string | undefined): string | undefined {
  if (!typeText) return undefined;

  const promise = typeText.match(/^Promise\s*<(.+)>$/s);
  return (promise?.[1] ?? typeText).trim();
}

function externalTargetFromArgs(call: ts.CallExpression, source: ts.SourceFile): string {
  const args = call.arguments.map((arg) => arg.getText(source));

  for (const arg of args) {
    if (ts.isStringLiteralLike(call.arguments[args.indexOf(arg)])) {
      return arg.replace(/^['"]|['"]$/g, '');
    }
  }

  return args.slice(0, 3).join(' ');
}

function extractExternalCall(
  call: ts.CallExpression,
  method: ParsedMethod,
): ExternalCall | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;

  const expressionText = call.expression.getText(method.source);
  const line = method.source.getLineAndCharacterOfPosition(call.getStart()).line + 1;

  let client = '';
  let httpMethod = '';

  const thisClient = expressionText.match(
    /^this\.(httpService|axios|axiosService)\.(get|post|put|patch|delete|head|request|fetch)$/i,
  );

  if (thisClient) {
    client = thisClient[1];
    httpMethod = thisClient[2].toUpperCase();
  }

  const axiosCall = expressionText.match(
    /^axios\.(get|post|put|patch|delete|head|request)$/i,
  );

  if (!client && axiosCall) {
    client = 'axios';
    httpMethod = axiosCall[1].toUpperCase();
  }

  if (!client) return undefined;

  const target = externalTargetFromArgs(call, method.source);

  return {
    client,
    method: httpMethod,
    target: target || 'dynamic',
    file: method.file,
    line,
  };
}

function uniqueDatabase(items: DatabaseUsage[]): DatabaseUsage[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.kind}:${item.target}:${item.file}:${item.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueExternal(items: ExternalCall[]): ExternalCall[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.client}:${item.method}:${item.target}:${item.file}:${item.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function uniqueEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();

  return edges.filter((edge) => {
    const key = `${edge.type}:${edge.source}->${edge.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function scanProject(rootDir: string): Promise<ScanResult> {
  const absoluteRoot = path.resolve(rootDir);

  const files = await fg(['**/*.ts', '**/*.tsx'], {
    cwd: absoluteRoot,
    ignore: [
      '**/*.d.ts',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.repolens/**',
      '**/coverage/**',
    ],
    onlyFiles: true,
    unique: true,
  });

  const normalizedFiles = files.map(normalizePath);
  const knownFiles = new Set(normalizedFiles);
  const nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];
  const endpoints: Endpoint[] = [];
  const endpointSeeds: EndpointSeed[] = [];
  const parsedMethods: ParsedMethod[] = [];
  const symbolToNode = new Map<string, string>();

  function ensureMetadataNode(
    kind: 'dto' | 'guard' | 'interceptor' | 'external',
    label: string,
    file: string,
    line: number,
  ): string {
    const id = `${kind}:${label}`;

    if (!nodes.some((node) => node.id === id)) {
      nodes.push({ id, label, kind, file, line });
    }

    return id;
  }

  for (const file of normalizedFiles) {
    const sourceText = await fs.readFile(path.join(absoluteRoot, file), 'utf8');
    const source = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const fileNodeId = `file:${file}`;
    nodes.push({ id: fileNodeId, label: path.posix.basename(file), kind: 'file', file });

    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const targetFile = resolveImport(file, statement.moduleSpecifier.text, knownFiles);

        if (targetFile) {
          edges.push({ source: fileNodeId, target: `file:${targetFile}`, type: 'imports' });
        }
      }

      if (!ts.isClassDeclaration(statement) || !statement.name) continue;

      const className = statement.name.text;
      const decorators = getDecorators(statement);
      const kind = kindFromDecorators(decorators);
      const line = source.getLineAndCharacterOfPosition(statement.getStart()).line + 1;
      const classNodeId = `symbol:${file}:${className}`;
      const injections = constructorInjections(statement);
      const classGuards = extractNamedDecoratorValues(decorators, 'UseGuards', source);
      const classInterceptors = extractNamedDecoratorValues(decorators, 'UseInterceptors', source);

      nodes.push({ id: classNodeId, label: className, kind, file, line });
      symbolToNode.set(className, classNodeId);
      edges.push({ source: fileNodeId, target: classNodeId, type: 'declares' });

      const controllerDecorator = decorators.find(
        (decorator) => decoratorName(decorator) === 'Controller',
      );
      const controllerPath = controllerDecorator ? decoratorStringArg(controllerDecorator) : '';

      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member) || !member.name) continue;

        const methodName = methodNameOf(member, source);
        const methodLine = source.getLineAndCharacterOfPosition(member.getStart()).line + 1;
        const methodNodeId = `method:${file}:${className}.${methodName}`;

        nodes.push({
          id: methodNodeId,
          label: `${className}.${methodName}`,
          kind: 'method',
          file,
          line: methodLine,
        });

        edges.push({ source: classNodeId, target: methodNodeId, type: 'declares' });

        parsedMethods.push({
          className,
          classKind: kind,
          classNodeId,
          methodName,
          nodeId: methodNodeId,
          file,
          line: methodLine,
          body: member.body,
          source,
          injections,
        });

        if (!controllerDecorator) continue;

        const methodDecorators = getDecorators(member);
        const httpDecorator = methodDecorators.find((decorator) => {
          const name = decoratorName(decorator);
          return name ? HTTP_DECORATORS.has(name) : false;
        });

        if (!httpDecorator) continue;

        const httpMethod = decoratorName(httpDecorator) ?? 'GET';
        const routePath = decoratorStringArg(httpDecorator);
        const fullPath = joinRoute(controllerPath, routePath);
        const endpointNodeId =
          `endpoint:${httpMethod.toUpperCase()}:${fullPath}:${className}.${methodName}`;
        const request = extractRequestBindings(member, source);
        const guards = uniqueStrings([
          ...classGuards,
          ...extractNamedDecoratorValues(methodDecorators, 'UseGuards', source),
        ]);
        const interceptors = uniqueStrings([
          ...classInterceptors,
          ...extractNamedDecoratorValues(methodDecorators, 'UseInterceptors', source),
        ]);
        const responseType = unwrapResponseType(member.type?.getText(source));

        nodes.push({
          id: endpointNodeId,
          label: `${httpMethod.toUpperCase()} ${fullPath}`,
          kind: 'endpoint',
          file,
          line: methodLine,
          metadata: {
            method: httpMethod.toUpperCase(),
            path: fullPath,
          },
        });

        edges.push({ source: endpointNodeId, target: methodNodeId, type: 'handled_by' });

        for (const binding of request) {
          if (!binding.type) continue;
          const dtoId = ensureMetadataNode('dto', binding.type, file, methodLine);
          edges.push({ source: endpointNodeId, target: dtoId, type: 'uses_dto' });
        }

        for (const guard of guards) {
          const guardId = ensureMetadataNode('guard', guard, file, methodLine);
          edges.push({ source: endpointNodeId, target: guardId, type: 'guarded_by' });
        }

        for (const interceptor of interceptors) {
          const interceptorId = ensureMetadataNode('interceptor', interceptor, file, methodLine);
          edges.push({ source: endpointNodeId, target: interceptorId, type: 'intercepted_by' });
        }

        endpointSeeds.push({
          methodNodeId,
          endpoint: {
            id: `${classNodeId}:${methodName}`,
            nodeId: endpointNodeId,
            method: httpMethod.toUpperCase(),
            path: fullPath,
            controller: className,
            handler: methodName,
            file,
            line: methodLine,
            request,
            guards,
            interceptors,
            responseType,
            callChain: [],
            database: [],
            externalCalls: [],
          },
        });
      }
    }
  }

  const existingInjectEdges = new Set<string>();

  for (const method of parsedMethods) {
    for (const [, typeName] of method.injections) {
      const target = symbolToNode.get(typeName);
      if (!target) continue;

      const key = `${method.classNodeId}->${target}`;
      if (existingInjectEdges.has(key)) continue;

      edges.push({ source: method.classNodeId, target, type: 'injects' });
      existingInjectEdges.add(key);
    }
  }

  const methodByClassAndName = new Map<string, ParsedMethod>();

  for (const method of parsedMethods) {
    methodByClassAndName.set(`${method.className}.${method.methodName}`, method);
  }

  const databaseByMethod = new Map<string, DatabaseUsage[]>();
  const externalByMethod = new Map<string, ExternalCall[]>();

  for (const method of parsedMethods) {
    const database: DatabaseUsage[] = [];
    const external: ExternalCall[] = [];

    if (method.body) {
      visitCalls(method.body, (call) => {
        const injectedCall = extractInjectedThisCall(call);

        if (injectedCall) {
          const injectedType = method.injections.get(injectedCall.property);

          if (injectedType) {
            const targetMethod = methodByClassAndName.get(
              `${injectedType}.${injectedCall.method}`,
            );

            if (targetMethod) {
              edges.push({ source: method.nodeId, target: targetMethod.nodeId, type: 'calls' });
            }
          }
        }

        const localMethodName = extractLocalThisCall(call);

        if (localMethodName) {
          const targetMethod = methodByClassAndName.get(
            `${method.className}.${localMethodName}`,
          );

          if (targetMethod && targetMethod.nodeId !== method.nodeId) {
            edges.push({ source: method.nodeId, target: targetMethod.nodeId, type: 'calls' });
          }
        }

        const prisma = extractPrismaUsage(call, method);
        if (prisma) database.push(prisma);

        const externalCall = extractExternalCall(call, method);
        if (externalCall) external.push(externalCall);
      });
    }

    const rawSqlTables = extractRawSqlTables(method);
    if (rawSqlTables.length > 0) database.push(...rawSqlTables);

    const dedupedDatabase = uniqueDatabase(database);
    const dedupedExternal = uniqueExternal(external);

    databaseByMethod.set(method.nodeId, dedupedDatabase);
    externalByMethod.set(method.nodeId, dedupedExternal);

    for (const usage of dedupedDatabase) {
      const databaseNodeId = `database:${usage.kind}:${usage.target}`;

      if (!nodes.some((node) => node.id === databaseNodeId)) {
        nodes.push({
          id: databaseNodeId,
          label: usage.target,
          kind: 'database',
          file: usage.file,
          line: usage.line,
          metadata: { databaseKind: usage.kind },
        });
      }

      edges.push({ source: method.nodeId, target: databaseNodeId, type: 'queries' });
    }

    for (const usage of dedupedExternal) {
      const externalNodeId = ensureMetadataNode(
        'external',
        `${usage.method} ${usage.target}`,
        usage.file,
        usage.line,
      );

      edges.push({
        source: method.nodeId,
        target: externalNodeId,
        type: 'calls_external',
      });
    }
  }

  edges = uniqueEdges(edges);

  const outgoingCalls = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.type !== 'calls') continue;
    const list = outgoingCalls.get(edge.source) ?? [];
    list.push(edge.target);
    outgoingCalls.set(edge.source, list);
  }

  const methodById = new Map(parsedMethods.map((method) => [method.nodeId, method]));

  for (const seed of endpointSeeds) {
    const visited = new Set<string>();
    const queue = [seed.methodNodeId];
    const callChain: EndpointTraceStep[] = [];
    const database: DatabaseUsage[] = [];
    const externalCalls: ExternalCall[] = [];

    while (queue.length > 0) {
      const methodId = queue.shift()!;
      if (visited.has(methodId)) continue;

      visited.add(methodId);
      const method = methodById.get(methodId);

      if (method && methodId !== seed.methodNodeId) {
        callChain.push({
          className: method.className,
          method: method.methodName,
          file: method.file,
          line: method.line,
        });
      }

      database.push(...(databaseByMethod.get(methodId) ?? []));
      externalCalls.push(...(externalByMethod.get(methodId) ?? []));

      for (const target of outgoingCalls.get(methodId) ?? []) {
        if (!visited.has(target)) queue.push(target);
      }
    }

    seed.endpoint.callChain = callChain;
    seed.endpoint.database = uniqueDatabase(database);
    seed.endpoint.externalCalls = uniqueExternal(externalCalls);
    endpoints.push(seed.endpoint);
  }

  return {
    project: path.basename(absoluteRoot),
    rootDir: absoluteRoot,
    generatedAt: new Date().toISOString(),
    filesScanned: normalizedFiles.length,
    nodes,
    edges,
    endpoints,
  };
}

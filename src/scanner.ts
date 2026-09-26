import path from 'node:path';
import fs from 'node:fs/promises';
import fg from 'fast-glob';
import ts from 'typescript';
import type { Endpoint, GraphEdge, GraphNode, NodeKind, ScanResult } from './types.js';

const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All']);

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
  const parts = [base, child]
    .flatMap((part) => part.split('/'))
    .filter(Boolean);
  return '/' + parts.join('/');
}

function resolveImport(fromFile: string, specifier: string, knownFiles: Set<string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier)));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  return candidates.find((candidate) => knownFiles.has(candidate));
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
  const edges: GraphEdge[] = [];
  const endpoints: Endpoint[] = [];
  const symbolToNode = new Map<string, string>();

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

      nodes.push({
        id: classNodeId,
        label: className,
        kind,
        file,
        line,
      });
      symbolToNode.set(className, classNodeId);
      edges.push({ source: fileNodeId, target: classNodeId, type: 'declares' });

      const controllerDecorator = decorators.find((decorator) => decoratorName(decorator) === 'Controller');
      const controllerPath = controllerDecorator ? decoratorStringArg(controllerDecorator) : '';

      for (const member of statement.members) {
        if (ts.isConstructorDeclaration(member)) {
          for (const parameter of member.parameters) {
            const typeName = parameter.type && ts.isTypeReferenceNode(parameter.type)
              && ts.isIdentifier(parameter.type.typeName)
              ? parameter.type.typeName.text
              : undefined;

            if (typeName) {
              const target = symbolToNode.get(typeName);
              if (target) edges.push({ source: classNodeId, target, type: 'injects' });
            }
          }
        }

        if (!controllerDecorator || !ts.isMethodDeclaration(member) || !member.name) continue;

        const methodDecorators = getDecorators(member);
        const httpDecorator = methodDecorators.find((decorator) => {
          const name = decoratorName(decorator);
          return name ? HTTP_DECORATORS.has(name) : false;
        });

        if (!httpDecorator) continue;
        const methodName = decoratorName(httpDecorator) ?? 'GET';
        const routePath = decoratorStringArg(httpDecorator);
        const handler = ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name)
          ? member.name.text
          : member.name.getText(source);
        const methodLine = source.getLineAndCharacterOfPosition(member.getStart()).line + 1;

        endpoints.push({
          id: `${classNodeId}:${handler}`,
          method: methodName.toUpperCase(),
          path: joinRoute(controllerPath, routePath),
          controller: className,
          handler,
          file,
          line: methodLine,
        });
      }
    }
  }

  // Second pass: resolve constructor injections that referenced classes declared later.
  const existingInjectEdges = new Set(edges.filter((edge) => edge.type === 'injects').map((edge) => `${edge.source}->${edge.target}`));
  for (const file of normalizedFiles) {
    const sourceText = await fs.readFile(path.join(absoluteRoot, file), 'utf8');
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name) continue;
      const sourceNode = `symbol:${file}:${statement.name.text}`;

      for (const member of statement.members) {
        if (!ts.isConstructorDeclaration(member)) continue;
        for (const parameter of member.parameters) {
          const typeName = parameter.type && ts.isTypeReferenceNode(parameter.type)
            && ts.isIdentifier(parameter.type.typeName)
            ? parameter.type.typeName.text
            : undefined;
          if (!typeName) continue;

          const target = symbolToNode.get(typeName);
          if (!target) continue;
          const key = `${sourceNode}->${target}`;
          if (!existingInjectEdges.has(key)) {
            edges.push({ source: sourceNode, target, type: 'injects' });
            existingInjectEdges.add(key);
          }
        }
      }
    }
  }

  return {
    project: path.basename(absoluteRoot),
    generatedAt: new Date().toISOString(),
    filesScanned: normalizedFiles.length,
    nodes,
    edges,
    endpoints,
  };
}

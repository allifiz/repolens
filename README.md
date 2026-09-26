# RepoLens

**Understand a TypeScript/NestJS codebase in seconds.**

RepoLens scans a repository locally and turns source code into a browsable graph of endpoints, methods, request metadata, dependency injection relationships, database usage, and external calls.

No code is uploaded anywhere.

## Current capabilities

- TypeScript / TSX project scanning
- NestJS controller, service, module, and class detection
- HTTP endpoint discovery
- Endpoint nodes and controller-method nodes
- Constructor dependency injection graph
- Controller/service method call tracing
- Same-class `this.method()` tracing
- Request binding detection from `@Body`, `@Query`, `@Param`, `@Headers`, `@Req`, and `@Res`
- DTO/type detection from controller parameters without primitive-type nodes
- `@UseGuards` detection at controller and method level
- global `APP_GUARD` provider detection
- `@UseInterceptors` detection at controller and method level
- global `APP_INTERCEPTOR` provider detection
- Declared response type detection
- Swagger response metadata detection from `@ApiResponse`, `@ApiOkResponse`, and related decorators
- Basic external HTTP call detection for `HttpService` and Axios patterns
- simple local-variable, string concatenation, and template-literal URL resolution
- Basic Prisma model usage detection
- Raw SQL table detection with PostgreSQL filtering
- CTE filtering, including `WITH RECURSIVE`
- Execution-flow viewer with enriched endpoint details
- Machine-readable `graph.json`

## Install

```bash
git clone https://github.com/allifiz/repolens.git
cd repolens
npm install
npm run build
```

Optional:

```bash
npm link
```

## Scan a service

```bash
repolens scan /home/ganesha/it/repo/db-materi
```

Generated output stays inside RepoLens:

```text
repolens/
└── service/
    └── db-materi/
        ├── graph.json
        └── index.html
```

The scanned repository is not modified.

## Endpoint detail

RepoLens can now enrich an endpoint with request, security, execution, database, and external-call metadata.

Example:

```text
GET /api/v1/users/:id

Request
- param:id → number
- query → GetUserQueryDto

Guards
- AuthGuard

Interceptors
- ResponseInterceptor

Response
- GetUserResponse

Calls
- UserController.findOne
- UserService.findOne

Database
- user

External
- GET https://example.internal/api/...
```

Detection is static and conservative. Dynamic decorators, runtime-generated routes, indirect HTTP clients, and heavily computed URLs may not resolve completely.

## Raw SQL relation detection

RepoLens attempts to keep actual database relations while ignoring common PostgreSQL constructs that only look table-like to a regex.

It supports common CTE patterns, `WITH RECURSIVE`, schema-qualified tables, and filters table functions such as `jsonb_array_elements(...)`.

Current SQL analysis remains heuristic and is not a full PostgreSQL parser.

## Roadmap

### v0.1
- [x] TypeScript scanner
- [x] NestJS controller/service detection
- [x] import graph
- [x] constructor injection graph
- [x] endpoint discovery
- [x] standalone viewer

### v0.2
- [x] endpoint nodes
- [x] controller/service method nodes
- [x] endpoint → service tracing
- [x] same-class method tracing
- [x] Prisma usage detection
- [x] raw SQL table detection
- [x] CTE / PostgreSQL table-function filtering
- [x] execution-flow viewer
- [x] generated output under `service/<project>`

### v0.3
- [x] primitive request types kept out of DTO graph
- [x] global guard/interceptor provider detection
- [x] Swagger response type detection
- [x] simple external URL resolution
- [x] DTO/request binding detection
- [x] guard detection
- [x] interceptor detection
- [x] response type detection
- [x] basic external HTTP call detection
- [x] richer endpoint detail panel
- [ ] tsconfig path alias resolution
- [ ] impact analysis
- [ ] export endpoint context as Markdown
- [ ] dedicated `repolens trace` command
- [ ] dedicated `repolens context` command

### Later
- [ ] MCP server
- [ ] VS Code extension
- [ ] AI-agent context packs
- [ ] incremental indexing
- [ ] Go / Java / Python support

## Philosophy

RepoLens is local-first. Static analysis should provide useful information without forcing a repository through an LLM.

AI can be added where it actually improves understanding rather than being sprinkled over every button because apparently software now needs glitter.

## License

MIT

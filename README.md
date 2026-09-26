# RepoLens

**Understand a TypeScript/NestJS codebase in seconds.**

RepoLens scans a repository locally and turns source code into a browsable graph of endpoints, methods, dependency injection relationships, and database usage.

No code is uploaded anywhere.

## Current capabilities

- TypeScript / TSX project scanning
- NestJS controller, service, module, and class detection
- HTTP endpoint discovery
- Endpoint nodes and controller-method nodes
- Constructor dependency injection graph
- Controller/service method call tracing
- Same-class `this.method()` tracing
- Basic Prisma model usage detection
- Raw SQL table detection with stronger PostgreSQL filtering
- CTE filtering, including `WITH RECURSIVE`
- PostgreSQL table-function filtering such as `jsonb_array_elements(...)`
- Relative import graph
- Execution-flow viewer with edge labels
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

## Endpoint tracing

RepoLens can model flows such as:

```text
GET /users/:id
    ↓ handled_by
UserController.findOne()
    ↓ calls
UserService.findOne()
    ↓ calls
UserService.loadProfile()
    ↓ queries
user
```

It recognizes both injected calls:

```ts
this.userService.findOne()
```

and same-class calls:

```ts
this.loadProfile()
```

## Raw SQL relation detection

RepoLens attempts to keep actual database relations while ignoring common PostgreSQL constructs that only look table-like to a regex.

For example:

```sql
WITH RECURSIVE induk_tree AS (
  SELECT *
  FROM t_bab
),
filtered AS (
  SELECT *
  FROM induk_tree
)
SELECT *
FROM filtered
JOIN LATERAL jsonb_array_elements(data) x ON true
JOIN t_soal ts ON true;
```

RepoLens should keep:

```text
t_bab
t_soal
```

and ignore:

```text
induk_tree
filtered
LATERAL
jsonb_array_elements
```

Current SQL analysis remains static and heuristic. It is not a full PostgreSQL parser.

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
- [x] CTE filtering
- [x] PostgreSQL table-function filtering
- [x] endpoint-first viewer
- [x] execution-flow layout
- [x] edge labels
- [x] source file + line in trace detail
- [x] generated output under `service/<project>`
- [ ] DTO detection
- [ ] guards/interceptors detection
- [ ] tsconfig path alias resolution

### v0.3
- [ ] external HTTP call detection
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

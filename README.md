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
- Basic Prisma model usage detection
- Basic raw SQL table detection
- Relative import graph
- Standalone local HTML viewer
- Machine-readable `graph.json`

## Install

```bash
git clone https://github.com/allifiz/repolens.git
cd repolens
npm install
npm run build
```

Optional, make the CLI available from any terminal:

```bash
npm link
```

## Scan a service

From the RepoLens folder:

```bash
node dist/index.js scan /home/ganesha/it/repo/db-materi
```

Or after `npm link`:

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

The target repository is not modified.

You can still override the destination:

```bash
repolens scan /path/to/project --output /custom/output
```

## Endpoint tracing

Given:

```ts
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(':id')
  findOne() {
    return this.userService.findOne();
  }
}
```

and:

```ts
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  findOne() {
    return this.prisma.user.findUnique(...);
  }
}
```

RepoLens models:

```text
GET /users/:id
    ↓ handled_by
UserController.findOne()
    ↓ calls
UserService.findOne()
    ↓ queries
user
```

## v0.2 notes

Tracing is static and intentionally conservative.

Currently it works best for direct calls such as:

```ts
this.userService.findOne()
this.prisma.user.findUnique()
this.prisma.$queryRaw`SELECT ... FROM users`
```

Dynamic dispatch, factory-generated services, deeply aliased references, and complex SQL construction may not yet be resolved.

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
- [x] basic endpoint → service tracing
- [x] basic Prisma usage detection
- [x] basic raw SQL table detection
- [x] endpoint-first viewer
- [x] generated output under `service/<project>`
- [ ] DTO detection
- [ ] guards/interceptors detection
- [ ] tsconfig path alias resolution
- [ ] richer graph layout

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

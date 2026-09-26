# RepoLens

**Understand any TypeScript/NestJS codebase in seconds.**

RepoLens scans a repository locally and turns source code into a browsable graph of files, classes, dependency injection relationships, and NestJS endpoints.

No code is uploaded anywhere.

## Current MVP

- TypeScript / TSX project scanning
- NestJS controller detection
- NestJS service/module/class detection
- Constructor dependency injection graph
- Relative import graph
- HTTP endpoint discovery
- Standalone local HTML viewer
- Machine-readable `graph.json`

## Try it

```bash
git clone https://github.com/allifiz/repolens.git
cd repolens
npm install
npm run build
```

Scan another project:

```bash
node dist/index.js scan /path/to/your/nest-project
```

Or while developing RepoLens:

```bash
npm run dev -- scan /path/to/your/project
```

RepoLens creates:

```text
your-project/
└── .repolens/
    ├── graph.json
    └── index.html
```

Open `.repolens/index.html` in a browser.

## Example

Given:

```ts
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(':id')
  findOne() {}
}
```

RepoLens detects:

```text
GET /users/:id

UserController
    ↓ injects
UserService
```

## Vision

RepoLens should eventually answer questions such as:

- What happens when this endpoint is called?
- Which service touches this database table?
- Which files matter for this feature?
- What could break if I change this class?
- What context should I send to a coding agent?

The long-term pipeline:

```text
Codebase
   ↓
Static analysis
   ↓
Code graph
   ├── API graph
   ├── dependency graph
   ├── database graph
   └── external-service graph
          ↓
      AI context
```

## Roadmap

### v0.1
- [x] TypeScript scanner
- [x] NestJS controller/service detection
- [x] import graph
- [x] constructor injection graph
- [x] endpoint discovery
- [x] standalone viewer

### v0.2
- [ ] trace endpoint → service → repository
- [ ] detect DTOs and guards
- [ ] detect Prisma calls
- [ ] route search and filtering
- [ ] richer graph layout

### v0.3
- [ ] database/table graph
- [ ] external HTTP call detection
- [ ] impact analysis
- [ ] export endpoint context as Markdown

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

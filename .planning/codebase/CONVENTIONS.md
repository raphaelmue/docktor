# Coding Conventions

**Analysis Date:** 2026-03-10

## Naming Patterns

**Files:**
- React components: `kebab-case.tsx` (e.g., `stack-list.tsx`, `login-form.tsx`, `data-table.tsx`)
- Hooks: `use-kebab-case.ts` (e.g., `use-stacks.ts`, `use-mobile.ts`)
- API modules: `kebab-case-api.ts` (e.g., `stacks-api.ts`, `settings-api.ts`)
- Server services: `kebab-case-service.ts` (e.g., `stack-service.ts`)
- Server repositories: `kebab-case-repository.ts` (e.g., `stack-repository.ts`)
- Server routes: `kebab-case.ts` (e.g., `stacks.ts`, `auth.ts`)
- Domain modules: `kebab-case.ts` (e.g., `compose-config.ts`, `stack-status-machine.ts`)

**Exported names:**
- React components: `PascalCase` named exports (e.g., `export function StackList(...)`, `export function DataTable(...)`)
- Hooks: `camelCase` named exports prefixed with `use` (e.g., `export function useStacks()`)
- Classes: `PascalCase` (e.g., `StackService`, `StackRepository`, `AppError`)
- Functions: `camelCase` (e.g., `createStack`, `listStacks`, `slugify`)
- Types/Interfaces: `PascalCase` (e.g., `StackWithServices`, `TableColumn`, `DataTableProps`)
- Constants: `SCREAMING_SNAKE_CASE` for domain constants (e.g., `TRANSITIONS`, `ACTION_TARGET`)

**React component props interfaces:**
- Named `[ComponentName]Props` (e.g., `StackListProps`, `DataTableProps`)
- Destructured with `Readonly<Props>` in function signature:
  ```tsx
  export function DataTable<T>({...}: Readonly<DataTableProps<T>>) { ... }
  export function StackList({stacks, loading, pagination}: Readonly<StackListProps>) { ... }
  ```

## Code Style

**Formatting:**
- Tool: Not detected (no `.prettierrc` or `biome.json` found at workspace root)
- Indent: 4 spaces throughout all workspaces
- Semicolons: None (semicolon-free style)
- Quotes: Double quotes for all strings and import paths
- Trailing commas: Present in multi-line object/array literals

**TypeScript:**
- Strict mode enabled (`"strict": true` in root `tsconfig.json`)
- Target: ES2024, module: ESNext
- Server requires `.js` extension on all relative imports (Node ESM with `"type": "module"`)
- Client uses `@/` path alias mapped to `client/src/` (configured in `vite.config.ts` and `vitest.config.ts`)

## Import Organization

**Order (observed pattern):**
1. Node built-ins with `node:` protocol prefix (e.g., `import path from "node:path"`)
2. External framework/library packages (e.g., `fastify`, `react`, `vitest`)
3. Internal workspace packages (e.g., `@docktor/shared`)
4. Path-aliased client modules (e.g., `@/lib/api`, `@/components/ui/button`)
5. Relative imports (e.g., `./fixtures`, `../../../src/lib/errors.js`)

**Path Aliases:**
- `@/` — client-side alias for `client/src/`
- `@docktor/shared` — workspace package for shared Zod schemas and TypeScript types
- Server uses relative imports with `.js` extension (required for Node ESM)

**Mock placement (test files):**
- `vi.mock(...)` hoisted to top of file, before the import of the mocked module
- Explanatory comment placed above the mock block:
  ```ts
  // Mock apiFetch before importing stacks-api
  vi.mock("@/lib/api", () => ({ ... }));
  import { apiFetch } from "@/lib/api";
  ```

## Error Handling

**Server-side error hierarchy (`server/src/lib/errors.ts`):**
```typescript
AppError (base, statusCode = 500)
  NotFoundError  → 404
  ConflictError  → 409
  BadRequestError → 400
```
- All subclasses set `this.name = this.constructor.name` for reliable `instanceof` checks
- Global Fastify error handler in `server/src/app.ts` catches `AppError` and returns `{error: message}` JSON
- Zod validation errors return `{error: "Validation error", details: [...]}` with 400
- Unknown errors: logged via `app.log.error`, returns generic 500

**Service layer error wrapping pattern:**
```typescript
private guardTransition(current: StackStatus, action: ...) {
    try {
        assertTransition(current, action);
    } catch (err) {
        if (err instanceof TransitionError) {
            throw new BadRequestError(err.message);
        }
        throw err;
    }
}
```
Domain errors (`TransitionError`) are converted to HTTP-mapped errors (`BadRequestError`) at the service boundary.

**Client-side error handling (`client/src/lib/api.ts`):**
- `ApiError` class with `status: number` property
- `apiFetch` throws `ApiError` on non-ok responses, extracting `body.error` message
- Hooks catch with `catch (err: any)` and store `err.message` in string error state
- Form components use early-return pattern on error:
  ```typescript
  const { error: signInError } = await signIn.email({...});
  if (signInError) {
      setError(signInError.message ?? "Sign in failed");
      setLoading(false);
      return;
  }
  ```

## Logging

**Framework:** Fastify built-in logger (pino), configured by `NODE_ENV` in `server/src/app.ts`

**Environment behaviour:**
- `development`: pino-pretty transport, human-readable time (`HH:MM:ss Z`), pid/hostname hidden
- `production`: standard pino JSON output
- `test`: logging disabled (`false`)

**Usage:** `app.log.error(error)` for unhandled errors in the global error handler only. No client-side logging library — no structured logging observed on the frontend.

## Comments

**Style:**
- Single-line `//` comments preferred; no JSDoc (`/** */`) observed on any exported functions
- Comments explain non-obvious decisions, not obvious code:
  - `// Prisma is a root devDependency — resolve it by path`
  - `// SPA fallback: serve index.html for all non-API routes`
  - `// Mock apiFetch before importing stacks-api`

## Function Design

**Route handlers (server):** Thin — delegate immediately to the service, no business logic:
```typescript
app.post("/api/stacks", { schema: { body: createStackSchema } }, async (request, reply) => {
    const stack = await stackService.createStack(request.body);
    return reply.status(201).send(stack);
});
```

**Service methods:** Single-responsibility, 10–30 lines each. Accept typed input objects from `@docktor/shared`.

**Repository methods:** Focused CRUD; throw `NotFoundError` instead of returning `null` (`findByIdOrThrow`).

**Parameters:** Constructor injection for server-side classes (`StackService` takes `repo`, `fs`, `docker`). Pure utility functions take plain arguments.

**Return values:** Async functions return `Promise<T>` implicitly. Hooks return a consistent shape: `{ data, loading, error, refetch }`.

## Module Design

**Exports:**
- Named exports throughout — no default exports on classes or utility functions
- Route files are the one exception: `export default stackRoutes` (required by Fastify plugin API)
- `server/src/application/index.ts` exports singleton service instances for use in routes

**Barrel files:**
- `shared/src/index.ts`: `export * from "./validation/index.js"`
- `client/src/components/common/data/table/index.ts`: re-exports table components
- Used selectively — not every directory has one

**Shared validation pattern:**
- Zod schemas live in `shared/src/validation/`
- Same schema consumed on server (Fastify body validator) and client (react-hook-form resolver via `standardSchemaResolver`)
- TypeScript input types inferred: `type LoginInput = z.infer<typeof loginSchema>`

---

*Convention analysis: 2026-03-10*

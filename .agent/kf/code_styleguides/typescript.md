# TypeScript Style Guide

## Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `sync-engine.ts`, `drive-adapter.ts`)
- **Test files**: `kebab-case.test.ts` co-located with source
- **Variables/functions**: `camelCase`
- **Classes/interfaces/types**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE` for true constants, `camelCase` for derived values
- **Type parameters**: Single uppercase letter (`T`, `K`, `V`) or descriptive `PascalCase` (`TRecord`, `TOptions`)

## Code Organization

- One primary export per file
- Group related types alongside their implementation
- Barrel exports through `index.ts` only at package boundary

## Imports

Order:
1. Node/browser built-ins
2. External packages
3. Internal modules (relative paths)

Use `type` imports for type-only imports: `import type { Foo } from './foo'`

## Error Handling

- Throw typed errors extending `Error` with descriptive names
- Never swallow errors silently
- Use `unknown` for catch clause types: `catch (err: unknown)`

## Testing

- Use `vitest` with `describe`/`it` blocks
- Test file naming: `*.test.ts`
- Prefer `expect().toBe()` / `toEqual()` for assertions
- Mock external dependencies (Drive API, IndexedDB) at boundary

## Formatting

- Strict TypeScript (`strict: true` in tsconfig)
- No `any` — use `unknown` and narrow
- Prefer `interface` for object shapes, `type` for unions/intersections
- Use `readonly` for immutable properties
- Prefer `const` over `let`; never use `var`

# CLAUDE.md — drivestash

## Commands

- `npm test` — run tests (vitest)
- `npm run typecheck` — type check (tsc --noEmit)
- `npm run build` — build with tsup (ESM, dts)
- `npm run lint` — lint src/ with eslint

## Project Structure

- `src/` — all source code
- `src/index.ts` — package entry point (re-exports)
- `src/types.ts` — shared type definitions (SyncRecord, SyncEngineConfig, etc.)
- `src/local-store.ts` — IndexedDB local store (raw IndexedDB API)
- `src/drive-adapter.ts` — Google Drive appDataFolder adapter

## Conventions

- TypeScript strict mode, target ES2022
- ESM only (`"type": "module"`)
- Conventional commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`, `ci:`
- Tests colocated as `*.test.ts` next to source files
- Zero runtime dependencies
- Tests use `fake-indexeddb` for IndexedDB simulation in Node

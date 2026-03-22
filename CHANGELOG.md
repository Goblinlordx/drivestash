# Changelog

## [0.3.0] - 2026-03-22

### Added

- `clearRemote()` method on `SyncEngine` — wipes local records AND deletes the remote Drive file. For full data deletion requests.

## [0.2.0] - 2026-03-22

### Added

- `clear()` method on `SyncEngine` — wipes all local records, resets remote file ID, and sets status to idle. Use on user logout or account switch to prevent data leakage between sessions.

## [0.1.0] - 2026-03-22

### Added

- `Codec` interface for pluggable payload encoding/decoding
- `createDeflateCodec()` factory using browser-native `CompressionStream`/`DecompressionStream`
- Optional `codec` field on `SyncEngineConfig` for opt-in compression

## [0.0.2] - 2026-03-22

- Switch npm publish to OIDC trusted publishing
- Remove Dexie dependency — use raw IndexedDB API

## [0.0.1] - 2026-03-22

- Initial release with SyncEngine, LocalStore, DriveAdapter, LWW merge

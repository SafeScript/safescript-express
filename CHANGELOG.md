# Changelog

## [1.1.0] — 2026-10-25

### Changed
- Bumped version to 1.1.0.
- Updated `peerDependency` to `safescript >=1.1.0`.
- No code changes — the `allow` option for host-provided scope identifiers is handled internally by `SafeScript.run()`, which this middleware already calls with the route handler's scope.

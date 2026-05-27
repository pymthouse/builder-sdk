# Changelog

## 0.1.0

- Add `@pymthouse/builder-sdk/config` for Edge/middleware-safe env reads (`isPymthouseConfigured`, `readPymthouseEnv`).
- Add `@pymthouse/builder-sdk/tokens` for signer session TTL, unverified JWT expiry helpers, and `parseSignerSessionExchange`.
- Add `@pymthouse/builder-sdk/device-initiate` for Option B device login validation (Edge-safe).
- Extend Usage API helpers: fiat rollup, `buildMeScopeUsagePayload`, `fetchUsageForExternalUser` on `PmtHouseClient`.
- Add `getAppManifest` on `PmtHouseClient` plus `parseAppManifestResponse` / `computeManifestRevision`.
- Add workflow methods: `mintSignerSessionForExternalUser`, `approveDeviceLogin`.

## 0.0.8

- Builder REST, Usage API, device approval (RFC 8693), signer session exchange, optional RFC 8628 device polling, RFC 9068 JWT access token validation via `oauth4webapi`.

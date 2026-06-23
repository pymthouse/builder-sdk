# Changelog

## 0.4.7-rc.0

- Add self-scoped end-user usage routes (`/usage/me`, `/usage/me/balance`) via `routeEndUserUsageRequest` and `routeIdentityServiceRequest`.
- Add `getMyUsageBalance` and `getMyUsage` on `PmtHouseClient` (Bearer user JWT only; no `externalUserId` param).
- Add `USAGE_READ_SCOPE` (`usage:read`) alongside `sign:job` for usage read authorization.
- New export: `@pymthouse/builder-sdk/usage`.

## 0.1.0

- Add `@pymthouse/builder-sdk/config` for Edge/middleware-safe env reads (`isPymthouseConfigured`, `readPymthouseEnv`).
- Add `@pymthouse/builder-sdk/tokens` for signer session TTL, unverified JWT expiry helpers, and `parseSignerSessionExchange`.
- Add `@pymthouse/builder-sdk/device-initiate` for Option B device login validation (Edge-safe).
- Extend Usage API helpers: fiat rollup, `buildMeScopeUsagePayload`, `fetchUsageForExternalUser` on `PmtHouseClient`.
- Add `getAppManifest` on `PmtHouseClient` plus `parseAppManifestResponse` / `computeManifestRevision`.
- Add workflow methods: `mintSignerSessionForExternalUser`, `approveDeviceLogin`.

## 0.0.8

- Builder REST, Usage API, device approval (RFC 8693), signer session exchange, optional RFC 8628 device polling, RFC 9068 JWT access token validation via `oauth4webapi`.

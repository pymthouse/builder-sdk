# Changelog

## 0.6.1

- Reject email-shaped and `owner:` / `user:`-prefixed values as `externalUserId`;
  export `parseExternalUserId` / `isValidExternalUserId` for callers.
- Scope `fetchUsageForExternalUser` to the target user (`userId=` on all queries);
  prefer end-user `/api/v1/user/usage*` after minting a user JWT, with Builder M2M fallback.
- Fuzzy-match transitional `owner:` / `user:` meter labels when aggregating usage.

## 0.6.0

- API-key → signer exchange uses app-scoped RFC 8693 `POST …/apps/{clientId}/oidc/token`
  (replaces removed `/auth/api-key/signer-session` and `/auth/api-key/token`).
- Add composite API key helpers: `isCompositeApiKey`, `splitCompositeApiKey`,
  `formatCompositeApiKey` for presented `app_<24hex>_<secret>` credentials.
- Remove `@pymthouse/builder-sdk/signer/webhook` — use
  `@pymthouse/clearinghouse-identity-webhook` (or `@livepeer/clearinghouse-identity-webhook`)
  instead.
- Docs: presented keys are underscore composites; identity webhook accepts them as Bearer.

## 0.1.0

- Add `@pymthouse/builder-sdk/config` for Edge/middleware-safe env reads (`isPymthouseConfigured`, `readPymthouseEnv`).
- Add `@pymthouse/builder-sdk/tokens` for signer session TTL, unverified JWT expiry helpers, and `parseSignerSessionExchange`.
- Add `@pymthouse/builder-sdk/device-initiate` for Option B device login validation (Edge-safe).
- Extend Usage API helpers: fiat rollup, `buildMeScopeUsagePayload`, `fetchUsageForExternalUser` on `PmtHouseClient`.
- Add `getAppManifest` on `PmtHouseClient` plus `parseAppManifestResponse` / `computeManifestRevision`.
- Add workflow methods: `mintSignerSessionForExternalUser`, `approveDeviceLogin`.

## 0.0.8

- Builder REST, Usage API, device approval (RFC 8693), signer session exchange, optional RFC 8628 device polling, RFC 9068 JWT access token validation via `oauth4webapi`.

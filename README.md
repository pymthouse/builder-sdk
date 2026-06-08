# @pymthouse/builder-sdk

Source repository: [pymthouse/builder-sdk](https://github.com/pymthouse/builder-sdk). The npm package name is `@pymthouse/builder-sdk`.

TypeScript client for the **PymtHouse Builder API**, **Usage API**, and **OIDC issuer** surfaces.

OAuth/OIDC protocol calls use **[oauth4webapi](https://github.com/panva/oauth4webapi)** (OpenID-certified relying-party implementation). PymtHouse-specific REST paths and helpers live in `PmtHouseClient`.

## Install

```bash
pnpm add @pymthouse/builder-sdk
```

Maintainers: see [docs/RELEASING.md](docs/RELEASING.md) for trusted publishing and re-running failed releases.

## Quick start

```ts
import { PmtHouseClient } from "@pymthouse/builder-sdk";
import {
  createPmtHouseClientFromEnv,
  getPymthouseBaseUrl,
} from "@pymthouse/builder-sdk/env";

const client = createPmtHouseClientFromEnv();
const base = getPymthouseBaseUrl();
const discovery = await client.getDiscovery();
```

Or construct explicitly:

```ts
import { PmtHouseClient } from "@pymthouse/builder-sdk";

const client = new PmtHouseClient({
  issuerUrl: process.env.PYMTHOUSE_ISSUER_URL!,
  publicClientId: process.env.PYMTHOUSE_PUBLIC_CLIENT_ID!,
  m2mClientId: process.env.PYMTHOUSE_M2M_CLIENT_ID!,
  m2mClientSecret: process.env.PYMTHOUSE_M2M_CLIENT_SECRET!,
  allowInsecureHttp: process.env.PYMTHOUSE_ISSUER_URL?.startsWith("http:"),
});
```

## User tokens: short-lived JWT or long-lived signer session

Use `mintUserAccessToken()` when your backend needs the short-lived
Builder-minted user JWT directly:

```ts
const userJwt = await client.mintUserAccessToken({
  externalUserId: "naap-user-123",
  scope: "sign:job",
});
```

Use `mintUserSignerSessionToken()` when you want the user-facing opaque
`pmth_...` signer session. This first mints the short-lived user JWT, then
performs the RFC 8693 token exchange with the confidential M2M client:

```ts
const signerSession = await client.mintUserSignerSessionToken({
  externalUserId: "naap-user-123",
  scope: "sign:job",
});
```

For advanced flows that already have a user JWT, call
`exchangeForSignerSession({ userJwt })` directly.

### Dashboard API keys (long-lived `pmth_*`)

Create a key in the Dashboard **API keys** page, then exchange it for a signer
session without repeating device login:

```ts
const session = await client.exchangeApiKeyForSignerSession({
  apiKey: process.env.PMTH_API_KEY!,
  facadeUrl: process.env.DASHBOARD_ORIGIN!, // e.g. https://dashboard.example.com
  scope: "sign:job",
});
// session.access_token — opaque signer bearer for discovery / gateway
```

See `examples/stream-with-api-key.mjs` for a minimal Node script.

Integrators can use the higher-level workflow helpers:

```ts
const session = await client.mintSignerSessionForExternalUser({
  externalUserId: "naap-user-123",
  email: "user@example.com",
});
// session.accessToken is opaque pmth_…

await client.approveDeviceLogin({
  externalUserId: "naap-user-123",
  userCode: "ABCD-EFGH",
  publicClientId: process.env.PYMTHOUSE_PUBLIC_CLIENT_ID,
});
```

## Usage API: session-scoped `scope=me` BFF helper

```ts
const payload = await client.fetchUsageForExternalUser({
  externalUserId: "naap-user-123",
  startDate,
  endDate,
});
// payload.currentUser includes fiat totals + merged pipelineModels
```

## App manifest

```ts
const { manifest, etag, notModified } = await client.getAppManifest({
  ifNoneMatch: cachedEtag ?? undefined,
});
```

## Subpath exports

| Import | Purpose |
|--------|---------|
| `@pymthouse/builder-sdk` | `PmtHouseClient`, usage helpers, manifest parsers, token helpers |
| `@pymthouse/builder-sdk/config` | `isPymthouseConfigured`, `readPymthouseEnv` (Edge/middleware-safe) |
| `@pymthouse/builder-sdk/tokens` | Signer session TTL, JWT shape helpers, `parseSignerSessionExchange` |
| `@pymthouse/builder-sdk/format` | Wei formatting for Usage API |
| `@pymthouse/builder-sdk/env` | `createPmtHouseClientFromEnv`, `getPymthouseBaseUrl` (server-only) |
| `@pymthouse/builder-sdk/device` | RFC 8628 `pollDeviceToken` |
| `@pymthouse/builder-sdk/device-initiate` | Option B device login validation (Edge-safe) |
| `@pymthouse/builder-sdk/verify` | RFC 9068 `verifyJwt` |

## Usage API: duplicate `byUser` rows

When `getUsage({ groupBy: "user" })` returns multiple `byUser` rows with the same
`externalUserId`, sum them with `summarizeUsageForExternalUser` (or
`aggregateUsageByExternalUserId` on `byUser` alone):

```ts
import { summarizeUsageForExternalUser } from "@pymthouse/builder-sdk";

const usage = await client.getUsage({ groupBy: "user", startDate, endDate });
const summary = summarizeUsageForExternalUser(usage, externalUserId);
// summary.requestCount, summary.feeWei (wei string)
```

## Billing: plans, retail usage, signed-ticket ingest

**Plans (apiVersion=2):** `listBillingProducts({ apiVersion: "2" })` returns `BillingProduct[]` with capability pricing and sync status. `syncBillingProduct(planId)` POSTs to OpenMeter.

**Retail estimates:** `getUsage({ includeRetail: true, groupBy: "pipeline_model" })` adds `endUserBillableUsdMicros` / fiat rows when the active plan has retail rates.

**Signed-ticket ingest (platform metering):** after a signer proxy response, call `ingestSignedTicket` or use `forwardWithOptionalMetering` with `metering: { mode: "pymthouse_hosted" }` on `createSignerProxyServer` — usage is stripped from the client response and POSTed to `POST /api/v1/apps/{id}/usage/signed-tickets`.

**Routing:** `getSignerRouting()` returns `signerApiUrl`, `remoteDmzUrl`, `meteringMode`, and pattern hints for hosted vs platform-ingest vs BYO OpenMeter.

**Allowances (OpenMeter):** Trial and manual USD micros allowance use OpenMeter entitlements — not a Postgres wei ledger.

| Method | SDK | HTTP |
|--------|-----|------|
| Read balance | `getUsageBalance(externalUserId)` | `GET .../usage/balance?externalUserId=` |
| Read allowance detail | `getUserAllowances(externalUserId)` | `GET .../users/{id}/allowances` |
| Top-up grant | `grantUserAllowance(externalUserId, { amountUsdMicros, source })` | `POST .../users/{id}/allowances` |

`grantUserCredits` / `getUserCredits` remain as **deprecated** aliases that call the allowances / balance endpoints. `POST .../users/{id}/credits` was removed from PymtHouse (the route may still re-export allowances temporarily).

**Plan pricing helpers:** `markupPercentToRetailRateUsd`, `applyRetailRateToNetworkMicros` (exported from the main entry).

## Usage API: pipeline/model grouping

When `getUsage({ groupBy: "pipeline_model", startDate, endDate, userId })` returns
`byPipelineModel`, use `listUsageByPipelineModel` for a stable-sorted copy. Pass
the optional `gatewayRequestId` filter to scope results to a single upstream
gateway request:

```ts
import { listUsageByPipelineModel } from "@pymthouse/builder-sdk";

const usage = await client.getUsage({
  groupBy: "pipeline_model",
  startDate,
  endDate,
  userId: internalUserId,
  gatewayRequestId, // optional: filter to a single gateway request
});
const rows = listUsageByPipelineModel(usage);
```

## Documentation

Authoritative API behavior: [PymtHouse `docs/builder-api.md`](https://github.com/pymthouse/pymthouse/blob/main/docs/builder-api.md).

## Server-only: `createPmtHouseClientFromEnv` / `@pymthouse/builder-sdk/env`

M2M credentials are **confidential**. The `env` entry point:

1. **Throws as soon as the module loads in a browser** (detects `globalThis.window`), so a mistaken client import fails immediately instead of silently bundling secrets.
2. Does **not** stop someone from putting `m2mClientSecret` in `new PmtHouseClient({ ... })` in client code—you still must not do that.

**Next.js — build-time guard (optional):** in a file that is only used from the server, add the official marker so the bundler errors instead of shipping the module to the client:

```ts
// e.g. lib/pymthouse-server.ts
import "server-only";

export {
  createPmtHouseClientFromEnv,
  getPymthouseBaseUrl,
} from "@pymthouse/builder-sdk/env";
```

Import `createPmtHouseClientFromEnv` only from that wrapper (or from Route Handlers / Server Actions directly).

## Next.js (monorepo) consumption

When the SDK lives as a sibling folder (e.g. `../node-pymt-sdk`), enable `experimental.externalDir` in `next.config` and re-export from a small `lib` shim that points at `../../node-pymt-sdk` (see the `website` app in this org). Published installs from npm use the package name directly without shims.

## License

MIT

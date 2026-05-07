# @pymthouse/builder-api

TypeScript client for the **PymtHouse Builder API**, **Usage API**, and **OIDC issuer** surfaces.

OAuth/OIDC protocol calls use **[oauth4webapi](https://github.com/panva/oauth4webapi)** (OpenID-certified relying-party implementation). PymtHouse-specific REST paths and helpers live in `PmtHouseClient`.

## Install

```bash
pnpm add @pymthouse/builder-api
```

## Quick start

```ts
import { PmtHouseClient } from "@pymthouse/builder-api";
import {
  createPmtHouseClientFromEnv,
  getPymthouseBaseUrl,
} from "@pymthouse/builder-api/env";

const client = createPmtHouseClientFromEnv();
const base = getPymthouseBaseUrl();
const discovery = await client.getDiscovery();
```

Or construct explicitly:

```ts
import { PmtHouseClient } from "@pymthouse/builder-api";

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

## Subpath exports

| Import | Purpose |
|--------|---------|
| `@pymthouse/builder-api` | `PmtHouseClient`, discovery cache, errors, usage aggregation helpers |
| `@pymthouse/builder-api/format` | Wei formatting for Usage API |
| `@pymthouse/builder-api/env` | `createPmtHouseClientFromEnv`, `getPymthouseBaseUrl` |
| `@pymthouse/builder-api/device` | RFC 8628 `pollDeviceToken` |
| `@pymthouse/builder-api/verify` | RFC 9068 `verifyJwt` |

## Usage API: duplicate `byUser` rows

When `getUsage({ groupBy: "user" })` returns multiple `byUser` rows with the same
`externalUserId`, sum them with `summarizeUsageForExternalUser` (or
`aggregateUsageByExternalUserId` on `byUser` alone):

```ts
import { summarizeUsageForExternalUser } from "@pymthouse/builder-api";

const usage = await client.getUsage({ groupBy: "user", startDate, endDate });
const summary = summarizeUsageForExternalUser(usage, externalUserId);
// summary.requestCount, summary.feeWei (wei string)
```

## Usage API: pipeline/model grouping

When `getUsage({ groupBy: "pipeline_model", startDate, endDate, userId })` returns
`byPipelineModel`, use `listUsageByPipelineModel` for a stable-sorted copy. Pass
the optional `gatewayRequestId` filter to scope results to a single upstream
gateway request:

```ts
import { listUsageByPipelineModel } from "@pymthouse/builder-api";

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

Authoritative API behavior: [PymtHouse `docs/builder-api.md`](https://github.com/eliteprox/pymthouse/blob/main/docs/builder-api.md).

## Server-only: `createPmtHouseClientFromEnv` / `@pymthouse/builder-api/env`

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
} from "@pymthouse/builder-api/env";
```

Import `createPmtHouseClientFromEnv` only from that wrapper (or from Route Handlers / Server Actions directly).

## Next.js (monorepo) consumption

When the SDK lives as a sibling folder (e.g. `../node-pymt-sdk`), enable `experimental.externalDir` in `next.config` and re-export from a small `lib` shim that points at `../../node-pymt-sdk` (see the `website` app in this org). Published installs from npm use the package name directly without shims.

## License

MIT

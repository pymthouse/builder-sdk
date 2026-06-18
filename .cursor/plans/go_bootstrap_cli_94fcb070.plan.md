---
name: Go bootstrap CLI
overview: Build from a fresh branch created off main. Replace the TypeScript/Node bootstrap tooling with a single cross-platform Go CLI in the clearinghouse repo that provisions Auth0 (via go-auth0) and OpenMeter/Konnect (via the official Konnect Go SDK, not generated local client code), then emits .env.livepeer and sdk-config.json for builder-sdk. The CLI mirrors the existing TS "admin pattern" (port/adapter/factory) in Go.
todos: []
isProject: false
---

# Go Bootstrap CLI for Auth0 + OpenMeter

## Goal & scope

Build this from a **fresh branch created off `main`**, with the branch containing the new bootstrap CLI work and no unrelated changes. The branch adds a **single, cross-platform Go CLI** that:

1. Provisions **Auth0** (resource server + public/M2M clients + grants) using [`github.com/auth0/go-auth0/v2`](https://github.com/auth0/go-auth0) — no `auth0-deploy-cli`, no Node, no Next.js.
2. Provisions **OpenMeter/Konnect** catalog (meters + features) **and the default pay-per-use plan**, using the official [`github.com/Kong/sdk-konnect-go`](https://github.com/Kong/sdk-konnect-go) SDK — not a generated local OpenAPI client and not the hand-written `packages/konnect-metering` Kong wrapper.
3. Emits **`.env.livepeer`** (runtime env) and **`sdk-config.json`** (structured) for builder-sdk, matching the existing `auth0-livepeer` contract.

Out of scope for this PR (call out in README as follow-ups): per-customer provisioning (customers/subscriptions), self-hosted OpenMeter adapter, the Benthos collector, Docker/Railway stack. This branch is bootstrap + config generation only.

This consolidates the Auth0 logic currently in `auth0-livepeer` and the OpenMeter logic currently in `clearinghouse` `feat/deploy-stack-railway` into one Go binary.

## Key design decisions

- **Admin pattern in Go.** Mirror `src/admin/{port,factory,types,errors}.ts` and `src/admin/services/catalog.service.ts` as Go: an `OpenMeterAdmin` interface (port), a `KonnectAdmin` adapter, a `createAdmin` factory, and a `BootstrapCatalog` service. Same idempotent "list-then-create" semantics as [catalog.service.ts](clearinghouse/src/admin/services/catalog.service.ts).
- **Use the official Konnect Go SDK.** Depend directly on `github.com/Kong/sdk-konnect-go` for the OpenMeter/Konnect API surface instead of generating and vendoring a local OpenAPI client. Keep only a thin `KonnectAdmin` adapter around the SDK so the rest of the bootstrap code talks to the local `OpenMeterAdmin` port. Configure SDK auth with the Konnect PAT (`kpat_...`) and default the base URL/region to the US Konnect OpenMeter endpoint, with an override for tests or future regions.
- **Auth0 imperative Management API** (replaces `tenant.yaml` + deploy-cli mode). Idempotent by listing clients/resource servers by name before create. Recreates exactly what [auth0-management.ts](auth0-livepeer/scripts/lib/auth0-management.ts) + [tenant.yaml](auth0-livepeer/tenant.yaml) produce: resource server (audience, `sign:job`, RS256, 86400 lifetime), native public client (device_code + refresh_token, no auth), non-interactive M2M client (client_credentials), and two client grants.
- **Cross-platform** via Go's native cross-compilation; ship a build matrix (Makefile + GitHub Actions / goreleaser) for linux/darwin/windows on amd64/arm64.
- **Config-driven** meter/pricing definitions stay as JSON (`config/meters.json`, `config/pricing.json`), ported verbatim from the TS repo so behavior is identical.

## Proposed layout

```
clearinghouse/            (new branch off main)
  go.mod  go.sum
  cmd/clearinghouse-bootstrap/main.go     # CLI entry + flag/subcommand wiring
  internal/
    config/config.go                      # env + flag parsing -> BootstrapConfig
    auth0/provision.go                     # go-auth0 management provisioning
    admin/                                 # the "admin pattern" in Go
      port.go errors.go types.go factory.go
      konnect_adapter.go                   # thin adapter around github.com/Kong/sdk-konnect-go
      catalog.go                           # BootstrapCatalog service
    meters/meters.go                       # loads config/meters.json
    pricing/pricing.go                     # loads config/pricing.json
    output/env.go output/sdkconfig.go      # writers for .env.livepeer + sdk-config.json
  config/meters.json  config/pricing.json  # ported from TS repo
  Makefile  .github/workflows/release.yml
  README.md
```

## Auth0 provisioning (go-auth0 v2)

Initialize: `management.New(domain, option.WithClientCredentials(ctx, mgmtClientID, mgmtClientSecret))`. Then idempotently ensure:

- `ResourceServer` — identifier = `AUTH0_AUDIENCE` (default `livepeer`), scope `sign:job`, RS256, token lifetime 86400.
- `Client` (public) — `app_type: native`, grants `device_code` + `refresh_token`, `token_endpoint_auth_method: none`.
- `Client` (M2M) — `app_type: non_interactive`, grant `client_credentials`.
- `ClientGrant` x2 — M2M→API and Public→API, scope `sign:job`.

Read back `client_id`/`client_secret` for output. No actions/connections (none today).

## OpenMeter/Konnect provisioning

Port [catalog.service.ts](clearinghouse/src/admin/services/catalog.service.ts) + [catalog.ts](clearinghouse/packages/konnect-metering/src/catalog.ts):

- Ensure meters from `KONNECT_METER_DEFINITIONS` (`network_fee_usd_micros`, `billable_usd_micros`, `signed_ticket_count`).
- Ensure features (`network_spend`, `billable_spend`) linked to meters.
- Ensure default PPU plan `clearinghouse_default_ppu`: build usage rate card (feature ref, `price.type=unit`, `amount`, `discounts.usage = includedMicros`), `POST /plans` with one `default` phase, then `POST /plans/{id}/publish` if status `draft`. Idempotent on plan key.

## Output files

- **`.env.livepeer`** — Auth0 block (`AUTH0_DOMAIN/ISSUER/JWKS_URL/AUDIENCE/PUBLIC_CLIENT_ID/M2M_CLIENT_ID/M2M_CLIENT_SECRET`), identity-webhook block (`JWKS_URL`, `JWT_ISSUER`, `JWT_AUDIENCE`, `WEBHOOK_SECRET`, `CLAIM_CLIENT_ID=azp`, `USAGE_SUBJECT_TYPE=auth0_user_id`), OpenMeter block (`OPENMETER_URL`, `OPENMETER_API_KEY`, `OPENMETER_TRIAL_FEATURE_KEY`), and runtime URLs. Mirror [build-env.ts](auth0-livepeer/scripts/lib/build-env.ts).
- **`sdk-config.json`** — `{ auth0, signer, remoteSigner, openmeter }` shape from [sdk-config.ts](auth0-livepeer/scripts/lib/sdk-config.ts).

These map to the env keys builder-sdk actually reads (`readOidcRemoteSignerWebhookConfigFromEnv`, `readPymthouseEnv`).

## Verification

- `go build ./...` cross-compiles for all targets (`GOOS`/`GOARCH` matrix in Makefile).
- Unit tests with `httptest` stubbing the Konnect REST + Auth0 Management endpoints to assert idempotency and exact payloads (rate card, grants), porting the assertions from the existing Vitest suites.
- Golden-file tests for `.env.livepeer` / `sdk-config.json` output.
- `--help`, `--skip-auth0`, `--skip-openmeter` flags behave like the TS CLI.
</plan>
<todos>[{"id": "scaffold", "content": "Create branch off main; init Go module, cmd/clearinghouse-bootstrap entry, Makefile + cross-platform release workflow, port config/meters.json and config/pricing.json"}, {"id": "config", "content": "Implement internal/config (env+flag parsing -> BootstrapConfig) and meters/pricing JSON loaders mirroring the TS lib"}, {"id": "konnect-sdk", "content": "Add github.com/Kong/sdk-konnect-go; configure Konnect PAT auth, base URL/region override, and a thin SDK client factory"}, {"id": "admin-pattern", "content": "Port the admin pattern to Go: port.go interface, KonnectAdmin SDK adapter, factory, types, errors"}, {"id": "catalog-service", "content": "Implement BootstrapCatalog service (idempotent meters + features + default PPU plan with rate card + publish)"}, {"id": "auth0", "content": "Implement Auth0 provisioning with go-auth0 v2 (resource server, public + M2M clients, two client grants), idempotent by name"}, {"id": "output", "content": "Implement .env.livepeer and sdk-config.json writers matching the auth0-livepeer contract"}, {"id": "tests", "content": "Add httptest-based unit tests (Konnect SDK adapter + Auth0) and golden-file tests for outputs; verify cross-compilation"}, {"id": "readme", "content": "Write README documenting CLI usage, flags, env, and follow-up scope (per-customer provisioning, self-hosted OpenMeter)"}]</todos>
</invoke>

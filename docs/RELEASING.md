# Releasing `@pymthouse/builder-sdk`

Releases are triggered by pushing a semver tag (`v*.*.*`). The [release workflow](../.github/workflows/release.yml) runs tests, builds, publishes to npm via **trusted publishing** (OIDC), and creates a GitHub Release.

## npm trusted publishing (required)

This repo publishes with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) — no `NPM_TOKEN` secret on the publish step.

### One-time setup on npmjs.com

1. Open **@pymthouse/builder-sdk** → **Settings** → **Trusted publishing**.
2. Add a **GitHub Actions** publisher:
   - **Repository:** `pymthouse/builder-sdk`
   - **Workflow filename:** `release.yml` (exact name, including `.yml`)
   - **Environment:** leave empty unless you use a GitHub Environment
3. **Remove** the `NPM_TOKEN` repository secret if it still exists. A leftover token is passed as `NODE_AUTH_TOKEN` by some setups and overrides OIDC, which causes `npm error code EOTP`.
4. Optional hardening: **Settings** → **Publishing access** → disallow traditional tokens once publishes succeed.

### Workflow requirements (already in `release.yml`)

- `permissions.id-token: write`
- `actions/setup-node` with `registry-url: https://registry.npmjs.org`
- **No** `NODE_AUTH_TOKEN` / `NPM_TOKEN` on the publish step
- `npm publish` (npm CLI ≥ 11.5.1), not `pnpm publish` — pnpm does not perform OIDC exchange

`npm whoami` does not reflect OIDC auth; a failed publish usually means the trusted publisher fields do not match the workflow run (repo, workflow file name, or tag vs `workflow_dispatch`).

## Re-run a failed release

If the tag already exists (e.g. `v0.1.0`) but npm publish failed:

1. Confirm trusted publishing and delete `NPM_TOKEN` if present.
2. **Actions** → **release** → **Run workflow** → tag `v0.1.0` → **Run workflow**.

If you use `workflow_dispatch`, the trusted publisher must allow that trigger (same workflow file `release.yml`).

## PR release candidates (`publish-rc.yml`)

On each update to a **same-repo** pull request targeting `main`, [publish-rc.yml](../.github/workflows/publish-rc.yml):

1. Runs tests and build.
2. Publishes `@pymthouse/builder-sdk@<base>-rc.pr<number>.<shortsha>` to npm with dist-tag **`rc`**.
3. Pushes git tag `v<base>-rc.pr<number>.<shortsha>`.
4. Comments on the PR with exact install commands.

**npm trusted publishing:** add a second trusted publisher entry (or allow multiple workflows if your npm UI supports it) with workflow filename **`publish-rc.yml`**.

**Downstream PRs (pymthouse, dashboard):** pin the RC while integrating:

```bash
npm install @pymthouse/builder-sdk@0.5.0-rc.pr123.abc1234
# or the rolling tag (latest RC from the most recent publish-rc run):
npm install @pymthouse/builder-sdk@rc
```

Fork PRs skip publish (OIDC/provenance cannot target fork heads).

## Cutting a new version

Use the **Bump version** workflow or locally:

```bash
pnpm version patch   # or minor / major / prerelease
git push origin main --tags
```

The tag push starts **release** automatically.

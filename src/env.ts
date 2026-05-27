import { PmtHouseClient } from "./client.js";
import { PmtHouseError } from "./errors.js";
import { stripTrailingSlashes } from "./string-utils.js";

/**
 * Fail fast if this module is bundled for the browser. M2M secrets must never
 * ship to clients; Next.js users can also re-export behind `import "server-only"`
 * for build-time enforcement (see README).
 */
function assertEnvModuleServerOnly(): void {
  if ((globalThis as { window?: unknown }).window !== undefined) {
    throw new TypeError(
      "@pymthouse/builder-sdk/env is server-only: do not import createPmtHouseClientFromEnv or getPymthouseBaseUrl in client-side code. Use a Route Handler, Server Action, or other server/runtime; keep M2M credentials out of the browser bundle.",
    );
  }
}

assertEnvModuleServerOnly();

let cachedClient: PmtHouseClient | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value) {
    return value;
  }

  throw new PmtHouseError(`Missing required environment variable: ${name}`, {
    status: 500,
    code: "missing_env",
  });
}

/**
 * Site origin for the PymtHouse deployment (e.g. https://pymthouse.com), derived
 * from `PYMTHOUSE_ISSUER_URL`.
 */
export function getPymthouseBaseUrl(): string {
  const issuerUrl = requiredEnv("PYMTHOUSE_ISSUER_URL");
  return new URL(stripTrailingSlashes(issuerUrl)).origin;
}

/**
 * Singleton `PmtHouseClient` from `PYMTHOUSE_*` environment variables (server-side).
 */
export function createPmtHouseClientFromEnv(): PmtHouseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const issuerUrl = requiredEnv("PYMTHOUSE_ISSUER_URL");

  cachedClient = new PmtHouseClient({
    issuerUrl,
    publicClientId: requiredEnv("PYMTHOUSE_PUBLIC_CLIENT_ID"),
    m2mClientId: requiredEnv("PYMTHOUSE_M2M_CLIENT_ID"),
    m2mClientSecret: requiredEnv("PYMTHOUSE_M2M_CLIENT_SECRET"),
    allowInsecureHttp: issuerUrl.startsWith("http:"),
    logger: {
      debug: (message, details) => {
        if (process.env.NODE_ENV !== "production") {
          console.debug(`[pymthouse] ${message}`, details ?? {});
        }
      },
      warn: (message, details) => {
        console.warn(`[pymthouse] ${message}`, details ?? {});
      },
    },
  });

  return cachedClient;
}

import { stripIssuerOriginFromOidcUrl, stripTrailingSlashes } from "../../string-utils.js";

export type GatewayServerConfig = {
  enabled: boolean;
  signerUrl: string;
  discoveryUrl?: string;
  discoveryTimeoutMs: number;
  useTofu: boolean;
  paymentIntervalMs: number;
};

/** Upstream pymthouse signer used by a same-origin dashboard proxy (`/api/signer/*`). */
export function resolveGatewaySignerUpstreamUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const issuerUrl = env.PYMTHOUSE_ISSUER_URL?.trim();
  const signerUrl =
    env.PYMTHOUSE_SIGNER_URL?.trim() ||
    env.SIGNER_PUBLIC_URL?.trim() ||
    env.GATEWAY_SIGNER_UPSTREAM_URL?.trim() ||
    (issuerUrl ? `${stripIssuerOriginFromOidcUrl(issuerUrl)}/api/signer` : "");
  return signerUrl || null;
}

export function requestOriginFromRequest(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  if (host) {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol =
      forwardedProto === "http" || forwardedProto === "https"
        ? forwardedProto
        : new URL(request.url).protocol.replace(":", "");
    return `${protocol}://${host}`;
  }
  return new URL(request.url).origin;
}

export function resolveGatewaySignerUrl(
  env: NodeJS.ProcessEnv,
  request?: Request,
): string | null {
  if (env.GATEWAY_SIGNER_FROM_REQUEST_ORIGIN === "1" && request) {
    return `${stripTrailingSlashes(requestOriginFromRequest(request))}/api/signer`;
  }

  return resolveGatewaySignerUpstreamUrl(env);
}

export function readGatewayConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayServerConfig | null {
  const enabled =
    env.GATEWAY_ENABLED === "1" || env.NEXT_PUBLIC_GATEWAY_ENABLED === "1";
  if (!enabled) {
    return null;
  }

  const signerUrl = resolveGatewaySignerUrl(env);
  if (!signerUrl) {
    return null;
  }

  const discoveryUrl =
    env.LIVEPEER_DISCOVERY_SERVICE_URL?.trim() ||
    env.GATEWAY_DISCOVERY_URL?.trim() ||
    undefined;

  const discoveryTimeoutMs = Number(env.GATEWAY_DISCOVERY_TIMEOUT_MS ?? "60000");
  const paymentIntervalMs = Number(env.GATEWAY_PAYMENT_INTERVAL_MS ?? "2000");

  return {
    enabled: true,
    signerUrl,
    discoveryUrl,
    discoveryTimeoutMs: Number.isFinite(discoveryTimeoutMs) ? discoveryTimeoutMs : 60_000,
    useTofu: env.GATEWAY_USE_TOFU !== "0",
    paymentIntervalMs: Number.isFinite(paymentIntervalMs) ? paymentIntervalMs : 2000,
  };
}

export function readGatewayConfigForRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): GatewayServerConfig | null {
  const enabled =
    env.GATEWAY_ENABLED === "1" || env.NEXT_PUBLIC_GATEWAY_ENABLED === "1";
  if (!enabled) {
    return null;
  }

  const signerUrl = resolveGatewaySignerUrl(env, request);
  if (!signerUrl) {
    return null;
  }

  const discoveryUrl =
    env.LIVEPEER_DISCOVERY_SERVICE_URL?.trim() ||
    env.GATEWAY_DISCOVERY_URL?.trim() ||
    undefined;

  const discoveryTimeoutMs = Number(env.GATEWAY_DISCOVERY_TIMEOUT_MS ?? "60000");
  const paymentIntervalMs = Number(env.GATEWAY_PAYMENT_INTERVAL_MS ?? "2000");

  return {
    enabled: true,
    signerUrl,
    discoveryUrl,
    discoveryTimeoutMs: Number.isFinite(discoveryTimeoutMs) ? discoveryTimeoutMs : 60_000,
    useTofu: env.GATEWAY_USE_TOFU !== "0",
    paymentIntervalMs: Number.isFinite(paymentIntervalMs) ? paymentIntervalMs : 2000,
  };
}

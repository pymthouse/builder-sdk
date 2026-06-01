export type GatewayServerConfig = {
  enabled: boolean;
  signerUrl: string;
  discoveryUrl?: string;
  discoveryTimeoutMs: number;
  useTofu: boolean;
  paymentIntervalMs: number;
};

export function readGatewayConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayServerConfig | null {
  const enabled =
    env.GATEWAY_ENABLED === "1" || env.NEXT_PUBLIC_GATEWAY_ENABLED === "1";
  if (!enabled) {
    return null;
  }

  const issuerUrl = env.PYMTHOUSE_ISSUER_URL?.trim();
  const signerUrl =
    env.PYMTHOUSE_SIGNER_URL?.trim() ||
    env.SIGNER_PUBLIC_URL?.trim() ||
    (issuerUrl
      ? `${issuerUrl.replace(/\/api\/v1\/oidc\/?$/, "").replace(/\/+$/, "")}/api/signer`
      : "");

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

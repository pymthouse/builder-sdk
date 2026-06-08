import { loadAuthorizationServer } from "../../discovery.js";
import { verifyJwt } from "../../verify.js";
import type { FetchLike } from "../../types.js";
import { authenticateWebhookCaller } from "./authorize.js";
import {
  claimExpirySeconds,
  DEFAULT_WEBHOOK_IDENTITY_CLAIMS,
  identityFromWebhookClaims,
  type WebhookIdentityClaimMapping,
} from "./identity.js";
import type { EndUserAuthVerifier } from "./verifier.js";

export type OidcEndUserAuthConfig = {
  jwtIssuer: string;
  jwtAudience: string;
  claimMapping?: Partial<WebhookIdentityClaimMapping>;
  allowInsecureHttp?: boolean;
  fetch?: FetchLike;
  requiredScopes?: string[];
  webhookSecret: string;
};

export function bearerTokenFromAuthorization(authorization: string): string {
  const trimmed = authorization.trim();
  if (!trimmed) {
    throw new Error("missing authorization");
  }
  const prefix = "Bearer ";
  if (!trimmed.startsWith(prefix)) {
    throw new Error("authorization must be Bearer token");
  }
  const token = trimmed.slice(prefix.length).trim();
  if (!token) {
    throw new Error("empty bearer token");
  }
  return token;
}

export async function handleRemoteSignerRefreshJwks(
  request: Request,
  config: Pick<
    OidcEndUserAuthConfig,
    "webhookSecret" | "jwtIssuer" | "fetch" | "allowInsecureHttp"
  >,
): Promise<Response> {
  if (!authenticateWebhookCaller(request, config.webhookSecret)) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    await loadAuthorizationServer(config.jwtIssuer, config.fetch ?? fetch, {
      force: true,
      allowInsecureHttp: config.allowInsecureHttp,
    });
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "jwks refresh failed";
    return new Response(message, { status: 500 });
  }
}

export function createOidcEndUserVerifier(config: OidcEndUserAuthConfig): EndUserAuthVerifier {
  const claimMapping = {
    ...DEFAULT_WEBHOOK_IDENTITY_CLAIMS,
    ...config.claimMapping,
  };

  return {
    kind: "oidc",
    verify: async ({ authorization }) => {
      const token = bearerTokenFromAuthorization(authorization);
      const audience = config.jwtAudience.trim();
      if (!audience) {
        throw new Error("jwt audience is required for webhook verification");
      }

      const claims = await verifyJwt(token, {
        issuerUrl: config.jwtIssuer,
        audience,
        fetch: config.fetch,
        allowInsecureHttp: config.allowInsecureHttp,
        requiredScopes: config.requiredScopes,
      });

      const claimsRecord = claims as unknown as Record<string, unknown>;
      const identity = identityFromWebhookClaims(claimsRecord, claimMapping);

      return {
        identity,
        expiry: claimExpirySeconds(claimsRecord),
        raw: claimsRecord,
      };
    },
    adminRoutes: [
      {
        method: "POST",
        pathname: "/admin/refresh-jwks",
        handler: (request) => handleRemoteSignerRefreshJwks(request, config),
      },
    ],
  };
}

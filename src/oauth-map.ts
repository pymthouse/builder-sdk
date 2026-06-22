import { type Client, OperationProcessingError, ResponseBodyError } from "oauth4webapi";
import { PmtHouseError } from "./errors.js";
import type { ClientCredentialsTokenResponse, TokenExchangeResponse } from "./types.js";

const ACCEPTED_ISSUED_TOKEN_TYPES = new Set([
  "urn:ietf:params:oauth:token-type:access_token",
  "urn:pmth:token-type:remote-signer-session",
]);

export function mapOAuthError(error: unknown): PmtHouseError {
  if (error instanceof PmtHouseError) {
    return error;
  }

  if (error instanceof ResponseBodyError) {
    const cause = error.cause as Record<string, unknown>;
    const description =
      typeof error.error_description === "string"
        ? error.error_description
        : error.message;
    const details: Record<string, unknown> = { ...cause };
    if (typeof cause.error_uri === "string") {
      details.error_uri = cause.error_uri;
    }
    return new PmtHouseError(description, {
      status: error.status,
      code: error.error,
      details,
    });
  }

  if (error instanceof OperationProcessingError) {
    return new PmtHouseError(error.message, {
      status: 502,
      code: error.code ?? "oauth_processing_error",
      details: { cause: error.cause },
    });
  }

  if (error instanceof Error) {
    return new PmtHouseError(error.message, {
      status: 500,
      code: "unexpected_error",
    });
  }

  return new PmtHouseError("Unexpected error", {
    status: 500,
    code: "unexpected_error",
  });
}

export function tokenEndpointResponseToExchange(
  tr: import("oauth4webapi").TokenEndpointResponse,
): TokenExchangeResponse {
  const issued = tr.issued_token_type;
  if (typeof issued !== "string" || !ACCEPTED_ISSUED_TOKEN_TYPES.has(issued)) {
    throw new PmtHouseError("Token exchange returned an unexpected issued_token_type", {
      status: 502,
      code: "invalid_token_response",
      details: { issued_token_type: issued },
    });
  }

  const tt = tr.token_type;
  if (typeof tt !== "string" || tt.toLowerCase() !== "bearer") {
    throw new PmtHouseError("Token endpoint returned a non-Bearer token_type", {
      status: 502,
      code: "invalid_token_response",
      details: { token_type: tt },
    });
  }

  const expiresIn = tr.expires_in;
  if (typeof expiresIn !== "number") {
    throw new PmtHouseError("Token response missing expires_in", {
      status: 502,
      code: "invalid_token_response",
    });
  }

  const scope = typeof tr.scope === "string" ? tr.scope : "";

  return {
    access_token: tr.access_token,
    token_type: "Bearer",
    expires_in: expiresIn,
    scope,
    issued_token_type: issued,
  };
}

export function tokenEndpointResponseToClientCredentials(
  tr: import("oauth4webapi").TokenEndpointResponse,
): ClientCredentialsTokenResponse {
  const tt = tr.token_type;
  if (typeof tt !== "string" || tt.toLowerCase() !== "bearer") {
    throw new PmtHouseError("Token endpoint returned a non-Bearer token_type", {
      status: 502,
      code: "invalid_token_response",
      details: { token_type: tt },
    });
  }

  return {
    access_token: tr.access_token,
    token_type: "Bearer",
    expires_in: tr.expires_in,
    scope: typeof tr.scope === "string" ? tr.scope : undefined,
  };
}

export function m2mClient(clientId: string): Client {
  return { client_id: clientId };
}

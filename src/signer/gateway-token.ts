import { PmtHouseError } from "../errors.js";
import type { FetchLike } from "../types.js";
import { mintUserSignerToken } from "./mint-token.js";
import { mintSignerSessionFromApiKey } from "./api-key-exchange.js";

/**
 * Decoded shape of a livepeer-python-gateway `--token` bundle. Mirrors the
 * fields the gateway reads in `token.py` (`parse_token`). All fields are
 * optional because the gateway omits absent keys.
 */
export interface GatewayTokenBundle {
  orchestrators?: string[];
  signer?: string;
  discovery?: string;
  signer_headers?: Record<string, string>;
  discovery_headers?: Record<string, string>;
  billing?: string;
  api_key?: string;
}

/**
 * How the gateway should authenticate to the remote signer.
 *
 * - `signerJwt`: caller has already minted a signer JWT; it is forwarded as
 *   `signer_headers.Authorization = "Bearer <jwt>"`. The gateway only reads the
 *   JWT `exp` and cannot refresh it on its own.
 * - `pmthApiKey`: the gateway holds a `pmth_*` API key plus the platform facade
 *   origin (`billing`) and exchanges for a short-lived signer JWT via
 *   `POST {billing}/api/pymthouse/keys/exchange`, then signs directly to signer.
 */
export type GatewayTokenAuth =
  | { kind: "signerJwt"; accessToken: string }
  | { kind: "pmthApiKey"; apiKey: string; billing?: string };

export interface GatewayTokenInput {
  /** Remote signer base URL the gateway signs against. */
  signer: string;
  discovery?: string;
  orchestrators?: string[];
  signerHeaders?: Record<string, string>;
  discoveryHeaders?: Record<string, string>;
  auth?: GatewayTokenAuth;
}

/**
 * Coerce an externally supplied value to a trimmed string, throwing a
 * consistent {@link PmtHouseError} (rather than a raw `TypeError`) when the
 * input is not a string. Used to guard public entry points against untyped
 * JavaScript callers.
 *
 * @param value - The value to validate.
 * @param label - Human-readable description of the field for the error message.
 * @returns The trimmed string value.
 * @throws {PmtHouseError} When `value` is not a string.
 */
function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new PmtHouseError(`${label} must be a string`, {
      status: 400,
      code: "invalid_gateway_token",
    });
  }
  return value.trim();
}

/**
 * Like {@link requireString} but treats `null`/`undefined` as "not provided"
 * (returning `undefined`) while still rejecting non-string values with a
 * consistent {@link PmtHouseError}.
 *
 * @param value - The optional value to validate.
 * @param label - Human-readable description of the field for the error message.
 * @returns The trimmed string, or `undefined` when absent/empty.
 * @throws {PmtHouseError} When `value` is present but not a string.
 */
function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireString(value, label) || undefined;
}

/** Serialize a value to JSON and standard (non-url-safe) base64. */
function encodeBase64Json(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof Buffer === "undefined") {
    const binary = Array.from(new TextEncoder().encode(json), (c) =>
      String.fromCodePoint(c),
    ).join("");
    return btoa(binary);
  }
  return Buffer.from(json, "utf8").toString("base64");
}

/** Decode a standard base64 string back into the parsed JSON value it encoded. */
function decodeBase64Json(token: string): unknown {
  const trimmed = requireString(token, "gateway token");
  let json: string;
  try {
    if (typeof Buffer === "undefined") {
      json = new TextDecoder().decode(
        Uint8Array.from(atob(trimmed), (c) => c.codePointAt(0) ?? 0),
      );
    } else {
      json = Buffer.from(trimmed, "base64").toString("utf8");
    }
  } catch {
    throw new PmtHouseError("Invalid gateway token: expected base64-encoded JSON", {
      status: 400,
      code: "invalid_gateway_token",
    });
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new PmtHouseError("Invalid gateway token: expected UTF-8 JSON payload", {
      status: 400,
      code: "invalid_gateway_token",
    });
  }
}

/** Drop blank keys and non-string values from a header map, returning undefined when empty. */
function normalizeStringMap(
  map: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!map) {
    return undefined;
  }
  const entries = Object.entries(map).filter(
    ([key, value]) => key.trim() && typeof value === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Assemble a base64-encoded `--token` bundle the python gateway understands.
 * Pure (no network): builds the JSON object, omitting empty fields, then
 * base64-encodes it.
 */
export function buildGatewayToken(input: GatewayTokenInput): string {
  if (input === null || typeof input !== "object") {
    throw new PmtHouseError("buildGatewayToken requires an input object", {
      status: 400,
      code: "invalid_gateway_token",
    });
  }
  const signer = requireString(input.signer, "signer URL");
  if (!signer) {
    throw new PmtHouseError("buildGatewayToken requires a non-empty signer URL", {
      status: 400,
      code: "invalid_gateway_token",
    });
  }

  const signerHeaders: Record<string, string> = { ...input.signerHeaders };
  const bundle: GatewayTokenBundle = { signer };

  const discovery = optionalString(input.discovery, "discovery URL");
  if (discovery) {
    bundle.discovery = discovery;
  }

  const rawOrchestrators = input.orchestrators ?? [];
  if (!Array.isArray(rawOrchestrators)) {
    throw new PmtHouseError("orchestrators must be an array of strings", {
      status: 400,
      code: "invalid_gateway_token",
    });
  }
  const orchestrators = rawOrchestrators
    .map((entry) => requireString(entry, "orchestrator entry"))
    .filter((entry) => entry.length > 0);
  if (orchestrators.length > 0) {
    bundle.orchestrators = orchestrators;
  }

  if (input.auth?.kind === "signerJwt") {
    const accessToken = requireString(input.auth.accessToken, "signerJwt accessToken");
    if (!accessToken) {
      throw new PmtHouseError("signerJwt auth requires a non-empty accessToken", {
        status: 400,
        code: "invalid_gateway_token",
      });
    }
    signerHeaders.Authorization = `Bearer ${accessToken}`;
  } else if (input.auth?.kind === "pmthApiKey") {
    const apiKey = requireString(input.auth.apiKey, "pmthApiKey apiKey");
    if (!apiKey) {
      throw new PmtHouseError("pmthApiKey auth requires a non-empty apiKey", {
        status: 400,
        code: "invalid_gateway_token",
      });
    }
    bundle.api_key = apiKey;
    const billing = optionalString(input.auth.billing, "pmthApiKey billing URL");
    if (billing) {
      bundle.billing = billing;
    }
  }

  const normalizedSignerHeaders = normalizeStringMap(signerHeaders);
  if (normalizedSignerHeaders) {
    bundle.signer_headers = normalizedSignerHeaders;
  }
  const normalizedDiscoveryHeaders = normalizeStringMap(input.discoveryHeaders);
  if (normalizedDiscoveryHeaders) {
    bundle.discovery_headers = normalizedDiscoveryHeaders;
  }

  return encodeBase64Json(bundle);
}

/** Inverse of {@link buildGatewayToken}; for tests and debugging. */
export function decodeGatewayToken(token: string): GatewayTokenBundle {
  const payload = decodeBase64Json(token);
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PmtHouseError("Invalid gateway token: payload must be a JSON object", {
      status: 400,
      code: "invalid_gateway_token",
    });
  }
  return payload as GatewayTokenBundle;
}

interface MintGatewayTokenBase {
  /** Remote signer base URL the gateway signs against. */
  signer: string;
  discovery?: string;
  orchestrators?: string[];
  signerHeaders?: Record<string, string>;
  discoveryHeaders?: Record<string, string>;
  issuerUrl: string;
  m2mClientId: string;
  m2mClientSecret: string;
  fetch?: FetchLike;
  allowInsecureHttp?: boolean;
}

export type MintGatewayTokenOptions = MintGatewayTokenBase &
  (
    | { source: "m2m"; externalUserId: string }
    | {
        source: "apiKey";
        publicClientId: string;
        apiKey: string;
        scope?: string;
        audience?: string;
      }
  );

/**
 * Convenience: mint a signer JWT (either from M2M `client_credentials` or by
 * exchanging a `pmth_*` API key) and assemble a `signerJwt`-mode gateway token.
 */
export async function mintGatewayToken(
  options: MintGatewayTokenOptions,
): Promise<string> {
  let accessToken: string;
  if (options.source === "m2m") {
    const minted = await mintUserSignerToken({
      issuerUrl: options.issuerUrl,
      m2mClientId: options.m2mClientId,
      m2mClientSecret: options.m2mClientSecret,
      externalUserId: options.externalUserId,
      fetch: options.fetch,
      allowInsecureHttp: options.allowInsecureHttp,
    });
    accessToken = minted.jwt;
  } else {
    const minted = await mintSignerSessionFromApiKey({
      issuerUrl: options.issuerUrl,
      publicClientId: options.publicClientId,
      m2mClientId: options.m2mClientId,
      m2mClientSecret: options.m2mClientSecret,
      apiKey: options.apiKey,
      scope: options.scope,
      audience: options.audience,
      fetch: options.fetch,
      allowInsecureHttp: options.allowInsecureHttp,
    });
    accessToken = minted.access_token;
  }

  return buildGatewayToken({
    signer: options.signer,
    discovery: options.discovery,
    orchestrators: options.orchestrators,
    signerHeaders: options.signerHeaders,
    discoveryHeaders: options.discoveryHeaders,
    auth: { kind: "signerJwt", accessToken },
  });
}

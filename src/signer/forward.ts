import { PmtHouseError } from "../errors.js";
import type { FetchLike } from "../types.js";
import type { ForwardDirectSignerRequestOptions, SignerJwtIdentity } from "./types.js";

function base64UrlPayloadToUtf8(payloadB64: string): string {
  const normalized = payloadB64.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf8");
  }
  return atob(padded);
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.trim().split(".");
  if (parts.length < 2) {
    throw new PmtHouseError("Invalid JWT shape", {
      status: 500,
      code: "invalid_jwt",
    });
  }
  try {
    const payloadJson = base64UrlPayloadToUtf8(parts[1]);
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    if (!payload || typeof payload !== "object") {
      throw new Error("payload not an object");
    }
    return payload;
  } catch {
    throw new PmtHouseError("Failed to decode JWT payload", {
      status: 500,
      code: "invalid_jwt",
    });
  }
}

function readClaim(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function identityFromJwtPayload(payload: Record<string, unknown>): SignerJwtIdentity {
  const issuer = readClaim(payload, "iss");
  const clientId = readClaim(payload, "client_id");
  const usageSubject = readClaim(payload, "external_user_id", "usage_subject", "sub");
  const usageSubjectType =
    readClaim(payload, "external_user_id_type", "usage_subject_type") || "external_user_id";

  if (!issuer || !clientId || !usageSubject) {
    throw new PmtHouseError("JWT payload missing signer identity claims", {
      status: 500,
      code: "invalid_jwt",
      details: { issuer, clientId, usageSubject },
    });
  }

  return {
    issuer,
    clientId,
    usageSubject,
    usageSubjectType,
  };
}

export function livepeerIdentityHeaders(identity: SignerJwtIdentity): Record<string, string> {
  return {
    "X-Livepeer-Usage-Issuer": identity.issuer,
    "X-Livepeer-Client-ID": identity.clientId,
    "X-Livepeer-Usage-Subject": identity.usageSubject,
    "X-Livepeer-Usage-Subject-Type": identity.usageSubjectType,
  };
}

function resolveRemoteUrl(
  request: Request,
  remoteSignerUrl: string | URL,
  proxyPathPrefix?: string,
  defaultRemotePath = "/generate-live-payment",
): URL {
  const remoteBase = new URL(remoteSignerUrl);
  const incoming = new URL(request.url);
  let remotePath = incoming.pathname;

  if (proxyPathPrefix) {
    const prefix = proxyPathPrefix.endsWith("/")
      ? proxyPathPrefix.slice(0, -1)
      : proxyPathPrefix;
    if (remotePath.startsWith(prefix)) {
      remotePath = remotePath.slice(prefix.length) || defaultRemotePath;
    }
  }

  if (!remotePath.startsWith("/")) {
    remotePath = `/${remotePath}`;
  }

  const target = new URL(remoteBase);
  target.pathname = remotePath || defaultRemotePath;
  target.search = incoming.search;
  return target;
}

export async function forwardDirectSignerRequest(
  options: ForwardDirectSignerRequestOptions,
): Promise<Response> {
  const fetchImpl = options.fetch ?? fetch;
  const identity = identityFromJwtPayload(decodeJwtPayload(options.jwt));
  const target = resolveRemoteUrl(
    options.request,
    options.remoteSignerUrl,
    options.proxyPathPrefix,
    options.defaultRemotePath,
  );

  const headers = new Headers(options.request.headers);
  headers.set("Authorization", `Bearer ${options.jwt}`);
  for (const [name, value] of Object.entries(livepeerIdentityHeaders(identity))) {
    headers.set(name, value);
  }
  headers.delete("host");
  headers.delete("content-length");

  const init: RequestInit & { duplex?: "half" } = {
    method: options.request.method,
    headers,
    body: options.request.body,
    cache: "no-store",
  };
  if (options.request.body) {
    init.duplex = "half";
  }

  return fetchImpl(target, init);
}

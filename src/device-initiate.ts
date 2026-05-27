import { stripTrailingSlashes } from "./string-utils.js";

/** RFC 8628 user codes: 4–16 chars, at least one alphanumeric (not all dashes). */
export const USER_CODE_RE = /^(?=.*[A-Z0-9])[A-Z0-9-]{4,16}$/;

export type ValidateDeviceInitiateResult =
  | { ok: true; returnUrl: string }
  | { ok: false; reason: string };

export type DeviceApprovalTuple =
  | { userCode: string; publicClientId: string }
  | { error: string };

function normalizeIssuerUrl(iss: string): string {
  try {
    return stripTrailingSlashes(new URL(iss.trim()).href);
  } catch {
    return iss.trim();
  }
}

/**
 * Validate OP-issued `iss` + `target_link_uri` before storing a device approval cookie.
 */
export function validateDeviceInitiateLogin(input: {
  expectedIssuerUrl: string;
  iss: string;
  targetLinkUri: string;
}): ValidateDeviceInitiateResult {
  const expectedIss = stripTrailingSlashes(input.expectedIssuerUrl.trim());
  let opOrigin: string;
  try {
    opOrigin = new URL(expectedIss).origin;
  } catch {
    return { ok: false, reason: "server_not_configured" };
  }

  if (normalizeIssuerUrl(input.iss) !== normalizeIssuerUrl(expectedIss)) {
    return { ok: false, reason: "iss_mismatch" };
  }

  let target: URL;
  try {
    target = new URL(input.targetLinkUri);
  } catch {
    return { ok: false, reason: "bad_target_uri" };
  }
  if (target.origin !== opOrigin) {
    return { ok: false, reason: "target_origin_mismatch" };
  }
  if (target.pathname !== "/oidc/device") {
    return { ok: false, reason: "target_path_mismatch" };
  }
  if (target.hash) {
    return { ok: false, reason: "target_has_hash" };
  }
  return { ok: true, returnUrl: target.href };
}

/**
 * Parse PymtHouse `/oidc/device` URL query for `user_code` + `client_id`.
 */
export function extractDeviceApprovalFromTargetLink(
  targetHref: string,
  opts?: { expectedIssuerUrl?: string; expectedPublicClientId?: string },
): DeviceApprovalTuple {
  let target: URL;
  try {
    target = new URL(targetHref);
  } catch {
    return { error: "bad_target_uri" };
  }

  if (opts?.expectedIssuerUrl) {
    let opOrigin: string;
    try {
      opOrigin = new URL(stripTrailingSlashes(opts.expectedIssuerUrl.trim())).origin;
    } catch {
      return { error: "target_origin_mismatch" };
    }
    if (target.origin !== opOrigin) {
      return { error: "target_origin_mismatch" };
    }
  }

  if (target.pathname !== "/oidc/device") {
    return { error: "target_path_mismatch" };
  }

  const userCodeRaw = target.searchParams.get("user_code")?.trim() ?? "";
  const clientIdRaw = target.searchParams.get("client_id")?.trim() ?? "";
  if (!userCodeRaw || !USER_CODE_RE.test(userCodeRaw)) {
    return { error: "invalid_user_code" };
  }
  if (!clientIdRaw || !clientIdRaw.startsWith("app_")) {
    return { error: "invalid_client_id" };
  }
  if (opts?.expectedPublicClientId && clientIdRaw !== opts.expectedPublicClientId) {
    return { error: "client_id_mismatch" };
  }
  return { userCode: userCodeRaw, publicClientId: clientIdRaw };
}

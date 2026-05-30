import type { SignerIdentity, SignerUsageSubjectType } from "./types.js";

const USAGE_SUBJECT_TYPES = new Set<SignerUsageSubjectType>([
  "external_user_id",
  "app_user_id",
  "end_user_id",
  "anonymous_id",
  "workspace_id",
]);

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing signer identity field: ${field}`);
  }
  return value.trim();
}

export function normalizeSignerIdentity(input: unknown): SignerIdentity {
  const raw = input as Record<string, unknown>;
  const usageSubjectType = requiredString(
    raw.usageSubjectType ?? raw.usage_subject_type,
    "usageSubjectType",
  );

  if (!USAGE_SUBJECT_TYPES.has(usageSubjectType as SignerUsageSubjectType)) {
    throw new Error(`Invalid signer usageSubjectType: ${usageSubjectType}`);
  }

  return {
    issuer: requiredString(raw.issuer ?? raw.iss, "issuer"),
    clientId: requiredString(raw.clientId ?? raw.client_id, "clientId"),
    usageSubject: requiredString(raw.usageSubject ?? raw.usage_subject, "usageSubject"),
    usageSubjectType: usageSubjectType as SignerUsageSubjectType,
  };
}

export function signerIdentityToClaims(identity: SignerIdentity): Record<string, string> {
  return {
    issuer: identity.issuer,
    client_id: identity.clientId,
    usage_subject: identity.usageSubject,
    usage_subject_type: identity.usageSubjectType,
  };
}

export function signerIdentityEquals(left: SignerIdentity, right: SignerIdentity): boolean {
  return (
    left.issuer === right.issuer &&
    left.clientId === right.clientId &&
    left.usageSubject === right.usageSubject &&
    left.usageSubjectType === right.usageSubjectType
  );
}

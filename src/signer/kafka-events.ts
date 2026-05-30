import { normalizeSignerIdentity } from "./identity.js";
import type { CreateSignedTicketEvent } from "./types.js";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`Missing create_signed_ticket field: ${field}`);
  return normalized;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function parseCreateSignedTicketEvent(
  input: Record<string, unknown>,
): CreateSignedTicketEvent {
  const identity = normalizeSignerIdentity({
    issuer: input.issuer,
    client_id: input.client_id,
    usage_subject: input.usage_subject,
    usage_subject_type: input.usage_subject_type,
  });
  const currentTimeUnix = optionalNumber(input.current_time_unix);
  const occurredAt =
    optionalString(input.current_time) ??
    (currentTimeUnix ? new Date(currentTimeUnix).toISOString() : new Date().toISOString());

  return {
    sessionId: requiredString(input.session_id, "session_id"),
    sessionStatus: optionalString(input.session_status),
    requestId: requiredString(input.request_id, "request_id"),
    manifestId: optionalString(input.manifest_id),
    pipeline: optionalString(input.pipeline),
    issuer: identity.issuer,
    clientId: identity.clientId,
    usageSubject: identity.usageSubject,
    usageSubjectType: identity.usageSubjectType,
    computedFeeWei: optionalString(input.computed_fee),
    pixels: optionalNumber(input.pixels),
    sequenceNumber: optionalNumber(input.sequence_number),
    occurredAt,
    raw: input,
  };
}

export function createSignedTicketIdempotencyKey(event: CreateSignedTicketEvent): string {
  return [event.issuer, event.clientId, event.requestId].join(":");
}

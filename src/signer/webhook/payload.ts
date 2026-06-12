import type { PaymentWebhookRequest } from "./types.js";

export function headerValueFromWebhookPayload(
  headers: Record<string, string[]> | undefined,
  name: string,
): string {
  if (!headers) {
    return "";
  }
  const target = name.toLowerCase();
  for (const [key, values] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) {
      continue;
    }
    if (!Array.isArray(values)) {
      continue;
    }
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return "";
}

/** End-user Authorization from go-livepeer webhook body (headers map or legacy field). */
export function authorizationFromWebhookPayload(
  payload: PaymentWebhookRequest,
): string {
  const fromHeaders = headerValueFromWebhookPayload(
    payload.headers,
    "Authorization",
  );
  if (fromHeaders) {
    return fromHeaders;
  }
  return payload.authorization?.trim() ?? "";
}

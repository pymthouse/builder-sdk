import type { PaymentWebhookRequest } from "./types.js";

function firstHeaderValue(values: string[] | undefined): string {
  if (!Array.isArray(values)) {
    return "";
  }
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function headerValueFromWebhookPayload(
  headers: Record<string, string[]> | undefined,
  name: string,
): string {
  if (!headers) {
    return "";
  }
  const direct = firstHeaderValue(headers[name]);
  if (direct) {
    return direct;
  }
  const target = name.toLowerCase();
  for (const [key, values] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return firstHeaderValue(values);
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

/** Wire protocol between go-livepeer remote signer and identity webhook providers. */

export type UsageIdentity = {
  issuer: string;
  client_id: string;
  usage_subject: string;
  usage_subject_type: string;
};

export function isValidUsageIdentity(identity: UsageIdentity): boolean {
  return Boolean(
    identity.issuer.trim() &&
      identity.client_id.trim() &&
      identity.usage_subject.trim() &&
      identity.usage_subject_type.trim(),
  );
}

export type PaymentWebhookRequest = {
  /** Legacy; prefer Authorization in `headers` (go-livepeer PR #3897 wire format). */
  authorization?: string;
  headers?: Record<string, string[]>;
  state?: unknown;
  /** GPU tier forwarded by go-livepeer when available (e.g. `4090`, `h100`). */
  gpu?: string;
};

export type PaymentWebhookResponse = {
  status?: number;
  reason?: string;
  expiry?: number;
  identity?: UsageIdentity;
};

import type { PaymentWebhookRequest, UsageIdentity } from "./types.js";

export type EndUserAuthVerifyContext = {
  authorization: string;
  payload: PaymentWebhookRequest;
  request: Request;
};

export type VerifiedEndUserAuth = {
  identity: UsageIdentity;
  expiry: number;
  /** Provider artifact: JWT claims for OIDC, oauth params for OAuth 1.0, etc. */
  raw?: unknown;
};

export type WebhookAdminRoute = {
  method: "POST";
  pathname: string;
  handler: (request: Request) => Promise<Response>;
};

export type EndUserAuthVerifier = {
  kind: "oidc" | "oauth1" | "custom";
  verify: (context: EndUserAuthVerifyContext) => Promise<VerifiedEndUserAuth>;
  adminRoutes?: WebhookAdminRoute[];
};

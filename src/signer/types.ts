import type { FetchLike } from "../types.js";
import type { SignerIdentityResolver } from "./identity-policy.js";

export type SignerUsageSubjectType =
  | "external_user_id"
  | "app_user_id"
  | "end_user_id"
  | "anonymous_id"
  | "workspace_id";

export interface SignerIdentity {
  issuer: string;
  clientId: string;
  usageSubject: string;
  usageSubjectType: SignerUsageSubjectType;
}

export interface SignerToken {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  expiresAt: string;
  scope: string;
}

/** Balances are tracked in payment units (wei) from remote signer `computed_fee`. */
export interface SignerBalance {
  clientId: string;
  usageSubject: string;
  grantedWei: string;
  consumedWei: string;
  remainingWei: string;
  updatedAt: string;
}

export interface SignerTokenMintInput {
  identity: SignerIdentity;
  subjectToken?: string;
  scope?: string;
  audience?: string;
}

export interface SignerTokenIssuer {
  mintSignerToken(input: SignerTokenMintInput): Promise<SignerToken>;
}

export interface SignerAccountingStore {
  getBalance(identity: SignerIdentity): Promise<SignerBalance | null>;
}

export interface SignerBootstrapRequest {
  /** User or device-login access token validated by the identity resolver. */
  subjectToken: string;
  /** Optional hint; must match token claims when provided. */
  clientId?: string;
  scope?: string;
}

export interface SignerBootstrapResponse {
  token: SignerToken;
  identity: SignerIdentity;
  balance: SignerBalance | null;
}

export interface DeviceSignerExchangeRequest {
  deviceToken: string;
  clientId?: string;
  scope?: string;
}

export interface CreateOAuthSignerTokenIssuerOptions {
  issuerUrl: string;
  clientId: string;
  clientSecret?: string;
  audience?: string;
  scope?: string;
  fetch?: FetchLike;
  allowInsecureHttp?: boolean;
  extraParams?: Record<string, string>;
  /**
   * Send identity as OAuth extension parameters during token minting.
   *
   * Some issuers (including a stock Keycloak realm) require identity claims to
   * come from protocol mappers instead of arbitrary token endpoint params.
   */
  sendIdentityParams?: boolean;
}

export interface SignerBootstrapMintContext {
  identity: SignerIdentity;
  balance: SignerBalance | null;
  input: SignerBootstrapRequest;
}

export interface CreateSignerBootstrapServiceOptions {
  tokenIssuer: SignerTokenIssuer;
  identityResolver: SignerIdentityResolver;
  accountingStore?: SignerAccountingStore;
  defaultScope?: string;
  /** Called after identity resolution and balance read, before signer JWT mint. */
  beforeMint?: (context: SignerBootstrapMintContext) => Promise<void>;
}

export interface CreateSignerProxyHandlerOptions {
  remoteSignerUrl: string | URL;
  fetch?: FetchLike;
  resolveAccessToken: (request: Request) => Promise<string>;
  beforeProxy?: (request: Request) => Promise<Response | void>;
}

export interface CreateSignedTicketEvent {
  sessionId: string;
  sessionStatus?: string;
  requestId: string;
  manifestId?: string;
  pipeline?: string;
  issuer: string;
  clientId: string;
  usageSubject: string;
  usageSubjectType: SignerUsageSubjectType;
  /** Payment units (wei) from go-livepeer `computed_fee`. */
  computedFeeWei?: string;
  pixels?: number;
  sequenceNumber?: number;
  occurredAt: string;
  raw: Record<string, unknown>;
}

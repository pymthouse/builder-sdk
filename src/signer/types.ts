import type { FetchLike } from "../types.js";

export type SignerDmzGate = "http" | "cli";

export interface DirectSignerProxyConfig {
  pymthouseIssuerUrl: string;
  /** Public Builder app client id (`app_…`); used for cache keys and JWT `client_id`. */
  pymthouseClientId: string;
  pymthouseM2MClientId: string;
  pymthouseM2MClientSecret: string;
  remoteSignerUrl: string | URL;
  fetch?: FetchLike;
  allowInsecureHttp?: boolean;
  /**
   * When set, incoming request paths matching this prefix are rewritten to the remote signer base.
   * Example: `/api/signer/proxy` → remote `/generate-live-payment` when the suffix is empty.
   */
  proxyPathPrefix?: string;
  /** Remote path used when the proxied suffix is empty. Defaults to `/generate-live-payment`. */
  defaultRemotePath?: string;
  authenticate: (request: Request) => Promise<unknown>;
  resolveExternalUserId: (session: unknown) => Promise<string>;
  beforeSign?: (context: DirectSignerBeforeSignContext) => Promise<DirectSignerBeforeSignResult | void>;
}

export interface CachedSignerToken {
  jwt: string;
  expiresAt: number;
  refreshAt: number;
  balanceUsdMicros: string;
  lifetimeGrantedUsdMicros: string;
}

export interface DirectSignerBeforeSignContext {
  token: CachedSignerToken;
  externalUserId: string;
  request: Request;
}

export type DirectSignerBeforeSignResult = Response | { status: number; body?: unknown };

export interface MintUserSignerTokenOptions {
  issuerUrl: string;
  m2mClientId: string;
  m2mClientSecret: string;
  externalUserId: string;
  fetch?: FetchLike;
  allowInsecureHttp?: boolean;
}

export interface MintUserSignerTokenResponse {
  access_token: string;
  expires_in: number;
  balanceUsdMicros: string;
  lifetimeGrantedUsdMicros: string;
}

export interface SignerTokenManagerOptions {
  publicClientId: string;
  mint: (externalUserId: string) => Promise<CachedSignerToken>;
  /** Fraction of TTL after which a proactive refresh runs. Defaults to `0.8`. */
  ttlRefreshRatio?: number;
  fetch?: FetchLike;
}

export interface ForwardDirectSignerRequestOptions {
  request: Request;
  remoteSignerUrl: string | URL;
  jwt: string;
  proxyPathPrefix?: string;
  defaultRemotePath?: string;
  fetch?: FetchLike;
}

export interface ForwardToSignerOptions {
  baseUrl: string;
  path: string;
  method: string;
  body?: unknown;
  subject: string;
  getDmzToken: (subject: string, gate: SignerDmzGate) => Promise<string>;
  forwardJwt?: boolean;
  /** Merged after Authorization; used for go-livepeer trusted_headers identity. */
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
  fetch?: FetchLike;
}

export interface ForwardToSignerResult {
  response: Response;
  requestUrl: string;
  authorizationHeader?: string;
}

export interface ProbeSignerHttpReachabilityOptions {
  signerUrl: string;
  getDmzToken: (subject: string, gate: SignerDmzGate) => Promise<string>;
  probeSubject?: string;
  timeoutMs?: number;
  forwardJwt?: boolean;
  fetch?: FetchLike;
}

export interface SignerJwtIdentity {
  issuer: string;
  clientId: string;
  usageSubject: string;
  usageSubjectType: string;
}

export interface DeviceExchangeRequestBody {
  deviceToken: string;
  scope?: string;
  clientId?: string;
}

export interface DeviceExchangeResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  balanceUsdMicros: string;
  lifetimeGrantedUsdMicros: string;
  /** Public signer DMZ base URL clients should call directly (no trailing slash). */
  signerUrl?: string;
  token?: {
    accessToken: string;
    access_token: string;
    expiresIn: number;
    expires_in: number;
    scope: string;
    balanceUsdMicros: string;
    lifetimeGrantedUsdMicros: string;
  };
}

export interface ExchangeDeviceTokenForSignerOptions {
  facadeUrl: string;
  deviceToken: string;
  scope?: string;
  clientId?: string;
  fetch?: FetchLike;
}

export interface MintSignerTokenFromDeviceTokenOptions {
  issuerUrl: string;
  m2mClientId: string;
  m2mClientSecret: string;
  deviceToken: string;
  scope?: string;
  audience?: string;
  fetch?: FetchLike;
  allowInsecureHttp?: boolean;
}

export interface DeviceExchangeMintContext {
  scope?: string;
  clientId?: string;
}

export interface DeviceExchangeMintResult {
  access_token: string;
  expires_in: number;
  scope: string;
  balanceUsdMicros: string;
  lifetimeGrantedUsdMicros: string;
}

export interface DeviceExchangeHandlerConfig {
  mint: (
    deviceToken: string,
    context: DeviceExchangeMintContext,
  ) => Promise<DeviceExchangeMintResult>;
  /** Resolved signer DMZ base URL included in the exchange response. */
  getSignerUrl?: () => string | Promise<string>;
  signerUrl?: string;
}

export interface DeviceExchangeHandlerConfigWithM2M extends DeviceExchangeHandlerConfig {
  issuerUrl?: never;
  m2mClientId?: never;
  m2mClientSecret?: never;
}

export interface DeviceExchangeHandlerConfigRemote extends Omit<
  MintSignerTokenFromDeviceTokenOptions,
  "deviceToken"
> {
  mint?: never;
  getSignerUrl?: () => string | Promise<string>;
  signerUrl?: string;
}

export interface ApiKeyExchangeRequestBody {
  apiKey: string;
  scope?: string;
  clientId?: string;
}

export type ApiKeyExchangeMintResult = DeviceExchangeMintResult;

export interface ApiKeyExchangeHandlerConfig {
  issuerUrl: string;
  publicClientId: string;
  m2mClientId: string;
  m2mClientSecret: string;
  signerUrl?: string;
  audience?: string;
  fetch?: FetchLike;
  allowInsecureHttp?: boolean;
}

export interface ExchangeApiKeyForSignerOptions {
  facadeUrl: string;
  apiKey: string;
  scope?: string;
  clientId?: string;
  fetch?: FetchLike;
}

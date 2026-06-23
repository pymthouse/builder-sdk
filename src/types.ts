export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  device_authorization_endpoint?: string;
}

export interface GetDiscoveryOptions {
  /**
   * Bypass the in-memory discovery cache and fetch fresh metadata.
   */
  force?: boolean;
}

export interface PmtHouseClientOptions {
  issuerUrl: string;
  publicClientId: string;
  m2mClientId: string;
  m2mClientSecret: string;
  fetch?: FetchLike;
  /**
   * Allow HTTP issuer URLs (e.g. local dev). Passed to oauth4webapi as `allowInsecureRequests`.
   */
  allowInsecureHttp?: boolean;
  logger?: {
    debug?: (message: string, details?: Record<string, unknown>) => void;
    warn?: (message: string, details?: Record<string, unknown>) => void;
  };
}

export interface UpsertAppUserInput {
  externalUserId: string;
  email?: string;
  status?: "active" | "inactive";
}

export interface AppUserRecord {
  id: string;
  clientId: string;
  externalUserId: string;
  email: string | null;
  status: string;
  role: string;
  createdAt: string;
}

export interface MintUserAccessTokenInput {
  externalUserId: string;
  scope?: string;
}

export interface MintUserSignerSessionTokenInput extends MintUserAccessTokenInput {
  /**
   * Optional RFC 8707 resource indicator for the signer-session exchange.
   * Defaults to the configured PymtHouse issuer URL.
   */
  resource?: string;
}

export interface MintUserAccessTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  subject_type: "app_user";
  correlation_id?: string;
}

export interface DeviceApprovalInput {
  userJwt: string;
  userCode: string;
}

export interface TokenExchangeResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  issued_token_type: string;
  /** Remote signer DMZ base URL from facade exchange; call signer RPCs here directly. */
  signerUrl?: string;
}

export interface UsageQueryInput {
  startDate?: string;
  endDate?: string;
  groupBy?: "none" | "user" | "pipeline_model" | "daily_pipeline";
  userId?: string;
  gatewayRequestId?: string;
  /** When true, sends `include=retail` for estimated end-user billable amounts. */
  includeRetail?: boolean;
}

export interface UsageTotals {
  requestCount: number;
  totalFeeWei?: string;
  currency?: string;
  networkFeeUsdMicros?: string;
  ownerChargeUsdMicros?: string;
  platformFeeUsdMicros?: string;
  endUserBillableUsdMicros?: string;
}

export interface UsageByUserRow {
  endUserId: string;
  externalUserId: string | null;
  requestCount: number;
  feeWei?: string;
  currency?: string;
  networkFeeUsdMicros?: string;
  ownerChargeUsdMicros?: string;
  endUserBillableUsdMicros?: string;
  userType?: "system_managed" | "oidc_authorized" | "unknown";
  identifier?: string;
}

/** One bucket from Usage API `groupBy=pipeline_model` (validated pipeline + model). */
export interface UsageByPipelineModelRow {
  pipeline: string;
  modelId: string;
  requestCount: number;
  currency?: string;
  networkFeeWei?: string;
  networkFeeEth?: string;
  networkFeeUsdMicros: string;
  ownerChargeUsdMicros?: string;
  endUserBillableUsdMicros?: string;
  retailRateUsd?: string;
}

/** One UTC day bucket from Usage API `groupBy=daily_pipeline` (requires `userId`). */
export interface UsageDailyPipelineRow {
  pipeline: string;
  modelId: string;
  date: string;
  requestCount: number;
  currency?: string;
  networkFeeUsdMicros: string;
  ownerChargeUsdMicros?: string;
  endUserBillableUsdMicros?: string;
}

export interface UsageApiResponse {
  clientId: string;
  source?: "openmeter" | "postgres";
  period: {
    start: string | null;
    end: string | null;
  };
  totals: UsageTotals;
  byUser?: UsageByUserRow[];
  byPipelineModel?: UsageByPipelineModelRow[];
  byDailyPipeline?: UsageDailyPipelineRow[];
}

export type BillingSyncStatus = "not_applicable" | "pending" | "synced" | "error";

export interface BillingSyncState {
  status: BillingSyncStatus;
  syncedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  openmeterPlanId?: string | null;
  openmeterPlanVersion?: number | null;
}

export interface CapabilityPriceRule {
  pipeline: string;
  modelId: string;
  retailRateUsd: string | null;
  markupPercent: string | null;
  effectiveRetailRateUsd: string;
  featureKey: string;
}

export interface AllowancePolicy {
  includedUsdMicros: string | null;
  billingCycle: string;
}

export interface BillingProduct {
  id: string;
  clientId: string;
  name: string;
  type: string;
  status: string;
  priceAmount: string;
  priceCurrency: string;
  isNetworkDefault: boolean;
  isStarterDefault: boolean;
  allowance: AllowancePolicy;
  defaultRetailRateUsd: string | null;
  capabilities: CapabilityPriceRule[];
  sync: BillingSyncState;
}

export interface SignedTicketIngestInput {
  requestId: string;
  externalUserId: string;
  networkFeeUsdMicros: string;
  feeWei?: string;
  pixels?: string;
  pipeline?: string;
  modelId?: string;
  gatewayRequestId?: string;
  ethUsdPrice?: string;
  ethUsdRoundId?: string;
  ethUsdObservedAt?: string;
}

export interface SignedTicketIngestResult {
  ingested: boolean;
  duplicate: boolean;
  source: "openmeter" | "disabled";
}

/** OpenMeter entitlement balance from `GET .../usage/balance`. */
export interface UsageBalanceResponse {
  externalUserId: string;
  balanceUsdMicros: string;
  consumedUsdMicros: string;
  lifetimeGrantedUsdMicros: string;
  hasAccess: boolean;
  remainingUsdMicros?: string;
}

/** @deprecated Use {@link UsageBalanceResponse}. */
export type UserCreditsResponse = UsageBalanceResponse;

/** @deprecated Use {@link UserAllowanceGrantInput}. */
export type UserCreditGrantInput = UserAllowanceGrantInput;

export interface SignerRoutingConfig {
  signerApiUrl: string;
  remoteDmzUrl: string | null;
  jwksUri: string;
  identityMode: string;
  meteringMode: "platform_ingest";
}

export interface SignerRoutingResponse {
  clientId: string;
  routing: SignerRoutingConfig;
  patterns: {
    directDmz: {
      description: string;
      signerApiUrl: string;
      webhookUrl: string;
    };
    deprecatedHostedFacade: {
      description: string;
      signerApiUrl: string | null;
    };
  };
}

export type GrantSource = "trial" | "manual" | "promo" | "plan_adjustment";

export interface UserAllowanceGrantInput {
  amountUsdMicros: string;
  source?: GrantSource;
  featureKey?: string;
}

export interface UserAllowancesResponse {
  externalUserId: string;
  allowances: {
    balanceUsdMicros: string;
    consumedUsdMicros?: string;
    lifetimeGrantedUsdMicros?: string;
    hasAccess?: boolean;
  };
}

export interface UserSubscriptionResponse {
  externalUserId: string;
  subscription: {
    id: string;
    status: string;
    planId: string;
    planName: string | null;
    planType: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    openmeterSubscriptionId: string | null;
    stripeCheckoutSessionId: string | null;
    createdAt: string;
    cancelledAt: string | null;
  } | null;
}

export interface PlanSyncResult {
  planId: string;
  ok: boolean;
  sync: BillingSyncState;
  openmeterPlanId: string | null;
}

export interface ListBillingProductsResult {
  apiVersion: number;
  products: BillingProduct[];
}

/** Aggregated request count and fee for one provider `externalUserId` across duplicate `byUser` buckets. */
export interface UsageForExternalUser {
  externalUserId: string;
  requestCount: number;
  feeWei: string;
}

export interface ClientCredentialsTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in?: number;
  scope?: string;
  [key: string]: unknown;
}

export interface ParsedDeviceApprovalRedirect {
  issuer: string;
  targetLinkUri: string;
  userCode: string;
  clientId: string;
}

export interface AppManifestCapability {
  pipeline: string;
  modelId: string;
}

export interface AppManifestResponse {
  /** PymtHouse-local resolved set; informational, not a complete integrator allowlist. */
  capabilities: AppManifestCapability[];
  /** Authoritative exclusions from the Network Price plan. */
  excludedCapabilities?: AppManifestCapability[];
  /** Server-computed revision for cache busting when present. */
  manifestVersion?: string;
}

export interface GetAppManifestResult {
  manifest: AppManifestResponse | null;
  etag: string | null;
  notModified: boolean;
}

export interface UsageByPipelineModelFiatRow {
  pipeline: string;
  modelId: string;
  requestCount: number;
  currency: string;
  networkFeeUsdMicros: string;
  ownerChargeUsdMicros: string;
  endUserBillableUsdMicros: string;
}

export interface MeScopeUsagePayload {
  clientId: string;
  period: UsageApiResponse["period"];
  currentUser: {
    externalUserId: string;
    requestCount: number;
    currency: string;
    networkFeeUsdMicros: string;
    ownerChargeUsdMicros: string;
    endUserBillableUsdMicros: string;
    pipelineModels: UsageByPipelineModelFiatRow[];
    dailyByPipeline?: UsageDailyPipelineRow[];
  };
}

/** Self-scoped usage summary returned from `GET .../usage/me`. */
export type EndUserUsageSummary = Pick<
  MeScopeUsagePayload,
  "clientId" | "period" | "currentUser"
>;

export interface MintSignerSessionForExternalUserInput {
  externalUserId: string;
  email?: string;
  scope?: string;
}

export interface ApproveDeviceLoginInput {
  externalUserId: string;
  userCode: string;
  email?: string;
  publicClientId?: string;
}

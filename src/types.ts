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
  /** Remote signer DMZ base URL from exchange; call signer RPCs here directly. */
  signer_url?: string;
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

/** Every monetary field in the billing state carries its currency. */
export interface Money {
  usdMicros: string;
  usd: string;
  currency: string;
}

/**
 * Spend posture for a subject.
 * - `active` — credits or included plan usage remain
 * - `overage` — credits are gone; usage is invoiced as it accrues
 * - `at_risk` — an invoice is being collected and the buffer is running down
 * - `blocked` — requests are refused
 */
export type BillingStatus = "active" | "overage" | "at_risk" | "blocked";

/**
 * Why a subject is blocked. The same codes appear in the `reason` field of a
 * `402` token-mint rejection, so a rejection and a read never disagree.
 */
export type BillingReason =
  | "no_payment_method"
  | "overage_not_available"
  | "debt_ceiling_reached"
  | "billing_unavailable";

export type BillingNextAction =
  | "none"
  | "awaiting_settlement"
  | "add_payment_method"
  | "add_funds";

/** Whether unbilled debt is an invoice total or a meter-sum fallback. */
export type BillingDebtSource =
  | "gathering_invoice"
  | "meter_estimate"
  | "unavailable";

export type BillingCollector = "settlement_connect" | "openmeter_stripe";

export interface BillingState {
  asOf: string;
  subject: {
    type: "end_user" | "owner";
    externalUserId: string | null;
    billingMode: "merchant" | "owner_rollup";
  };
  status: BillingStatus;
  canSpend: boolean;
  reason: BillingReason | null;
  funding: {
    prepaid: Money;
    included: Money;
    spendable: Money;
    overage: {
      eligible: boolean;
      /** `0` means no ceiling. */
      ceiling: Money;
      unbilledDebt: Money | null;
      remaining: Money | null;
      utilizationBps: number | null;
      debtSource: BillingDebtSource;
    };
  };
  collection: {
    mode: "progressive_invoice";
    collector: BillingCollector;
    paymentMethod: {
      hasDefault: boolean | null;
      brand: string | null;
      last4: string | null;
    };
    nextAction: BillingNextAction;
    /** Debt level at which an invoice is raised automatically. */
    leadThreshold: Money;
    /** Below this an invoice cannot be collected, so none is raised. */
    minimumCharge: Money;
    cycle: string;
    collectionInterval: string;
    lastRaisedAt: string | null;
    nextRaiseEligibleAt: string | null;
  };
  explain: {
    headline: string;
    detail: string;
    docsUrl: string;
  };
}

export type BillingCollectOutcome =
  | "invoiced"
  | "skipped"
  | "rate_limited"
  | "unavailable"
  | "error";

export interface BillingCollectResponse {
  outcome: BillingCollectOutcome;
  invoiceIds: string[];
  billingState: BillingState;
}

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

/** Pending end-of-cycle cancel on an app end-user subscription. */
export interface AppUserPendingCancel {
  subscriptionId: string;
  planId: string | null;
  planKey: string | null;
  planName: string | null;
  effectiveAt: string | null;
}

/** Sane date range for cancel/change date pickers. */
export interface SubscriptionTimingOptions {
  minEffectiveAt: string;
  maxEffectiveAt: string | null;
  presets: Array<"immediate" | "next_billing_cycle">;
}

export type SubscriptionTiming =
  | "immediate"
  | "next_billing_cycle"
  | (string & {});

export interface UserSubscriptionResponse {
  externalUserId: string;
  /** Present when cancel-at-period-end is scheduled (owner-paid parity). */
  pendingCancel?: AppUserPendingCancel | null;
  /** Date-picker ranges for cancel / plan change. */
  timingOptions?: {
    cancel: SubscriptionTimingOptions;
    change: SubscriptionTimingOptions;
  } | null;
  subscription: {
    id: string;
    status: string;
    planId: string | null;
    planName: string | null;
    planType: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    openmeterSubscriptionId: string | null;
    stripeCheckoutSessionId: string | null;
    createdAt: string | null;
    cancelledAt: string | null;
  } | null;
}

/** One OpenMeter subscription row in an end-user's supersession history. */
export interface AppUserSubscriptionHistoryItem {
  id: string;
  status: string;
  /** True when this row is the live (active/trialing) subscription. */
  current: boolean;
  planId: string | null;
  planName: string | null;
  planKey: string | null;
  openmeterPlanId: string | null;
  activeFrom: string | null;
  activeTo: string | null;
}

/** Result of `GET …/users/{id}/subscriptions` (plan change history). */
export interface ListAppUserSubscriptionsResult {
  items: AppUserSubscriptionHistoryItem[];
  externalUserId: string;
}

/** Result of `DELETE …/users/{id}/subscription` (schedule cancel). */
export interface CancelAppUserSubscriptionResult {
  subscriptionId: string;
  planId: string | null;
  planKey: string | null;
  scheduledPlanKey: string | null;
  effectiveAt: string | null;
  alreadyStarter?: boolean;
  alreadyScheduled?: boolean;
}

/** Result of plan change `POST …/subscription/change`. */
export interface ChangeAppUserSubscriptionResult {
  subscriptionId: string;
  planId: string;
  effectiveAt: string | null;
  timing: SubscriptionTiming;
  checkoutUrl?: string;
}

/** Structured 409 when a scheduled successor blocks plan change. */
export interface ScheduledChangeConflict {
  code: "scheduled_change_exists";
  error: string;
  timingOptions: SubscriptionTimingOptions | null;
  scheduledSubscriptionId: string | null;
  scheduledPlanKey: string | null;
  scheduledActiveFrom: string | null;
}

/** Result of `DELETE …/users/{id}/subscription/pending-change` (resume). */
export interface ResumeAppUserSubscriptionResult {
  resumed: true;
  subscriptionId: string;
  planId: string | null;
  planKey: string | null;
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

/** Input for `POST …/apps/{clientId}/billing/checkout`. */
export interface CreateBillingCheckoutInput {
  planId: string;
  externalUserId: string;
  successUrl?: string;
  cancelUrl?: string;
}

/** Stripe Checkout session started for an end-user subscription. */
export interface CreateBillingCheckoutResult {
  checkoutUrl: string;
  /** OpenMeter subscription ID when the provider creates it before redirect. */
  subscriptionId?: string;
}

/** One OpenMeter invoice for an app end-user (`GET …/users/{id}/invoices`). */
export interface AppUserInvoice {
  id: string;
  number?: string;
  status: string;
  currency: string;
  totalAmount: string;
  customerId?: string;
  customerKey?: string;
  issuedAt?: string;
  periodStart?: string;
  periodEnd?: string;
  externalInvoicingId?: string;
  invoiceType?: string;
}

export interface ListAppUserInvoicesResult {
  items: AppUserInvoice[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface AppUserInvoiceHostedUrlResult {
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

/** Card (or Link) on the app end-user Stripe customer. */
export interface AppUserPaymentMethod {
  id: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
}

export interface ListAppUserPaymentMethodsResult {
  paymentMethods: AppUserPaymentMethod[];
}

export interface CreateAppUserPaymentMethodCheckoutInput {
  externalUserId: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CreateAppUserPaymentMethodCheckoutResult {
  checkoutUrl: string;
  sessionId: string | null;
  customerId: string;
  hasDefaultPaymentMethod: boolean;
}

export interface AppUserPaymentMethodMutationResult {
  paymentMethodId: string | null;
}

export interface SetAppUserDefaultPaymentMethodResult
  extends AppUserPaymentMethodMutationResult {
  updated: boolean;
}

export interface UnlinkAppUserPaymentMethodResult
  extends AppUserPaymentMethodMutationResult {
  unlinked: boolean;
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

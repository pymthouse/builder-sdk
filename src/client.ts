import {
  allowInsecureRequests,
  clientCredentialsGrantRequest,
  customFetch,
  genericTokenEndpointRequest,
  processClientCredentialsResponse,
  processGenericTokenEndpointResponse,
  type ClientAuth,
  type ClientCredentialsGrantRequestOptions,
  type TokenEndpointRequestOptions,
} from "oauth4webapi";
import { encodeClientSecretBasic } from "./encoding.js";
import { loadAuthorizationServer, authorizationServerToOidcDocument } from "./discovery.js";
import { PmtHouseError } from "./errors.js";
import { parseExternalUserId } from "./external-user-id.js";
import { parseAppManifestResponse } from "./manifest.js";
import { stripTrailingSlashes } from "./string-utils.js";
import { SIGN_JOB_SCOPE, parseSignerSessionExchange } from "./tokens.js";
import type { SignerSessionToken } from "./tokens.js";
import {
  buildMeScopeUsagePayload,
} from "./usage.js";
import {
  mapOAuthError,
  m2mClient,
  tokenEndpointResponseToClientCredentials,
  tokenEndpointResponseToExchange,
} from "./oauth-map.js";
import type {
  AppUserRecord,
  ApproveDeviceLoginInput,
  ClientCredentialsTokenResponse,
  DeviceApprovalInput,
  FetchLike,
  GetAppManifestResult,
  GetDiscoveryOptions,
  MeScopeUsagePayload,
  MintSignerSessionForExternalUserInput,
  MintUserSignerSessionTokenInput,
  MintUserAccessTokenInput,
  MintUserAccessTokenResponse,
  OidcDiscoveryDocument,
  ParsedDeviceApprovalRedirect,
  PmtHouseClientOptions,
  TokenExchangeResponse,
  UpsertAppUserInput,
  AppUserInvoiceHostedUrlResult,
  BillingProduct,
  CreateAppUserPaymentMethodCheckoutInput,
  CreateAppUserPaymentMethodCheckoutResult,
  CreateBillingCheckoutInput,
  CreateBillingCheckoutResult,
  BillingCollectResponse,
  BillingState,
  ListAppUserInvoicesResult,
  ListAppUserPaymentMethodsResult,
  ListAppUserSubscriptionsResult,
  ListBillingProductsResult,
  PlanSyncResult,
  SignerRoutingResponse,
  SignedTicketIngestInput,
  SignedTicketIngestResult,
  SetAppUserDefaultPaymentMethodResult,
  UnlinkAppUserPaymentMethodResult,
  UsageApiResponse,
  UsageQueryInput,
  UsageBalanceResponse,
  UserAllowanceGrantInput,
  UserAllowancesResponse,
  CancelAppUserSubscriptionResult,
  ChangeAppUserSubscriptionResult,
  ResumeAppUserSubscriptionResult,
  SubscriptionTiming,
  UserSubscriptionResponse,
} from "./types.js";
import {
  ingestSignedTicket,
  ingestSignedTicketsBatch,
} from "./ingest.js";

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const SUBJECT_ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const REQUESTED_ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

const DEVICE_RESOURCE_PREFIX = "urn:pmth:device_code:";

/**
 * Normalize RFC 8628 user codes for comparison and resource URIs (uppercase, strip separators).
 */
export function normalizeUserCode(value: string): string {
  return value
    .replace(/[a-z]/g, (char) => char.toUpperCase())
    .replace(/\W/g, "");
}

/**
 * RFC 8707 resource indicator for NaaP Option B device approval (`urn:pmth:device_code:<normalized>`).
 */
export function buildDeviceCodeResource(userCode: string): string {
  return `${DEVICE_RESOURCE_PREFIX}${normalizeUserCode(userCode)}`;
}

export class PmtHouseClient {
  private readonly issuerUrl: string;
  private readonly publicClientId: string;
  private readonly m2mClientId: string;
  private readonly m2mClientSecret: string;
  private readonly fetchImpl: FetchLike;
  private readonly logger: PmtHouseClientOptions["logger"];
  private readonly allowInsecureHttp: boolean;

  constructor(options: PmtHouseClientOptions) {
    this.issuerUrl = stripTrailingSlashes(options.issuerUrl);
    this.publicClientId = options.publicClientId;
    this.m2mClientId = options.m2mClientId;
    this.m2mClientSecret = options.m2mClientSecret;
    this.fetchImpl = options.fetch ?? fetch;
    this.logger = options.logger;
    this.allowInsecureHttp = options.allowInsecureHttp ?? false;
  }

  async getDiscovery(options: GetDiscoveryOptions = {}): Promise<OidcDiscoveryDocument> {
    const as = await loadAuthorizationServer(this.issuerUrl, this.fetchImpl, {
      force: options.force,
      allowInsecureHttp: this.allowInsecureHttp,
    });
    return authorizationServerToOidcDocument(as);
  }

  verifyIssuer(iss: string): boolean {
    const candidate = stripTrailingSlashes(iss.trim());
    return candidate === this.issuerUrl;
  }

  parseDeviceApprovalRedirect(
    searchParams: URLSearchParams,
  ): ParsedDeviceApprovalRedirect {
    const issuer = searchParams.get("iss")?.trim() ?? "";
    const targetLinkUri = searchParams.get("target_link_uri")?.trim() ?? "";

    if (!issuer || !targetLinkUri) {
      throw new PmtHouseError("Missing iss or target_link_uri", {
        status: 400,
        code: "invalid_request",
      });
    }

    if (!this.verifyIssuer(issuer)) {
      throw new PmtHouseError("Issuer mismatch for initiate login", {
        status: 400,
        code: "invalid_issuer",
      });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(targetLinkUri);
    } catch {
      throw new PmtHouseError("target_link_uri is not a valid URL", {
        status: 400,
        code: "invalid_target",
      });
    }

    const issuerOrigin = new URL(this.issuerUrl).origin;
    if (targetUrl.origin !== issuerOrigin || targetUrl.pathname !== "/oidc/device") {
      throw new PmtHouseError(
        "target_link_uri does not point to the issuer device path",
        {
          status: 400,
          code: "invalid_target",
        },
      );
    }

    const userCode = normalizeUserCode(targetUrl.searchParams.get("user_code") ?? "");
    const clientId = targetUrl.searchParams.get("client_id")?.trim() ?? "";

    if (!userCode || !clientId) {
      throw new PmtHouseError("target_link_uri is missing user_code or client_id", {
        status: 400,
        code: "invalid_target",
      });
    }

    return {
      issuer,
      targetLinkUri,
      userCode,
      clientId,
    };
  }

  async listAppUsers(): Promise<{ users: AppUserRecord[] }> {
    const url = `${this.getAppsBaseUrl()}/users`;
    return this.requestJson<{ users: AppUserRecord[] }>(url, {
      method: "GET",
      headers: this.builderHeaders(),
      cache: "no-store",
    });
  }

  async upsertAppUser(input: UpsertAppUserInput): Promise<AppUserRecord> {
    const externalUserId = parseExternalUserId(input.externalUserId);
    const payload: Record<string, unknown> = {
      externalUserId,
    };
    if (input.email) payload.email = input.email;
    if (input.status) payload.status = input.status;

    const url = `${this.getAppsBaseUrl()}/users`;
    return this.requestJson<AppUserRecord>(url, {
      method: "POST",
      headers: this.builderHeaders(),
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  }

  async deleteAppUser(params: { externalUserId: string }): Promise<{ success: boolean }> {
    const externalUserId = parseExternalUserId(params.externalUserId);
    const url = new URL(`${this.getAppsBaseUrl()}/users`);
    url.searchParams.set("externalUserId", externalUserId);
    return this.requestJson<{ success: boolean }>(url.toString(), {
      method: "DELETE",
      headers: this.builderHeaders(),
      cache: "no-store",
    });
  }

  async mintUserAccessToken(
    input: MintUserAccessTokenInput,
  ): Promise<MintUserAccessTokenResponse> {
    const externalUserId = parseExternalUserId(input.externalUserId);
    const url = `${this.getAppsBaseUrl()}/users/${encodeURIComponent(externalUserId)}/token`;
    const body = input.scope ? { scope: input.scope } : {};

    return this.requestJson<MintUserAccessTokenResponse>(url, {
      method: "POST",
      headers: this.builderHeaders(),
      body: JSON.stringify(body),
      cache: "no-store",
    });
  }

  /**
   * Exchange a long-lived API key (bare `pmth_*` or composite `app_<24hex>_<secret>`)
   * for a short-lived signer JWT via app-scoped RFC 8693 token exchange.
   */
  async exchangeApiKeyForUserAccessToken(input: {
    apiKey: string;
    scope?: string;
  }): Promise<MintUserAccessTokenResponse> {
    const { mintSignerSessionFromApiKeyDirect } = await import("./signer/api-key-exchange.js");
    const minted = await mintSignerSessionFromApiKeyDirect({
      issuerUrl: this.issuerUrl,
      publicClientId: this.publicClientId,
      apiKey: input.apiKey,
      scope: input.scope,
      m2mClientId: this.m2mClientId,
      m2mClientSecret: this.m2mClientSecret,
      fetch: this.fetchImpl,
    });
    return {
      access_token: minted.access_token,
      refresh_token: "",
      token_type: "Bearer",
      expires_in: minted.expires_in,
      scope: minted.scope,
      subject_type: "app_user",
    };
  }

  /**
   * Exchange a dashboard API key for a short-lived signer JWT via a trusted facade.
   *
   * `facadeUrl` is used only for `POST {facadeUrl}/api/pymthouse/keys/exchange`.
   * After exchange, call signer RPCs directly at `signerUrl` from the response
   * (e.g. `{signerUrl}/sign-orchestrator-info`), not via dashboard `/api/signer/*`.
   *
   * When M2M credentials are available on this client, omit `facadeUrl` to exchange
   * directly against the PymtHouse issuer (`POST …/apps/{clientId}/oidc/token`).
   */
  async exchangeApiKeyForSignerSession(input: {
    apiKey: string;
    scope?: string;
    facadeUrl?: string;
  }): Promise<TokenExchangeResponse> {
    if (input.facadeUrl?.trim()) {
      const { exchangeApiKeyForSigner } = await import("./signer/api-key-exchange.js");
      const exchanged = await exchangeApiKeyForSigner({
        facadeUrl: input.facadeUrl.trim(),
        apiKey: input.apiKey,
        scope: input.scope,
        clientId: this.publicClientId,
        fetch: this.fetchImpl,
      });
      return {
        access_token: exchanged.access_token,
        token_type: exchanged.token_type,
        expires_in: exchanged.expires_in,
        scope: exchanged.scope,
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        signer_url: exchanged.signer_url,
      };
    }

    const { mintSignerSessionFromApiKeyDirect } = await import("./signer/api-key-exchange.js");
    const exchanged = await mintSignerSessionFromApiKeyDirect({
      issuerUrl: this.issuerUrl,
      publicClientId: this.publicClientId,
      apiKey: input.apiKey,
      scope: input.scope,
      m2mClientId: this.m2mClientId,
      m2mClientSecret: this.m2mClientSecret,
      fetch: this.fetchImpl,
    });
    return {
      access_token: exchanged.access_token,
      token_type: exchanged.token_type,
      expires_in: exchanged.expires_in,
      scope: exchanged.scope,
      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
      signer_url: exchanged.signer_url,
    };
  }

  async completeDeviceApproval(
    input: DeviceApprovalInput,
  ): Promise<TokenExchangeResponse> {
    const as = await loadAuthorizationServer(this.issuerUrl, this.fetchImpl, {
      allowInsecureHttp: this.allowInsecureHttp,
    });
    const client = m2mClient(this.m2mClientId);
    const clientAuth = this.m2mClientAuth();
    const params = new URLSearchParams();
    params.set("subject_token", input.userJwt);
    params.set("subject_token_type", SUBJECT_ACCESS_TOKEN_TYPE);
    params.set("resource", buildDeviceCodeResource(input.userCode));

    try {
      const response = await genericTokenEndpointRequest(
        as,
        client,
        clientAuth,
        TOKEN_EXCHANGE_GRANT,
        params,
        this.tokenEndpointFetchOptions(),
      );
      const tr = await processGenericTokenEndpointResponse(
        as,
        client,
        response,
      );
      return tokenEndpointResponseToExchange(tr);
    } catch (e) {
      throw mapOAuthError(e);
    }
  }

  async issueMachineAccessToken(
    scope = "sign:job",
  ): Promise<ClientCredentialsTokenResponse> {
    const as = await loadAuthorizationServer(this.issuerUrl, this.fetchImpl, {
      allowInsecureHttp: this.allowInsecureHttp,
    });
    const client = m2mClient(this.m2mClientId);
    const clientAuth = this.m2mClientAuth();
    const params = new URLSearchParams();
    params.set("scope", scope);

    try {
      const response = await clientCredentialsGrantRequest(
        as,
        client,
        clientAuth,
        params,
        this.tokenEndpointFetchOptions(),
      );
      const tr = await processClientCredentialsResponse(
        as,
        client,
        response,
      );
      return tokenEndpointResponseToClientCredentials(tr);
    } catch (e) {
      throw mapOAuthError(e);
    }
  }

  async exchangeForSignerSession(input: {
    userJwt: string;
    resource?: string;
    /**
     * When true, omit the RFC 8707 `resource` parameter entirely. This selects
     * the documented PymtHouse gateway/opaque signer-session exchange
     * (long-lived `pmth_*` token) rather than the signer-JWT path that a
     * `resource = issuer` indicator routes to. Takes precedence over
     * {@link resource}.
     */
    omitResource?: boolean;
    /** Optional `scope` for the exchange (e.g. `sign:job`). Omitted when unset. */
    scope?: string;
  }): Promise<TokenExchangeResponse> {
    const as = await loadAuthorizationServer(this.issuerUrl, this.fetchImpl, {
      allowInsecureHttp: this.allowInsecureHttp,
    });
    const client = m2mClient(this.m2mClientId);
    const clientAuth = this.m2mClientAuth();
    const params = new URLSearchParams();
    params.set("subject_token", input.userJwt);
    params.set("subject_token_type", SUBJECT_ACCESS_TOKEN_TYPE);
    params.set("requested_token_type", REQUESTED_ACCESS_TOKEN_TYPE);
    if (typeof input.scope === "string" && input.scope.trim() !== "") {
      params.set("scope", input.scope.trim());
    }
    if (!input.omitResource) {
      const resourceCandidate =
        typeof input.resource === "string" && input.resource.trim() !== ""
          ? input.resource.trim()
          : this.issuerUrl;
      params.set("resource", stripTrailingSlashes(resourceCandidate));
    }

    try {
      const response = await genericTokenEndpointRequest(
        as,
        client,
        clientAuth,
        TOKEN_EXCHANGE_GRANT,
        params,
        this.tokenEndpointFetchOptions(),
      );
      const tr = await processGenericTokenEndpointResponse(
        as,
        client,
        response,
      );
      return tokenEndpointResponseToExchange(tr);
    } catch (e) {
      throw mapOAuthError(e);
    }
  }

  /**
   * Mint a short-lived per-user JWT with the Builder API, then exchange it for
   * a long-lived opaque signer session token at the PymtHouse OIDC token endpoint.
   */
  async mintUserSignerSessionToken(
    input: MintUserSignerSessionTokenInput,
  ): Promise<TokenExchangeResponse> {
    const userToken = await this.mintUserAccessToken({
      externalUserId: input.externalUserId,
      scope: input.scope ?? "sign:job",
    });

    return this.exchangeForSignerSession({
      userJwt: userToken.access_token,
      resource: input.resource,
    });
  }

  async createSignerSessionToken(params: {
    userJwt?: string;
  }): Promise<TokenExchangeResponse> {
    if (params.userJwt) {
      try {
        return await this.exchangeForSignerSession({ userJwt: params.userJwt });
      } catch (error) {
        const err = this.asError(error);
        this.logger?.warn?.("User JWT exchange failed, falling back to machine exchange", {
          code: err.code,
          status: err.status,
        });
      }
    }

    const machineToken = await this.issueMachineAccessToken("sign:job");
    if (!machineToken.access_token) {
      throw new PmtHouseError("Client credentials flow did not return access_token", {
        status: 502,
        code: "invalid_token_response",
      });
    }

    return this.exchangeForSignerSession({ userJwt: machineToken.access_token });
  }

  async getUsage(input: UsageQueryInput = {}): Promise<UsageApiResponse> {
    const url = new URL(`${this.getAppsBaseUrl()}/usage`);
    if (input.startDate) url.searchParams.set("startDate", input.startDate);
    if (input.endDate) url.searchParams.set("endDate", input.endDate);
    if (input.groupBy) url.searchParams.set("groupBy", input.groupBy);
    if (input.userId) {
      url.searchParams.set("userId", parseExternalUserId(input.userId));
    }
    if (input.gatewayRequestId) url.searchParams.set("gatewayRequestId", input.gatewayRequestId);
    if (input.includeRetail) url.searchParams.set("include", "retail");

    return this.requestJson<UsageApiResponse>(url.toString(), {
      method: "GET",
      headers: this.builderHeaders(),
      cache: "no-store",
    });
  }

  /**
   * Session-scoped usage for one `externalUserId`: user rollup plus merged pipeline/model breakdown.
   */
  async ingestSignedTicket(ticket: SignedTicketIngestInput): Promise<SignedTicketIngestResult> {
    return ingestSignedTicket({
      issuerUrl: this.issuerUrl,
      publicClientId: this.publicClientId,
      m2mClientId: this.m2mClientId,
      m2mClientSecret: this.m2mClientSecret,
      ticket,
      fetch: this.fetchImpl,
    });
  }

  async ingestSignedTickets(
    tickets: SignedTicketIngestInput[],
  ): Promise<{ results: Array<SignedTicketIngestResult & { requestId?: string; ok?: boolean }> }> {
    return ingestSignedTicketsBatch({
      issuerUrl: this.issuerUrl,
      publicClientId: this.publicClientId,
      m2mClientId: this.m2mClientId,
      m2mClientSecret: this.m2mClientSecret,
      tickets,
      fetch: this.fetchImpl,
    });
  }

  async getSignerRouting(): Promise<SignerRoutingResponse> {
    return this.requestJson<SignerRoutingResponse>(
      `${this.getAppsBaseUrl()}/signer/routing`,
      {
        method: "GET",
        headers: this.builderHeaders(),
        cache: "no-store",
      },
    );
  }

  async listBillingProducts(): Promise<ListBillingProductsResult> {
    const url = `${this.getAppsBaseUrl()}/plans?apiVersion=2`;
    const body = await this.requestJson<ListBillingProductsResult & { plans?: BillingProduct[] }>(
      url,
      {
        method: "GET",
        headers: this.builderHeaders(),
        cache: "no-store",
      },
    );
    return {
      apiVersion: body.apiVersion ?? 2,
      products: body.products ?? body.plans ?? [],
    };
  }

  async syncBillingProduct(planId: string): Promise<PlanSyncResult> {
    return this.requestJson<PlanSyncResult>(
      `${this.getAppsBaseUrl()}/plans/${encodeURIComponent(planId)}/sync`,
      {
        method: "POST",
        headers: this.builderHeaders(),
        cache: "no-store",
      },
    );
  }

  /**
   * Start end-user Stripe Checkout for a subscription plan
   * (`POST …/apps/{clientId}/billing/checkout`).
   * Returns the Checkout URL; pymthouse creates the OpenMeter subscription
   * before redirecting.
   */
  async createBillingCheckout(
    input: CreateBillingCheckoutInput,
  ): Promise<CreateBillingCheckoutResult> {
    const planId = input.planId.trim();
    const externalUserId = parseExternalUserId(input.externalUserId);
    if (!planId) {
      throw new PmtHouseError("planId is required", {
        status: 400,
        code: "invalid_request",
      });
    }

    const body: Record<string, string> = { planId, externalUserId };
    const successUrl = input.successUrl?.trim();
    const cancelUrl = input.cancelUrl?.trim();
    if (successUrl) body.successUrl = successUrl;
    if (cancelUrl) body.cancelUrl = cancelUrl;

    const result = await this.requestJson<CreateBillingCheckoutResult>(
      `${this.getAppsBaseUrl()}/billing/checkout`,
      {
        method: "POST",
        headers: this.builderHeaders(),
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );

    const checkoutUrl = result.checkoutUrl?.trim() ?? "";
    if (!checkoutUrl) {
      throw new PmtHouseError("Checkout response missing checkoutUrl", {
        status: 502,
        code: "invalid_response",
        details: result,
      });
    }

    const subscriptionId = result.subscriptionId?.trim();
    return {
      checkoutUrl,
      ...(subscriptionId ? { subscriptionId } : {}),
    };
  }

  async getUsageBalance(externalUserId: string): Promise<UsageBalanceResponse> {
    const validated = parseExternalUserId(externalUserId);
    try {
      const token = await this.ensureEndUserAccessToken(validated);
      return await this.getEndUserUsageBalance(token.access_token);
    } catch {
      const url = new URL(`${this.getAppsBaseUrl()}/usage/balance`);
      url.searchParams.set("externalUserId", validated);
      return this.requestJson<UsageBalanceResponse>(url.toString(), {
        method: "GET",
        headers: this.builderHeaders(),
        cache: "no-store",
      });
    }
  }

  /**
   * Spend posture for a subject: whether it can spend, how much room is left,
   * and what happens next. Merchant apps must pass `externalUserId`.
   */
  async getBillingState(externalUserId?: string): Promise<BillingState> {
    const url = new URL(`${this.getAppsBaseUrl()}/billing/state`);
    if (externalUserId) {
      url.searchParams.set("externalUserId", parseExternalUserId(externalUserId));
    }
    return this.requestJson<BillingState>(url.toString(), {
      method: "GET",
      headers: this.builderHeaders(),
      cache: "no-store",
    });
  }

  /**
   * Raise an invoice for the subject's unbilled usage now rather than waiting
   * for the automatic trigger or the daily collection sweep. Idempotent within
   * a short cooldown; repeat calls return `rate_limited` with current state.
   */
  async collectBilling(externalUserId: string): Promise<BillingCollectResponse> {
    return this.requestJson<BillingCollectResponse>(
      `${this.getAppsBaseUrl()}/billing/collect`,
      {
        method: "POST",
        headers: this.builderHeaders(),
        body: JSON.stringify({
          externalUserId: parseExternalUserId(externalUserId),
        }),
        cache: "no-store",
      },
    );
  }

  async getUserAllowances(externalUserId: string): Promise<UserAllowancesResponse> {
    const validated = parseExternalUserId(externalUserId);
    return this.requestJson<UserAllowancesResponse>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/allowances`,
      {
        method: "GET",
        headers: this.builderHeaders(),
        cache: "no-store",
      },
    );
  }

  async grantUserAllowance(
    externalUserId: string,
    input: UserAllowanceGrantInput,
  ): Promise<UserAllowancesResponse & { grantedUsdMicros?: string; featureKey?: string }> {
    const validated = parseExternalUserId(externalUserId);
    return this.requestJson(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/allowances`,
      {
        method: "POST",
        headers: this.builderHeaders(),
        body: JSON.stringify(input),
        cache: "no-store",
      },
    );
  }

  async getUserSubscription(externalUserId: string): Promise<UserSubscriptionResponse> {
    const validated = parseExternalUserId(externalUserId);
    return this.requestJson<UserSubscriptionResponse>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/subscription`,
      {
        method: "GET",
        headers: this.builderHeaders(),
        cache: "no-store",
      },
    );
  }

  /**
   * List OpenMeter subscription supersession history for an app end-user
   * (`GET …/users/{externalUserId}/subscriptions`).
   */
  async listUserSubscriptions(
    externalUserId: string,
  ): Promise<ListAppUserSubscriptionsResult> {
    const validated = parseExternalUserId(externalUserId);
    return this.requestJson<ListAppUserSubscriptionsResult>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/subscriptions`,
      {
        method: "GET",
        headers: this.builderHeaders(),
        cache: "no-store",
      },
    );
  }

  /**
   * Schedule cancel for an app end-user
   * (`DELETE …/users/{externalUserId}/subscription` with `{ confirm: true }`).
   * Optional `timing` / `effectiveAt` pick when the plan ends.
   */
  async cancelUserSubscription(
    externalUserId: string,
    opts?: {
      confirm?: boolean;
      timing?: SubscriptionTiming;
      effectiveAt?: string;
    },
  ): Promise<CancelAppUserSubscriptionResult> {
    const validated = parseExternalUserId(externalUserId);
    return this.requestJson<CancelAppUserSubscriptionResult>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/subscription`,
      {
        method: "DELETE",
        headers: this.builderHeaders(),
        body: JSON.stringify({
          confirm: opts?.confirm ?? true,
          ...(opts?.timing ? { timing: opts.timing } : {}),
          ...(opts?.effectiveAt ? { effectiveAt: opts.effectiveAt } : {}),
        }),
        cache: "no-store",
      },
    );
  }

  /**
   * Change an app end-user's plan
   * (`POST …/users/{externalUserId}/subscription/change`).
   * When a scheduled successor exists, pass timing / effectiveAt /
   * confirmReplaceScheduled after prompting the user.
   */
  async changeUserSubscription(
    externalUserId: string,
    input: {
      planId: string;
      timing?: SubscriptionTiming;
      effectiveAt?: string;
      confirmReplaceScheduled?: boolean;
      successUrl?: string;
      cancelUrl?: string;
    },
  ): Promise<ChangeAppUserSubscriptionResult> {
    const validated = parseExternalUserId(externalUserId);
    const planId = input.planId.trim();
    if (!planId) {
      throw new PmtHouseError("planId is required", {
        status: 400,
        code: "invalid_request",
      });
    }
    return this.requestJson<ChangeAppUserSubscriptionResult>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/subscription/change`,
      {
        method: "POST",
        headers: this.builderHeaders(),
        body: JSON.stringify({
          planId,
          ...(input.timing ? { timing: input.timing } : {}),
          ...(input.effectiveAt ? { effectiveAt: input.effectiveAt } : {}),
          ...(input.confirmReplaceScheduled
            ? { confirmReplaceScheduled: true }
            : {}),
          ...(input.successUrl ? { successUrl: input.successUrl } : {}),
          ...(input.cancelUrl ? { cancelUrl: input.cancelUrl } : {}),
        }),
        cache: "no-store",
      },
    );
  }

  /**
   * Undo a scheduled end-of-cycle cancel
   * (`DELETE …/users/{externalUserId}/subscription/pending-change`).
   */
  async resumeUserSubscription(
    externalUserId: string,
    opts?: { confirm?: boolean },
  ): Promise<ResumeAppUserSubscriptionResult> {
    const validated = parseExternalUserId(externalUserId);
    return this.requestJson<ResumeAppUserSubscriptionResult>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/subscription/pending-change`,
      {
        method: "DELETE",
        headers: this.builderHeaders(),
        body: JSON.stringify({ confirm: opts?.confirm ?? true }),
        cache: "no-store",
      },
    );
  }

  /**
   * List OpenMeter invoices for an app end-user
   * (`GET …/users/{externalUserId}/invoices`).
   */
  async listUserInvoices(
    externalUserId: string,
    opts?: { page?: number; pageSize?: number },
  ): Promise<ListAppUserInvoicesResult> {
    const validated = parseExternalUserId(externalUserId);
    const url = new URL(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/invoices`,
    );
    if (opts?.page != null) url.searchParams.set("page", String(opts.page));
    if (opts?.pageSize != null) {
      url.searchParams.set("pageSize", String(opts.pageSize));
    }
    return this.requestJson<ListAppUserInvoicesResult>(url.toString(), {
      method: "GET",
      headers: this.builderHeaders(),
      cache: "no-store",
    });
  }

  /**
   * Resolve Stripe hosted invoice URL / PDF for one end-user invoice
   * (`GET …/users/{externalUserId}/invoices/{invoiceId}/hosted-url`).
   */
  async getUserInvoiceHostedUrl(
    externalUserId: string,
    invoiceId: string,
  ): Promise<AppUserInvoiceHostedUrlResult> {
    const validated = parseExternalUserId(externalUserId);
    const id = invoiceId.trim();
    if (!id) {
      throw new PmtHouseError("invoiceId is required", {
        status: 400,
        code: "invalid_request",
      });
    }
    return this.requestJson<AppUserInvoiceHostedUrlResult>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/invoices/${encodeURIComponent(id)}/hosted-url`,
      {
        method: "GET",
        headers: this.builderHeaders(),
        cache: "no-store",
      },
    );
  }

  /**
   * List payment methods on the app end-user Stripe customer
   * (`GET …/users/{externalUserId}/payment-methods`).
   */
  async listUserPaymentMethods(
    externalUserId: string,
  ): Promise<ListAppUserPaymentMethodsResult> {
    const validated = parseExternalUserId(externalUserId);
    return this.requestJson<ListAppUserPaymentMethodsResult>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/payment-methods`,
      {
        method: "GET",
        headers: this.builderHeaders(),
        cache: "no-store",
      },
    );
  }

  /**
   * Start setup-only Stripe Checkout for an app end-user payment method
   * (`POST …/users/{externalUserId}/payment-methods`). Does not change plan.
   */
  async createUserPaymentMethodCheckout(
    input: CreateAppUserPaymentMethodCheckoutInput,
  ): Promise<CreateAppUserPaymentMethodCheckoutResult> {
    const validated = parseExternalUserId(input.externalUserId);
    const body: Record<string, string> = {};
    const successUrl = input.successUrl?.trim();
    const cancelUrl = input.cancelUrl?.trim();
    if (successUrl) body.successUrl = successUrl;
    if (cancelUrl) body.cancelUrl = cancelUrl;

    const result = await this.requestJson<CreateAppUserPaymentMethodCheckoutResult>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/payment-methods`,
      {
        method: "POST",
        headers: this.builderHeaders(),
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );

    const checkoutUrl = result.checkoutUrl?.trim() ?? "";
    if (!checkoutUrl) {
      throw new PmtHouseError("Payment method checkout missing checkoutUrl", {
        status: 502,
        code: "invalid_response",
        details: result,
      });
    }
    return {
      ...result,
      checkoutUrl,
    };
  }

  /** Set the app user's default method on their active billing customer. */
  async setUserDefaultPaymentMethod(
    externalUserId: string,
    paymentMethodId: string,
  ): Promise<SetAppUserDefaultPaymentMethodResult> {
    const validated = parseExternalUserId(externalUserId);
    const id = paymentMethodId.trim();
    if (!id) {
      throw new PmtHouseError("paymentMethodId is required", {
        status: 400,
        code: "invalid_request",
      });
    }
    return this.requestJson<SetAppUserDefaultPaymentMethodResult>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/payment-methods`,
      {
        method: "PATCH",
        headers: this.builderHeaders(),
        body: JSON.stringify({ paymentMethodId: id }),
        cache: "no-store",
      },
    );
  }

  /**
   * Promote the first attached card to default when none is set
   * (`PATCH …/payment-methods` with `{ ensureDefault: true }`).
   */
  async ensureUserDefaultPaymentMethod(
    externalUserId: string,
  ): Promise<SetAppUserDefaultPaymentMethodResult> {
    const validated = parseExternalUserId(externalUserId);
    return this.requestJson<SetAppUserDefaultPaymentMethodResult>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/payment-methods`,
      {
        method: "PATCH",
        headers: this.builderHeaders(),
        body: JSON.stringify({ ensureDefault: true }),
        cache: "no-store",
      },
    );
  }

  /** Detach one method from the app user's active billing customer. */
  async unlinkUserPaymentMethod(
    externalUserId: string,
    paymentMethodId: string,
  ): Promise<UnlinkAppUserPaymentMethodResult> {
    const validated = parseExternalUserId(externalUserId);
    const id = paymentMethodId.trim();
    if (!id) {
      throw new PmtHouseError("paymentMethodId is required", {
        status: 400,
        code: "invalid_request",
      });
    }
    return this.requestJson<UnlinkAppUserPaymentMethodResult>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(validated)}/payment-methods`,
      {
        method: "DELETE",
        headers: this.builderHeaders(),
        body: JSON.stringify({ paymentMethodId: id }),
        cache: "no-store",
      },
    );
  }

  /**
   * Session-scoped usage for one `externalUserId`. Prefers end-user
   * `/api/v1/user/usage*` (forced subject from minted user JWT); falls back to
   * Builder M2M queries all scoped with `userId=` (never an app-wide scan).
   *
   * `maxEndUserIds` is retained for call-site compatibility but unused.
   */
  async fetchUsageForExternalUser(input: {
    externalUserId: string;
    startDate: string;
    endDate: string;
    maxEndUserIds?: number;
    includeRetail?: boolean;
  }): Promise<MeScopeUsagePayload> {
    const externalUserId = parseExternalUserId(input.externalUserId);
    try {
      const token = await this.ensureEndUserAccessToken(externalUserId);
      return await this.fetchEndUserUsage({
        accessToken: token.access_token,
        externalUserId,
        startDate: input.startDate,
        endDate: input.endDate,
        includeRetail: input.includeRetail,
      });
    } catch {
      // Fall back to Builder M2M + userId= when end-user mint/routes are unavailable.
      const [usageByUser, usagePipelineModel, usageDaily] = await Promise.all([
        this.getUsage({
          startDate: input.startDate,
          endDate: input.endDate,
          groupBy: "user",
          userId: externalUserId,
          includeRetail: input.includeRetail,
        }),
        this.getUsage({
          startDate: input.startDate,
          endDate: input.endDate,
          groupBy: "pipeline_model",
          userId: externalUserId,
          includeRetail: input.includeRetail,
        }),
        this.getUsage({
          startDate: input.startDate,
          endDate: input.endDate,
          groupBy: "daily_pipeline",
          userId: externalUserId,
        }),
      ]);
      return buildMeScopeUsagePayload(
        usageByUser,
        externalUserId,
        usagePipelineModel,
        usageDaily,
      );
    }
  }

  /**
   * End-user usage surface (`GET /api/v1/user/usage*`) with Bearer subject forced
   * by the credential — no client-supplied `userId` / `externalUserId`.
   */
  async fetchEndUserUsage(input: {
    accessToken: string;
    externalUserId: string;
    startDate: string;
    endDate: string;
    includeRetail?: boolean;
  }): Promise<MeScopeUsagePayload> {
    const externalUserId = parseExternalUserId(input.externalUserId);
    const [usageByUser, usagePipelineModel, usageDaily] = await Promise.all([
      this.getEndUserUsage({
        accessToken: input.accessToken,
        startDate: input.startDate,
        endDate: input.endDate,
        groupBy: "user",
        includeRetail: input.includeRetail,
      }),
      this.getEndUserUsage({
        accessToken: input.accessToken,
        startDate: input.startDate,
        endDate: input.endDate,
        groupBy: "pipeline_model",
        includeRetail: input.includeRetail,
      }),
      this.getEndUserUsage({
        accessToken: input.accessToken,
        startDate: input.startDate,
        endDate: input.endDate,
        groupBy: "daily_pipeline",
      }),
    ]);
    return buildMeScopeUsagePayload(
      usageByUser,
      externalUserId,
      usagePipelineModel,
      usageDaily,
    );
  }

  async getEndUserUsageBalance(accessToken: string): Promise<UsageBalanceResponse> {
    const url = `${this.getUserApiBaseUrl()}/usage/balance`;
    return this.requestJson<UsageBalanceResponse>(url, {
      method: "GET",
      headers: this.endUserHeaders(accessToken),
      cache: "no-store",
    });
  }

  async getEndUserUsage(input: {
    accessToken: string;
    startDate?: string;
    endDate?: string;
    groupBy?: NonNullable<UsageQueryInput["groupBy"]>;
    includeRetail?: boolean;
  }): Promise<UsageApiResponse> {
    const url = new URL(`${this.getUserApiBaseUrl()}/usage`);
    if (input.startDate) url.searchParams.set("startDate", input.startDate);
    if (input.endDate) url.searchParams.set("endDate", input.endDate);
    if (input.groupBy) url.searchParams.set("groupBy", input.groupBy);
    if (input.includeRetail) url.searchParams.set("include", "retail");

    return this.requestJson<UsageApiResponse>(url.toString(), {
      method: "GET",
      headers: this.endUserHeaders(input.accessToken),
      cache: "no-store",
    });
  }

  async getAppManifest(opts?: {
    ifNoneMatch?: string;
    signal?: AbortSignal;
  }): Promise<GetAppManifestResult> {
    const url = `${this.getAppsBaseUrl()}/manifest`;
    const headers: Record<string, string> = {
      ...this.builderHeadersRecord(),
    };
    if (opts?.ifNoneMatch) {
      headers["If-None-Match"] = opts.ifNoneMatch;
    }

    this.logger?.debug?.("PmtHouse request", { method: "GET", url });

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers,
      signal: opts?.signal,
      cache: "no-store",
    });

    const etag = response.headers.get("etag")?.trim() ?? null;

    if (response.status === 304) {
      return {
        manifest: null,
        etag: etag ?? opts?.ifNoneMatch ?? null,
        notModified: true,
      };
    }

    const raw = await response.text();
    const ct = response.headers.get("content-type") ?? "";
    const looksJson = ct.includes("application/json") || ct.includes("json");
    const parsed = raw && looksJson ? this.safeParseJson(raw) : null;

    if (!response.ok) {
      throw this.httpError(response.status, (parsed ?? {}) as Record<string, unknown>);
    }

    if (!looksJson || parsed === null) {
      throw new PmtHouseError("Expected JSON response from Builder manifest endpoint", {
        status: 502,
        code: "invalid_response",
        details: { contentType: ct, preview: raw.slice(0, 200) },
      });
    }

    return {
      manifest: parseAppManifestResponse(parsed),
      etag,
      notModified: false,
    };
  }

  /**
   * Upsert an external user, mint a short-lived JWT, and exchange it for a
   * long-lived opaque (`pmth_*`) signer session.
   *
   * Performs the *documented* remote-signer-session exchange (see
   * `builder-api.md` → "Remote signer session exchange"): the RFC 8693 token
   * exchange is sent with `scope=sign:job` and **no `resource` indicator**,
   * which selects the PymtHouse gateway/opaque path. A prior implementation set
   * `resource = issuer`, which routed to the signer-JWT path and returned a JWT
   * that {@link parseSignerSessionExchange} then rejected as non-opaque.
   */
  async mintSignerSessionForExternalUser(
    input: MintSignerSessionForExternalUserInput,
  ): Promise<SignerSessionToken> {
    const scope = input.scope ?? SIGN_JOB_SCOPE;
    await this.upsertAppUser({
      externalUserId: input.externalUserId,
      email: input.email,
      status: "active",
    });
    const userToken = await this.mintUserAccessToken({
      externalUserId: input.externalUserId,
      scope,
    });
    const exchange = await this.exchangeForSignerSession({
      userJwt: userToken.access_token,
      omitResource: true,
      scope,
    });
    return parseSignerSessionExchange(exchange);
  }

  /**
   * Approve a pending RFC 8628 device code for an external user (Option B).
   */
  async approveDeviceLogin(input: ApproveDeviceLoginInput): Promise<void> {
    if (input.publicClientId && input.publicClientId !== this.publicClientId) {
      throw new PmtHouseError(
        "publicClientId does not match configured public client id",
        { status: 400, code: "invalid_client" },
      );
    }

    await this.upsertAppUser({
      externalUserId: input.externalUserId,
      email: input.email,
      status: "active",
    });
    const userToken = await this.mintUserAccessToken({
      externalUserId: input.externalUserId,
      scope: SIGN_JOB_SCOPE,
    });
    await this.completeDeviceApproval({
      userJwt: userToken.access_token,
      userCode: input.userCode,
    });
  }

  private tokenEndpointFetchOptions():
    | ClientCredentialsGrantRequestOptions
    | TokenEndpointRequestOptions {
    const o: ClientCredentialsGrantRequestOptions = {
      [customFetch]: this.fetchImpl,
    };
    if (this.allowInsecureHttp) {
      o[allowInsecureRequests] = true;
    }
    return o;
  }

  private getAppsBaseUrl(): string {
    return `${this.getIssuerOrigin()}/api/v1/apps/${encodeURIComponent(this.publicClientId)}`;
  }

  private getUserApiBaseUrl(): string {
    return `${this.getIssuerOrigin()}/api/v1/user`;
  }

  /**
   * Mint an end-user JWT for usage reads. Tries mint first; only provisions on
   * explicit user-not-found, and never sets/overwrites status (so suspended /
   * inactive accounts stay that way during read paths).
   */
  private async ensureEndUserAccessToken(
    externalUserId: string,
  ): Promise<MintUserAccessTokenResponse> {
    try {
      return await this.mintUserAccessToken({ externalUserId });
    } catch (error) {
      if (!this.isUserNotFoundError(error)) {
        throw error;
      }
      await this.upsertAppUser({ externalUserId });
      return this.mintUserAccessToken({ externalUserId });
    }
  }

  /**
   * The Builder API signals user-not-found with two envelopes: the REST shape
   * (`{ error: <prose>, code: "not_found" }`) and the OAuth shape used by the
   * mint-token route (`{ error: "not_found" }`, no `code`). Accept both.
   */
  private isUserNotFoundError(error: unknown): boolean {
    if (!(error instanceof PmtHouseError) || error.status !== 404) {
      return false;
    }
    if (error.code === "not_found") {
      return true;
    }
    const details = error.details as { error?: unknown } | null | undefined;
    return details?.error === "not_found";
  }

  private endUserHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
  }

  private getIssuerOrigin(): string {
    return new URL(this.issuerUrl).origin;
  }

  private builderHeaders(): HeadersInit {
    return this.builderHeadersRecord();
  }

  private builderHeadersRecord(): Record<string, string> {
    return {
      Authorization: encodeClientSecretBasic(this.m2mClientId, this.m2mClientSecret),
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private m2mClientAuth(): ClientAuth {
    return (_as, _client, _body, headers) => {
      headers.set("Authorization", encodeClientSecretBasic(this.m2mClientId, this.m2mClientSecret));
    };
  }

  private async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    this.logger?.debug?.("PmtHouse request", {
      method: init.method ?? "GET",
      url,
    });

    const response = await this.fetchImpl(url, init);
    const raw = await response.text();
    const ct = response.headers.get("content-type") ?? "";
    const looksJson = ct.includes("application/json") || ct.includes("json");
    const parsed = raw && looksJson ? this.safeParseJson(raw) : null;

    if (!response.ok) {
      throw this.httpError(response.status, (parsed ?? {}) as Record<string, unknown>);
    }

    if (!looksJson || parsed === null) {
      throw new PmtHouseError("Expected JSON response from Builder or Usage API", {
        status: 502,
        code: "invalid_response",
        details: { contentType: ct, preview: raw.slice(0, 200) },
      });
    }

    if (!parsed) {
      return {} as T;
    }

    return parsed as T;
  }

  /**
   * Map a non-2xx Builder / Usage API body onto a {@link PmtHouseError}.
   *
   * `code` carries the upstream machine-readable `code` field verbatim (e.g.
   * `nothing_to_resume`). Bodies that omit it get `pymthouse_http_error`, which
   * is the SDK's reserved "upstream supplied no machine-readable code" marker —
   * never a value PymtHouse itself sends, so callers can distinguish it from a
   * real code. Human-readable text stays on `message`, the raw body on
   * `details`.
   */
  private httpError(status: number, details: Record<string, unknown>): PmtHouseError {
    let description: string;
    if (typeof details.error_description === "string") {
      description = details.error_description;
    } else if (typeof details.error === "string") {
      description = details.error;
    } else {
      description = `Request failed (${status})`;
    }

    return new PmtHouseError(description, {
      status,
      code: typeof details.code === "string" ? details.code : "pymthouse_http_error",
      details,
    });
  }

  private safeParseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private asError(error: unknown): PmtHouseError {
    if (error instanceof PmtHouseError) {
      return error;
    }

    if (error instanceof Error) {
      return new PmtHouseError(error.message, {
        code: "unexpected_error",
        status: 500,
      });
    }

    return new PmtHouseError("Unexpected error", {
      code: "unexpected_error",
      status: 500,
    });
  }
}

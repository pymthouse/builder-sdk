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
import { parseAppManifestResponse } from "./manifest.js";
import { stripTrailingSlashes } from "./string-utils.js";
import { SIGN_JOB_SCOPE, parseSignerSessionExchange } from "./tokens.js";
import type { SignerSessionToken } from "./tokens.js";
import {
  buildMeScopeUsagePayload,
  DEFAULT_MAX_END_USER_IDS,
  getEndUserIdsForExternalUser,
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
  BillingProduct,
  ListBillingProductsResult,
  PlanSyncResult,
  SignerRoutingResponse,
  SignedTicketIngestInput,
  SignedTicketIngestResult,
  UsageApiResponse,
  UsageQueryInput,
  UsageBalanceResponse,
  UserAllowanceGrantInput,
  UserAllowancesResponse,
  UserSubscriptionResponse,
  GrantSource,
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
  private readonly logger?: PmtHouseClientOptions["logger"];
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
    const payload: Record<string, unknown> = {
      externalUserId: input.externalUserId,
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
    const url = new URL(`${this.getAppsBaseUrl()}/users`);
    url.searchParams.set("externalUserId", params.externalUserId);
    return this.requestJson<{ success: boolean }>(url.toString(), {
      method: "DELETE",
      headers: this.builderHeaders(),
      cache: "no-store",
    });
  }

  async mintUserAccessToken(
    input: MintUserAccessTokenInput,
  ): Promise<MintUserAccessTokenResponse> {
    const url = `${this.getAppsBaseUrl()}/users/${encodeURIComponent(input.externalUserId)}/token`;
    const body = input.scope ? { scope: input.scope } : {};

    return this.requestJson<MintUserAccessTokenResponse>(url, {
      method: "POST",
      headers: this.builderHeaders(),
      body: JSON.stringify(body),
      cache: "no-store",
    });
  }

  /**
   * Exchange a long-lived dashboard API key (`pmth_*`) for a short-lived user JWT.
   */
  async exchangeApiKeyForUserAccessToken(input: {
    apiKey: string;
    scope?: string;
  }): Promise<MintUserAccessTokenResponse> {
    const url = `${this.getAppsBaseUrl()}/auth/api-key/token`;
    return this.requestJson<MintUserAccessTokenResponse>(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey.trim()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input.scope ? { scope: input.scope } : {}),
      cache: "no-store",
    });
  }

  /**
   * Exchange a dashboard API key for a short-lived signer JWT via a trusted facade.
   *
   * `facadeUrl` is used only for `POST {facadeUrl}/api/pymthouse/keys/exchange`.
   * After exchange, call signer RPCs directly at `signerUrl` from the response
   * (e.g. `{signerUrl}/sign-orchestrator-info`), not via dashboard `/api/signer/*`.
   *
   * When M2M credentials are available on this client, omit `facadeUrl` to exchange
   * directly against the PymtHouse issuer.
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
        signerUrl: exchanged.signerUrl,
      };
    }

    const userToken = await this.exchangeApiKeyForUserAccessToken({
      apiKey: input.apiKey,
      scope: input.scope,
    });
    return this.exchangeForSignerSession({ userJwt: userToken.access_token });
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
    if (input.userId) url.searchParams.set("userId", input.userId);
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

  async getUsageBalance(externalUserId: string): Promise<UsageBalanceResponse> {
    const url = new URL(`${this.getAppsBaseUrl()}/usage/balance`);
    url.searchParams.set("externalUserId", externalUserId);
    return this.requestJson<UsageBalanceResponse>(url.toString(), {
      method: "GET",
      headers: this.builderHeaders(),
      cache: "no-store",
    });
  }

  async getUserAllowances(externalUserId: string): Promise<UserAllowancesResponse> {
    return this.requestJson<UserAllowancesResponse>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(externalUserId)}/allowances`,
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
    return this.requestJson(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(externalUserId)}/allowances`,
      {
        method: "POST",
        headers: this.builderHeaders(),
        body: JSON.stringify(input),
        cache: "no-store",
      },
    );
  }

  /**
   * @deprecated Removed from PymtHouse — use {@link getUsageBalance} or {@link getUserAllowances}.
   */
  async getUserCredits(externalUserId: string): Promise<UsageBalanceResponse> {
    return this.getUsageBalance(externalUserId);
  }

  /**
   * @deprecated Removed from PymtHouse — use {@link grantUserAllowance} (`POST .../allowances`).
   */
  async grantUserCredits(
    externalUserId: string,
    input: { amountUsdMicros: string; source?: GrantSource; featureKey?: string },
  ): Promise<UsageBalanceResponse & { grantedUsdMicros?: string; featureKey?: string }> {
    const result = await this.grantUserAllowance(externalUserId, {
      amountUsdMicros: input.amountUsdMicros,
      source: input.source ?? "manual",
      featureKey: input.featureKey,
    });
    const flat = result as UserAllowancesResponse & {
      balanceUsdMicros?: string;
      consumedUsdMicros?: string;
      lifetimeGrantedUsdMicros?: string;
      hasAccess?: boolean;
      grantedUsdMicros?: string;
      featureKey?: string;
    };
    const nested = result.allowances;
    return {
      externalUserId: result.externalUserId,
      balanceUsdMicros:
        flat.balanceUsdMicros ?? nested?.balanceUsdMicros ?? "0",
      consumedUsdMicros:
        flat.consumedUsdMicros ?? nested?.consumedUsdMicros ?? "0",
      lifetimeGrantedUsdMicros:
        flat.lifetimeGrantedUsdMicros ?? nested?.lifetimeGrantedUsdMicros ?? "0",
      hasAccess: flat.hasAccess ?? nested?.hasAccess ?? false,
      remainingUsdMicros:
        flat.balanceUsdMicros ?? nested?.balanceUsdMicros,
      grantedUsdMicros: flat.grantedUsdMicros,
      featureKey: flat.featureKey,
    };
  }

  async getUserSubscription(externalUserId: string): Promise<UserSubscriptionResponse> {
    return this.requestJson<UserSubscriptionResponse>(
      `${this.getAppsBaseUrl()}/users/${encodeURIComponent(externalUserId)}/subscription`,
      {
        method: "GET",
        headers: this.builderHeaders(),
        cache: "no-store",
      },
    );
  }

  async fetchUsageForExternalUser(input: {
    externalUserId: string;
    startDate: string;
    endDate: string;
    maxEndUserIds?: number;
    includeRetail?: boolean;
  }): Promise<MeScopeUsagePayload> {
    const usageByUser = await this.getUsage({
      startDate: input.startDate,
      endDate: input.endDate,
      groupBy: "user",
      includeRetail: input.includeRetail,
    });
    const userIds = getEndUserIdsForExternalUser(usageByUser, input.externalUserId);
    const cap = input.maxEndUserIds ?? DEFAULT_MAX_END_USER_IDS;
    const cappedUserIds = userIds.slice(0, cap);
    const usagePipelineModels = await Promise.all(
      cappedUserIds.map((userId) =>
        this.getUsage({
          startDate: input.startDate,
          endDate: input.endDate,
          groupBy: "pipeline_model",
          userId,
          includeRetail: input.includeRetail,
        }),
      ),
    );
    const usageDaily = await this.getUsage({
      startDate: input.startDate,
      endDate: input.endDate,
      groupBy: "daily_pipeline",
      userId: input.externalUserId,
    });
    return buildMeScopeUsagePayload(
      usageByUser,
      input.externalUserId,
      usagePipelineModels,
      usageDaily,
    );
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
      const details = (parsed ?? {}) as Record<string, unknown>;
      let description: string;
      if (typeof details.error_description === "string") {
        description = details.error_description;
      } else if (typeof details.error === "string") {
        description = details.error;
      } else {
        description = `Request failed (${response.status})`;
      }
      throw new PmtHouseError(description, {
        status: response.status,
        code: typeof details.error === "string" ? details.error : "pymthouse_http_error",
        details,
      });
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
    const parsed = raw && looksJson ? this.safeParseJson(raw) : raw ? null : null;

    if (!response.ok) {
      const details = (parsed ?? {}) as Record<string, unknown>;
      let description: string;
      if (typeof details.error_description === "string") {
        description = details.error_description;
      } else if (typeof details.error === "string") {
        description = details.error;
      } else {
        description = `Request failed (${response.status})`;
      }

      throw new PmtHouseError(description, {
        status: response.status,
        code:
          typeof details.error === "string"
            ? details.error
            : "pymthouse_http_error",
        details,
      });
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

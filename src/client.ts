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
import { stripTrailingSlashes } from "./string-utils.js";
import {
  mapOAuthError,
  m2mClient,
  tokenEndpointResponseToClientCredentials,
  tokenEndpointResponseToExchange,
} from "./oauth-map.js";
import type {
  AppUserRecord,
  ClientCredentialsTokenResponse,
  DeviceApprovalInput,
  FetchLike,
  GetDiscoveryOptions,
  MintUserSignerSessionTokenInput,
  MintUserAccessTokenInput,
  MintUserAccessTokenResponse,
  OidcDiscoveryDocument,
  ParsedDeviceApprovalRedirect,
  PmtHouseClientOptions,
  TokenExchangeResponse,
  UpsertAppUserInput,
  UsageApiResponse,
  UsageQueryInput,
} from "./types.js";

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
    const resourceCandidate =
      typeof input.resource === "string" && input.resource.trim() !== ""
        ? input.resource.trim()
        : this.issuerUrl;
    params.set("resource", stripTrailingSlashes(resourceCandidate));

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

    return this.requestJson<UsageApiResponse>(url.toString(), {
      method: "GET",
      headers: this.builderHeaders(),
      cache: "no-store",
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
      const description =
        typeof details.error_description === "string"
          ? details.error_description
          : typeof details.error === "string"
            ? details.error
            : `Request failed (${response.status})`;

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

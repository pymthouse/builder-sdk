import {
  allowInsecureRequests,
  customFetch,
  deviceAuthorizationRequest,
  deviceCodeGrantRequest,
  None,
  processDeviceAuthorizationResponse,
  processDeviceCodeResponse,
  ResponseBodyError,
  type AuthorizationServer,
  type Client,
  type DeviceAuthorizationRequestOptions,
  type DeviceAuthorizationResponse,
  type TokenEndpointRequestOptions,
  type TokenEndpointResponse,
} from "oauth4webapi";
import { loadAuthorizationServer } from "./discovery.js";
import { PmtHouseError } from "./errors.js";
import { mapOAuthError } from "./oauth-map.js";
import type { FetchLike } from "./types.js";

type DeviceOAuthHttpOptions = DeviceAuthorizationRequestOptions & TokenEndpointRequestOptions;

export interface PollDeviceTokenOptions {
  issuerUrl: string;
  /** Public OAuth `client_id` (RFC 8628). */
  clientId: string;
  /** Space-separated scopes for the device authorization request. */
  scope?: string;
  fetch?: FetchLike;
  allowInsecureHttp?: boolean;
  signal?: AbortSignal;
  onUserCode?: (info: {
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    expiresIn: number;
    intervalSeconds?: number;
  }) => void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(abortReasonToError(signal.reason));
      },
      { once: true },
    );
  });
}

function abortReasonToError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  if (typeof reason === "string") {
    return new Error(reason);
  }

  return new Error("Aborted");
}

function createOAuthHttpOptions(
  fetchImpl: FetchLike,
  allowInsecureHttp?: boolean,
): DeviceOAuthHttpOptions {
  const httpOpts: DeviceOAuthHttpOptions = {
    [customFetch]: fetchImpl,
  };
  if (allowInsecureHttp) {
    httpOpts[allowInsecureRequests] = true;
  }
  return httpOpts;
}

async function requestDeviceAuthorization(
  as: AuthorizationServer,
  client: Client,
  params: URLSearchParams,
  httpOpts: DeviceOAuthHttpOptions,
): Promise<DeviceAuthorizationResponse> {
  let deviceResponse: Response;
  try {
    deviceResponse = await deviceAuthorizationRequest(
      as,
      client,
      None(),
      params,
      httpOpts,
    );
  } catch (e) {
    throw mapOAuthError(e);
  }

  try {
    return await processDeviceAuthorizationResponse(as, client, deviceResponse);
  } catch (e) {
    throw mapOAuthError(e);
  }
}

type DevicePollResult =
  | { kind: "success"; token: TokenEndpointResponse }
  | { kind: "authorization_pending" }
  | { kind: "slow_down" };

async function pollDeviceCode(
  as: AuthorizationServer,
  client: Client,
  deviceCode: string,
  httpOpts: DeviceOAuthHttpOptions,
): Promise<DevicePollResult> {
  let tokenResponse: Response;
  try {
    tokenResponse = await deviceCodeGrantRequest(
      as,
      client,
      None(),
      deviceCode,
      httpOpts,
    );
  } catch (e) {
    throw mapOAuthError(e);
  }

  try {
    return {
      kind: "success",
      token: await processDeviceCodeResponse(as, client, tokenResponse),
    };
  } catch (e) {
    if (e instanceof ResponseBodyError && e.error === "authorization_pending") {
      return { kind: "authorization_pending" };
    }

    if (e instanceof ResponseBodyError && e.error === "slow_down") {
      return { kind: "slow_down" };
    }

    throw mapOAuthError(e);
  }
}

/**
 * RFC 8628 device authorization grant: request a device code, then poll the token endpoint until
 * tokens are issued (handles `authorization_pending` and `slow_down`).
 */
export async function pollDeviceToken(
  options: PollDeviceTokenOptions,
): Promise<TokenEndpointResponse> {
  const fetchImpl = options.fetch ?? fetch;
  const as = await loadAuthorizationServer(options.issuerUrl, fetchImpl, {
    allowInsecureHttp: options.allowInsecureHttp,
  });

  if (!as.device_authorization_endpoint) {
    throw new PmtHouseError(
      "Authorization server metadata has no device_authorization_endpoint",
      { status: 400, code: "unsupported_grant" },
    );
  }

  const client: Client = { client_id: options.clientId };
  const params = new URLSearchParams();
  if (options.scope) {
    params.set("scope", options.scope);
  }

  const httpOpts = createOAuthHttpOptions(fetchImpl, options.allowInsecureHttp);
  const dar = await requestDeviceAuthorization(as, client, params, httpOpts);

  options.onUserCode?.({
    userCode: dar.user_code,
    verificationUri: dar.verification_uri,
    verificationUriComplete: dar.verification_uri_complete,
    expiresIn: dar.expires_in,
    intervalSeconds: dar.interval,
  });

  let pollIntervalMs = (dar.interval ?? 5) * 1000;
  const deadline = Date.now() + dar.expires_in * 1000;
  let firstPoll = true;

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw abortReasonToError(options.signal.reason);
    }

    if (!firstPoll) {
      await sleep(pollIntervalMs, options.signal);
    }
    firstPoll = false;

    const pollResult = await pollDeviceCode(as, client, dar.device_code, httpOpts);
    if (pollResult.kind === "success") {
      return pollResult.token;
    }

    if (pollResult.kind === "slow_down") {
      pollIntervalMs += 5000;
    }
  }

  throw new PmtHouseError("Device authorization expired before completion", {
    status: 408,
    code: "device_flow_expired",
  });
}

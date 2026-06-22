import {
  allowInsecureRequests,
  customFetch,
  deviceAuthorizationRequest,
  deviceCodeGrantRequest,
  None,
  processDeviceAuthorizationResponse,
  processDeviceCodeResponse,
  ResponseBodyError,
  type Client,
} from "oauth4webapi";
import { loadAuthorizationServer } from "./discovery.js";
import { PmtHouseError } from "./errors.js";
import { mapOAuthError } from "./oauth-map.js";
import type { FetchLike } from "./types.js";

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

function toAbortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(typeof reason === "string" ? reason : "Aborted");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(toAbortError(signal.reason));
      },
      { once: true },
    );
  });
}

type DeviceTokenPoll =
  | { done: true; tokens: import("oauth4webapi").TokenEndpointResponse }
  | { done: false; slowDown: boolean };

/** Single device-token poll: resolves to tokens, or signals pending/slow_down. */
async function attemptDeviceTokenPoll(
  as: import("oauth4webapi").AuthorizationServer,
  client: Client,
  deviceCode: string,
  httpOpts: Record<symbol, unknown>,
): Promise<DeviceTokenPoll> {
  let tokenResponse: Response;
  try {
    tokenResponse = await deviceCodeGrantRequest(
      as,
      client,
      None(),
      deviceCode,
      httpOpts as import("oauth4webapi").TokenEndpointRequestOptions,
    );
  } catch (e) {
    throw mapOAuthError(e);
  }

  try {
    const tokens = await processDeviceCodeResponse(as, client, tokenResponse);
    return { done: true, tokens };
  } catch (e) {
    if (e instanceof ResponseBodyError) {
      if (e.error === "authorization_pending") {
        return { done: false, slowDown: false };
      }
      if (e.error === "slow_down") {
        return { done: false, slowDown: true };
      }
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
): Promise<import("oauth4webapi").TokenEndpointResponse> {
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

  const httpOpts: Record<symbol, unknown> = {
    [customFetch]: fetchImpl,
  };
  if (options.allowInsecureHttp) {
    httpOpts[allowInsecureRequests] = true;
  }

  let deviceResponse: Response;
  try {
    deviceResponse = await deviceAuthorizationRequest(
      as,
      client,
      None(),
      params,
      httpOpts as import("oauth4webapi").DeviceAuthorizationRequestOptions,
    );
  } catch (e) {
    throw mapOAuthError(e);
  }

  let dar: import("oauth4webapi").DeviceAuthorizationResponse;
  try {
    dar = await processDeviceAuthorizationResponse(as, client, deviceResponse);
  } catch (e) {
    throw mapOAuthError(e);
  }

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
      throw toAbortError(options.signal.reason);
    }

    if (!firstPoll) {
      await sleep(pollIntervalMs, options.signal);
    }
    firstPoll = false;

    const poll = await attemptDeviceTokenPoll(as, client, dar.device_code, httpOpts);
    if (poll.done) {
      return poll.tokens;
    }
    if (poll.slowDown) {
      pollIntervalMs += 5000;
    }
  }

  throw new PmtHouseError("Device authorization expired before completion", {
    status: 408,
    code: "device_flow_expired",
  });
}

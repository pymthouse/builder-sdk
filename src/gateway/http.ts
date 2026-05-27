import {
  GatewayError,
  PaymentRequiredError,
  SignerRefreshRequired,
  SkipPaymentCycle,
} from "./errors.js";
import type { FetchLike } from "./types.js";

function truncate(value: string, maxLen = 2000): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}...(+${value.length - maxLen} chars)`;
}

async function extractErrorMessage(response: Response): Promise<string> {
  const body = await response.text();
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const data = JSON.parse(trimmed) as { error?: { message?: string } | string };
    if (typeof data.error === "object" && data.error?.message) {
      return truncate(String(data.error.message));
    }
    if (typeof data.error === "string") {
      return truncate(data.error);
    }
  } catch {
    /* fall through */
  }
  return truncate(body);
}

function isTlsWrongVersionError(error: unknown): boolean {
  const message = String(error).toUpperCase();
  return message.includes("WRONG_VERSION_NUMBER");
}

function httpsToHttp(url: string): string | null {
  if (url.toLowerCase().startsWith("https://")) {
    return `http://${url.slice(8)}`;
  }
  return null;
}

export function parseHttpUrl(url: string, context = "URL"): URL {
  const trimmed = url.trim();
  const normalized = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http:// or https:// ${context}s are supported (got ${parsed.protocol})`);
  }
  return parsed;
}

export function httpOrigin(url: string): string {
  const parsed = parseHttpUrl(url);
  return `${parsed.protocol}//${parsed.host}`;
}

export function joinSignerEndpoint(signerUrl: string, path: string): string {
  if (!signerUrl.trim()) {
    throw new Error("signer_url must be a non-empty string");
  }
  const parsed = parseHttpUrl(signerUrl, "signer_url");
  const basePath = parsed.pathname.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const joinedPath = `${basePath}${suffix}`;
  parsed.pathname = joinedPath;
  parsed.search = "";
  parsed.hash = "";
  if (joinedPath.endsWith(suffix) && parsed.href.endsWith(suffix)) {
    return parsed.href;
  }
  return parsed.href;
}

export function resolveTranscoderHttpUrl(origin: string, pathOrAbsoluteUrl: string): string {
  const candidate = pathOrAbsoluteUrl.trim();
  if (!candidate) {
    throw new Error("path_or_absolute_url must be non-empty");
  }
  const lower = candidate.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return candidate;
  }
  const path = candidate.startsWith("/") ? candidate : `/${candidate}`;
  return `${httpOrigin(origin)}${path}`;
}

export function appendCaps(url: string, caps: string[]): string {
  if (caps.length === 0) return url;
  const parsed = new URL(url);
  for (const cap of caps) {
    parsed.searchParams.append("caps", cap);
  }
  return parsed.toString();
}

export async function requestJson(
  url: string,
  options: {
    method?: string;
    payload?: Record<string, unknown>;
    headers?: Record<string, string>;
    timeoutMs?: number;
    fetchImpl?: FetchLike;
    allowInsecureTls?: boolean;
    _schemeDowngraded?: boolean;
  } = {},
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "pymthouse-builder-sdk-gateway/0.1",
  };
  if (options.payload !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  const method =
    options.method?.toUpperCase() ??
    (options.payload !== undefined ? "POST" : "GET");

  const controller = new AbortController();
  const timeout = options.timeoutMs ?? 5000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: options.payload !== undefined ? JSON.stringify(options.payload) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await extractErrorMessage(response);
      const bodyPart = body ? `; body=${JSON.stringify(body)}` : "";
      if (response.status === 480) {
        throw new SignerRefreshRequired(
          `Signer returned HTTP 480 (refresh session required) (url=${url})${bodyPart}`,
        );
      }
      if (response.status === 482) {
        throw new SkipPaymentCycle(
          `Signer returned HTTP 482 (skip payment cycle) (url=${url})${bodyPart}`,
        );
      }
      throw new GatewayError(
        `HTTP JSON error: HTTP ${response.status} from endpoint (url=${url})${bodyPart}`,
      );
    }

    return response.json();
  } catch (error) {
    const httpUrl = httpsToHttp(url);
    if (!options._schemeDowngraded && isTlsWrongVersionError(error) && httpUrl) {
      return requestJson(httpUrl, { ...options, _schemeDowngraded: true });
    }
    if (error instanceof GatewayError) throw error;
    throw new GatewayError(
      `HTTP JSON error: failed to reach endpoint: ${error instanceof Error ? error.message : String(error)} (url=${url})`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function postJson(
  url: string,
  payload: Record<string, unknown>,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    fetchImpl?: FetchLike;
  } = {},
): Promise<Record<string, unknown>> {
  const data = await requestJson(url, { ...options, payload });
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new GatewayError(
      `HTTP JSON error: expected JSON object, got ${Array.isArray(data) ? "array" : typeof data} (url=${url})`,
    );
  }
  return data as Record<string, unknown>;
}

export async function getJson(
  url: string,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    fetchImpl?: FetchLike;
  } = {},
): Promise<unknown> {
  return requestJson(url, options);
}

export async function postByocJson(
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  op: string,
  options: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<{ status_code: number; headers: Record<string, string>; body: unknown }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const reqHeaders: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "pymthouse-builder-sdk-gateway/0.1",
    ...headers,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (!response.ok) {
      let body = rawBody.trim();
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } };
        if (parsed.error?.message) body = parsed.error.message;
      } catch {
        /* keep raw */
      }
      const bodyPart = body ? `; body=${JSON.stringify(truncate(body))}` : "";
      if (response.status === 402) {
        throw new PaymentRequiredError(
          `HTTP BYOC ${op} error: HTTP 402 from endpoint (url=${url})${bodyPart}`,
        );
      }
      throw new GatewayError(
        `HTTP BYOC ${op} error: HTTP ${response.status} from endpoint (url=${url})${bodyPart}`,
      );
    }

    let parsedBody: unknown = null;
    if (rawBody.trim()) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }
    }

    return {
      status_code: response.status,
      headers: responseHeaders,
      body: parsedBody,
    };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError(
      `HTTP BYOC ${op} error: ${error instanceof Error ? error.message : String(error)} (url=${url})`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function postEmpty(
  url: string,
  headers: Record<string, string>,
  op: string,
  options: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: "",
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await extractErrorMessage(response);
      const bodyPart = body ? `; body=${JSON.stringify(body)}` : "";
      throw new GatewayError(
        `HTTP ${op} error: HTTP ${response.status} from endpoint (url=${url})${bodyPart}`,
      );
    }
    await response.text();
  } finally {
    clearTimeout(timer);
  }
}

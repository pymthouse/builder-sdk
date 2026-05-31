import { stripTrailingSlashes } from "../string-utils.js";
import type { FetchLike } from "../types.js";
import type { SignerDmzGate } from "./types.js";

export type SignerUsageSnapshot = {
  requestId: string;
  computedFeeWei: string;
  computedFeeUsdMicros: bigint;
  ethUsdPrice?: string;
  ethUsdRoundId?: string;
  ethUsdObservedAt?: string;
  pixels?: string;
  billableSecs?: string;
  pipeline?: string;
  modelId?: string;
};

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

const HTTP_DMZ_TOKEN_MAX_ENTRIES = 100;
const HTTP_DMZ_TOKEN_TTL_MS = 3.5 * 60 * 1000;
const DEFAULT_PROBE_SUBJECT = "signer-reachability-probe";

type DmzTokenCacheEntry = {
  token: string;
  expMs: number;
};

const httpDmzTokenCache = new Map<string, DmzTokenCacheEntry>();

export function normalizeSignerBaseUrl(base: string): string {
  return stripTrailingSlashes(base);
}

export function resolveSignerBaseUrl(input: {
  envUrl?: string | null;
  storedUrl?: string | null;
  storedPort?: number | null;
  testSignerUrl?: string | null;
  defaultPort?: number;
}): string {
  if (input.testSignerUrl?.trim()) {
    return normalizeSignerBaseUrl(input.testSignerUrl);
  }

  const legacyBareSignerPort = 8081;
  const rawPort = input.storedPort ?? input.defaultPort ?? 8080;
  const port = rawPort === legacyBareSignerPort ? 8080 : rawPort;
  const base =
    input.envUrl?.trim() ||
    input.storedUrl?.trim() ||
    `http://127.0.0.1:${port}`;
  return normalizeSignerBaseUrl(base);
}

export async function getCachedDmzBearerToken(
  subject: string,
  gate: SignerDmzGate,
  getDmzToken: (subject: string, gate: SignerDmzGate) => Promise<string>,
): Promise<string> {
  const cacheKey = `${gate}:${subject}`;
  const now = Date.now();
  const cached = httpDmzTokenCache.get(cacheKey);
  if (cached && cached.expMs > now + 15_000) {
    httpDmzTokenCache.delete(cacheKey);
    httpDmzTokenCache.set(cacheKey, cached);
    return cached.token;
  }

  const token = await getDmzToken(subject, gate);
  httpDmzTokenCache.set(cacheKey, { token, expMs: now + HTTP_DMZ_TOKEN_TTL_MS });

  if (httpDmzTokenCache.size > HTTP_DMZ_TOKEN_MAX_ENTRIES) {
    const oldest = httpDmzTokenCache.keys().next().value;
    if (oldest !== undefined) {
      httpDmzTokenCache.delete(oldest);
    }
  }

  return token;
}

export async function readSignerUpstreamBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      error: "Signer DMZ returned a non-JSON body (often Apache auth failure)",
      upstreamStatus: response.status,
      detail: text.slice(0, 800),
    };
  }
}

export function pickConflictingStringAliases(
  body: Record<string, unknown>,
  ...keys: string[]
):
  | { ok: true; value: string | undefined }
  | { ok: false; message: string } {
  const values = keys
    .map((key) => {
      const raw = body[key];
      const defined = raw !== undefined && raw !== null && `${raw}`.length > 0;
      return defined ? { key, value: String(raw) } : null;
    })
    .filter((entry): entry is { key: string; value: string } => entry !== null);
  const first = values[0];
  const conflict = values.find((entry) => entry.value !== first?.value);
  if (first && conflict) {
    return {
      ok: false,
      message: `Conflicting ${keys.join("/")} in request body`,
    };
  }
  return { ok: true, value: first?.value };
}

export function pickConflictingNumberAliases(
  body: Record<string, unknown>,
  ...keys: string[]
):
  | { ok: true; value: number | undefined }
  | { ok: false; message: string } {
  const parseNum = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  };
  const values = keys
    .map((key) => {
      const value = parseNum(body[key]);
      return value !== undefined ? { key, value } : null;
    })
    .filter((entry): entry is { key: string; value: number } => entry !== null);
  const first = values[0];
  const conflict = values.find((entry) => entry.value !== first?.value);
  if (first && conflict) {
    return {
      ok: false,
      message: `Conflicting ${keys.join("/")} in request body`,
    };
  }
  return { ok: true, value: first?.value };
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
  }
  return "";
}

export function parseSignerUsageSnapshot(body: unknown): SignerUsageSnapshot | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const usageRaw = record.usage;
  if (usageRaw === null || typeof usageRaw !== "object" || Array.isArray(usageRaw)) {
    return null;
  }
  const usage = usageRaw as Record<string, unknown>;
  const computedFeeWei = pickString(usage, "computed_fee_wei", "computedFeeWei");
  const usdMicrosStr = pickString(usage, "computed_fee_usd_micros", "computedFeeUsdMicros");
  const requestId = pickString(usage, "request_id", "requestId");
  if (!computedFeeWei || !usdMicrosStr || !requestId) {
    return null;
  }
  let computedFeeUsdMicros: bigint;
  try {
    computedFeeUsdMicros = BigInt(usdMicrosStr);
  } catch {
    return null;
  }
  return {
    requestId,
    computedFeeWei,
    computedFeeUsdMicros,
    ethUsdPrice: pickString(usage, "eth_usd_price", "ethUsdPrice") || undefined,
    ethUsdRoundId: pickString(usage, "eth_usd_round_id", "ethUsdRoundId") || undefined,
    ethUsdObservedAt:
      pickString(usage, "eth_usd_updated_at", "ethUsdUpdatedAt", "eth_usd_observed_at") ||
      undefined,
    pixels: pickString(usage, "pixels") || undefined,
    billableSecs: pickString(usage, "billable_secs", "billableSecs") || undefined,
    pipeline: pickString(usage, "pipeline") || undefined,
    modelId: pickString(usage, "model_id", "modelId") || undefined,
  };
}

export function stripSignerUsageFromResponse(body: unknown): void {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    delete (body as Record<string, unknown>).usage;
  }
}

export async function forwardToSigner(
  options: ForwardToSignerOptions,
): Promise<ForwardToSignerResult> {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = normalizeSignerBaseUrl(options.baseUrl);
  const url = `${baseUrl}${options.path.startsWith("/") ? options.path : `/${options.path}`}`;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (options.forwardJwt !== false) {
    const token = await getCachedDmzBearerToken(
      options.subject,
      "http",
      options.getDmzToken,
    );
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.extraHeaders) {
    for (const [name, value] of Object.entries(options.extraHeaders)) {
      if (value.trim()) {
        headers[name] = value.trim();
      }
    }
  }

  try {
    const response = await fetchImpl(url, {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    return {
      response,
      requestUrl: url,
      authorizationHeader: headers.Authorization,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeSignerHttpReachability(
  options: ProbeSignerHttpReachabilityOptions,
): Promise<{ reachable: boolean; ethAddress?: string }> {
  const fetchImpl = options.fetch ?? fetch;
  const signerUrl = normalizeSignerBaseUrl(options.signerUrl);
  const timeoutMs = options.timeoutMs ?? 5000;
  const probeSubject = options.probeSubject ?? DEFAULT_PROBE_SUBJECT;

  const parseEthFromStatus = async (response: Response): Promise<string | undefined> => {
    if (!response.ok) {
      return undefined;
    }
    const data = (await readSignerUpstreamBody(response)) as Record<string, unknown>;
    return (
      (typeof data.Address === "string" && data.Address) ||
      (typeof data.address === "string" && data.address) ||
      undefined
    );
  };

  const fetchStatus = async (headers: Record<string, string>) => {
    const response = await fetchImpl(`${signerUrl}/status`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const addr = await parseEthFromStatus(response);
    return { ok: response.ok, addr };
  };

  const fetchSigningProbe = async (): Promise<boolean> => {
    const token = await options.getDmzToken(probeSubject, "http");
    const response = await fetchImpl(`${signerUrl}/sign-orchestrator-info`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  };

  try {
    const health = await fetchImpl(`${signerUrl}/healthz`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (health.ok) {
      if (options.forwardJwt !== false) {
        try {
          const token = await options.getDmzToken(probeSubject, "http");
          const { ok, addr } = await fetchStatus({
            Authorization: `Bearer ${token}`,
          });
          if (ok) {
            return { reachable: true, ethAddress: addr };
          }
        } catch {
          /* continue */
        }
      }
      try {
        const { ok, addr } = await fetchStatus({});
        if (ok) {
          return { reachable: true, ethAddress: addr };
        }
      } catch {
        /* continue */
      }
      try {
        if (await fetchSigningProbe()) {
          return { reachable: true, ethAddress: undefined };
        }
      } catch {
        /* continue */
      }
      return { reachable: false, ethAddress: undefined };
    }
  } catch {
    /* try /status without healthz */
  }

  if (options.forwardJwt !== false) {
    try {
      const token = await options.getDmzToken(probeSubject, "http");
      const { ok, addr } = await fetchStatus({
        Authorization: `Bearer ${token}`,
      });
      if (ok) {
        return { reachable: true, ethAddress: addr };
      }
    } catch {
      /* continue */
    }
  }

  try {
    const { ok, addr } = await fetchStatus({});
    if (ok) {
      return { reachable: true, ethAddress: addr };
    }
  } catch {
    /* unreachable */
  }

  try {
    if (await fetchSigningProbe()) {
      return { reachable: true, ethAddress: undefined };
    }
  } catch {
    /* unreachable */
  }

  return { reachable: false, ethAddress: undefined };
}

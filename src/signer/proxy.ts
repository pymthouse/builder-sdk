import { stripTrailingSlashes } from "../string-utils.js";
import type { FetchLike } from "../types.js";
import type {
  ForwardToSignerOptions,
  ForwardToSignerResult,
  ProbeSignerHttpReachabilityOptions,
  SignerDmzGate,
} from "./types.js";

export type { ForwardToSignerOptions, ForwardToSignerResult, ProbeSignerHttpReachabilityOptions };

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

function joinSignerUrl(baseUrl: string, path: string): string {
  if (path.startsWith("/")) {
    return `${baseUrl}${path}`;
  }
  return `${baseUrl}/${path}`;
}

function aliasBodyString(raw: unknown): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw === "string") {
    return raw.length > 0 ? raw : null;
  }
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") {
    return String(raw);
  }
  return null;
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
      const value = aliasBodyString(body[key]);
      return value === null ? null : { key, value };
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
      return value === undefined ? null : { key, value };
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
  const url = joinSignerUrl(baseUrl, options.path);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const attachJwt = options.forwardJwt ?? true;
  if (attachJwt) {
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
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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

type SignerProbeContext = {
  fetchImpl: FetchLike;
  signerUrl: string;
  timeoutMs: number;
  probeSubject: string;
  useJwt: boolean;
  getDmzToken: ProbeSignerHttpReachabilityOptions["getDmzToken"];
};

function createSignerProbeContext(options: ProbeSignerHttpReachabilityOptions): SignerProbeContext {
  return {
    fetchImpl: options.fetch ?? fetch,
    signerUrl: normalizeSignerBaseUrl(options.signerUrl),
    timeoutMs: options.timeoutMs ?? 5000,
    probeSubject: options.probeSubject ?? DEFAULT_PROBE_SUBJECT,
    useJwt: options.forwardJwt ?? true,
    getDmzToken: options.getDmzToken,
  };
}

function reachableResult(ethAddress?: string): { reachable: true; ethAddress?: string } {
  return { reachable: true, ethAddress };
}

async function fetchSignerStatus(
  ctx: SignerProbeContext,
  headers: Record<string, string>,
): Promise<{ ok: boolean; ethAddress?: string }> {
  const response = await ctx.fetchImpl(`${ctx.signerUrl}/status`, {
    headers,
    signal: AbortSignal.timeout(ctx.timeoutMs),
  });
  if (!response.ok) {
    return { ok: false };
  }
  const data = (await readSignerUpstreamBody(response)) as Record<string, unknown>;
  const ethAddress =
    (typeof data.Address === "string" && data.Address) ||
    (typeof data.address === "string" && data.address) ||
    undefined;
  return { ok: true, ethAddress };
}

async function tryJwtStatus(
  ctx: SignerProbeContext,
): Promise<{ reachable: true; ethAddress?: string } | null> {
  if (!ctx.useJwt) {
    return null;
  }
  try {
    const token = await ctx.getDmzToken(ctx.probeSubject, "http");
    const { ok, ethAddress } = await fetchSignerStatus(ctx, {
      Authorization: `Bearer ${token}`,
    });
    return ok ? reachableResult(ethAddress) : null;
  } catch {
    return null;
  }
}

async function tryPlainStatus(
  ctx: SignerProbeContext,
): Promise<{ reachable: true; ethAddress?: string } | null> {
  try {
    const { ok, ethAddress } = await fetchSignerStatus(ctx, {});
    return ok ? reachableResult(ethAddress) : null;
  } catch {
    return null;
  }
}

async function trySigningProbe(ctx: SignerProbeContext): Promise<boolean> {
  try {
    const token = await ctx.getDmzToken(ctx.probeSubject, "http");
    const response = await ctx.fetchImpl(`${ctx.signerUrl}/sign-orchestrator-info`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function runSignerReachabilityProbes(
  ctx: SignerProbeContext,
): Promise<{ reachable: boolean; ethAddress?: string }> {
  const jwtResult = await tryJwtStatus(ctx);
  if (jwtResult) {
    return jwtResult;
  }
  const plainResult = await tryPlainStatus(ctx);
  if (plainResult) {
    return plainResult;
  }
  if (await trySigningProbe(ctx)) {
    return reachableResult();
  }
  return { reachable: false };
}

export async function probeSignerHttpReachability(
  options: ProbeSignerHttpReachabilityOptions,
): Promise<{ reachable: boolean; ethAddress?: string }> {
  const ctx = createSignerProbeContext(options);

  try {
    const health = await ctx.fetchImpl(`${ctx.signerUrl}/healthz`, {
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    if (health.ok) {
      return runSignerReachabilityProbes(ctx);
    }
  } catch {
    /* fall through to /status probes */
  }

  return runSignerReachabilityProbes(ctx);
}

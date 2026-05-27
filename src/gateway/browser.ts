import type {
  BYOCJobRecord,
  BYOCJobRequestInput,
  FetchLike,
  GatewayJobStatus,
  PmtHouseGatewayClientOptions,
  StartJobResponse,
} from "./types.js";
import { GatewayError } from "./errors.js";

export class PmtHouseGatewayClient {
  private readonly basePath: string;
  private readonly accessToken?: string;
  private readonly getAccessToken?: PmtHouseGatewayClientOptions["getAccessToken"];
  private readonly fetchImpl: FetchLike;

  constructor(options: PmtHouseGatewayClientOptions = {}) {
    this.basePath = normalizeBasePath(options.basePath ?? "/pymthouse/gateway");
    this.accessToken = options.accessToken;
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async startJob(input: BYOCJobRequestInput & { token?: string }): Promise<StartJobResponse> {
    const response = await this.request<{ job: BYOCJobRecord; proxy: StartJobResponse["proxy"] }>(
      "/jobs",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
    return response;
  }

  async sendControl(jobId: string, payload: Record<string, unknown>): Promise<void> {
    await this.request(`/jobs/${encodeURIComponent(jobId)}/control`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async stopJob(jobId: string): Promise<{ status_code: number }> {
    return this.request(`/jobs/${encodeURIComponent(jobId)}/stop`, { method: "POST" });
  }

  async getStatus(jobId: string): Promise<GatewayJobStatus> {
    return this.request(`/jobs/${encodeURIComponent(jobId)}/status`, { method: "GET" });
  }

  async closeJob(jobId: string): Promise<void> {
    try {
      await this.stopJob(jobId);
    } catch {
      /* best effort */
    }
  }

  events(jobId: string, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
    const url = `${this.basePath}/jobs/${encodeURIComponent(jobId)}/events`;
    return this.streamSse(url, signal);
  }

  connectWebSocket(jobId: string): WebSocket {
    const protocol = globalThis.location?.protocol === "https:" ? "wss:" : "ws:";
    const host = globalThis.location?.host ?? "localhost";
    const path = `${this.basePath}/ws/${encodeURIComponent(jobId)}`;
    const wsUrl = `${protocol}//${host}${path}`;
    const ws = new WebSocket(wsUrl);
    return ws;
  }

  private async resolveAuthHeader(): Promise<string | undefined> {
    const staticToken = this.accessToken?.trim();
    if (staticToken) return `Bearer ${staticToken}`;
    if (this.getAccessToken) {
      const token = await this.getAccessToken();
      if (token?.trim()) return `Bearer ${token.trim()}`;
    }
    return undefined;
  }

  private async request<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const auth = await this.resolveAuthHeader();
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(auth ? { Authorization: auth } : {}),
    };
    const response = await this.fetchImpl(`${this.basePath}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    const raw = await response.text();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }
    if (!response.ok) {
      const details = (parsed ?? {}) as { error?: string; code?: string };
      throw new GatewayError(details.error ?? `Request failed (${response.status})`, details.code);
    }
    return parsed as T;
  }

  private async *streamSse(
    url: string,
    signal?: AbortSignal,
  ): AsyncGenerator<Record<string, unknown>> {
    const auth = await this.resolveAuthHeader();
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        ...(auth ? { Authorization: auth } : {}),
      },
      signal,
      cache: "no-store",
    });
    if (!response.ok || !response.body) {
      throw new GatewayError(`Failed to open event stream (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = chunk
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (dataLine) {
          const payload = dataLine.slice("data: ".length);
          try {
            const parsed = JSON.parse(payload) as Record<string, unknown>;
            yield parsed;
          } catch {
            /* ignore malformed chunk */
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  }
}

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export { GatewayError } from "./errors.js";
export type {
  BYOCJobRecord,
  BYOCJobRequestInput,
  GatewayJobStatus,
  PmtHouseGatewayClientOptions,
  StartJobResponse,
} from "./types.js";
export { encodeGatewayToken, parseGatewayToken } from "./token-browser.js";

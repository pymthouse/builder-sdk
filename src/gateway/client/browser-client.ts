import {
  TRICKLE_SEQ_CURRENT,
  TRICKLE_SEQ_LATEST,
  type GatewayLiveSubscribeSegment,
  type GatewaySegmentPublishResult,
  type StartGatewaySessionRequest,
  type StartGatewaySessionResponse,
} from "../types.js";
import { resolveSignerToken, type SignerCredentials } from "./resolve-signer.js";

function isTrickleLeadingIndex(seq: number): boolean {
  return seq === TRICKLE_SEQ_LATEST || seq === TRICKLE_SEQ_CURRENT;
}

function parseHeaderInt(headers: Headers, name: string): number {
  const raw = headers.get(name);
  if (!raw) {
    return Number.NaN;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export type BrowserGatewayClientOptions = {
  /** Dashboard (or gateway relay) origin, e.g. https://dashboard.example.com */
  baseUrl: string;
  fetch?: typeof fetch;
};

export class BrowserGatewayClient {
  private signerToken: string | null = null;
  private sessionId: string | null = null;
  private publishSeq = -1;
  /** Next trickle GET index for orchestrator output (see TrickleSubscriber). */
  private subscribeSeq = TRICKLE_SEQ_CURRENT;
  private subscribeEmptyPolls = 0;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: BrowserGatewayClientOptions) {
    // Unbound `fetch` throws "Illegal invocation" when called as a method.
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  get baseUrl(): string {
    return this.options.baseUrl.replace(/\/$/, "");
  }

  get signerAccessToken(): string | null {
    return this.signerToken;
  }

  get activeSessionId(): string | null {
    return this.sessionId;
  }

  get nextSubscribeSeq(): number {
    return this.subscribeSeq;
  }

  async connect(credentials: SignerCredentials): Promise<void> {
    this.signerToken = await resolveSignerToken(credentials, this.fetchImpl);
  }

  async startSession(request: StartGatewaySessionRequest): Promise<StartGatewaySessionResponse> {
    if (!this.signerToken) {
      throw new Error("Call connect() with signer credentials before startSession()");
    }

    const response = await this.fetchImpl(`${this.baseUrl}/api/gateway/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.signerToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(request),
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const message =
        typeof body.message === "string"
          ? body.message
          : typeof body.error === "string"
            ? body.error
            : `startSession failed (${response.status})`;
      throw new Error(message);
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const manifestId = typeof body.manifestId === "string" ? body.manifestId : "";
    if (!sessionId) {
      throw new Error("startSession response missing sessionId");
    }

    this.sessionId = sessionId;
    const initialPublishSeq =
      typeof body.publishSeq === "number" && Number.isFinite(body.publishSeq)
        ? body.publishSeq
        : 0;
    this.publishSeq = initialPublishSeq - 1;
    const initialSubscribeSeq =
      typeof body.subscribeSeq === "number" && Number.isFinite(body.subscribeSeq)
        ? body.subscribeSeq
        : TRICKLE_SEQ_CURRENT;
    this.subscribeSeq = initialSubscribeSeq;
    this.subscribeEmptyPolls = 0;
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : undefined;
    return {
      sessionId,
      manifestId,
      mimeType,
      publishSeq: initialPublishSeq,
      subscribeSeq: initialSubscribeSeq,
    };
  }

  setSignerToken(accessToken: string): void {
    const token = accessToken.trim();
    if (!token) {
      throw new Error("Signer bearer token is empty");
    }
    this.signerToken = token;
  }

  async publishSegment(
    bytes: ArrayBuffer | Uint8Array,
    options?: { seq?: number; contentType?: string },
  ): Promise<GatewaySegmentPublishResult> {
    if (!this.sessionId || !this.signerToken) {
      throw new Error("No active gateway session");
    }

    const seq = options?.seq ?? this.publishSeq + 1;
    const part =
      bytes instanceof Uint8Array ? Uint8Array.from(bytes) : new Uint8Array(bytes);
    const body = new Blob([part]);

    const response = await this.fetchImpl(
      `${this.baseUrl}/api/gateway/sessions/${encodeURIComponent(this.sessionId)}/publish/${seq}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.signerToken}`,
          "Content-Type": options?.contentType ?? "application/octet-stream",
        },
        body,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`publishSegment failed (${response.status}): ${text.slice(0, 300)}`);
    }

    this.publishSeq = seq;
    return { seq, ok: true };
  }

  /**
   * Fetch the next orchestrator output segment (sequential walk from subscribeSeq).
   * Matches livepeer-python-gateway TrickleSubscriber / MediaOutput segment iteration.
   */
  async subscribeOutputSegment(): Promise<GatewayLiveSubscribeSegment | null> {
    const chunks: Uint8Array[] = [];
    const segment = await this.subscribeOutputSegmentStream((chunk) => {
      chunks.push(chunk);
    });
    if (!segment) {
      return null;
    }
    const total = chunks.reduce((sum, part) => sum + part.byteLength, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const part of chunks) {
      joined.set(part, offset);
      offset += part.byteLength;
    }
    return { ...segment, data: joined.buffer, byteCount: total };
  }

  /**
   * Stream the next orchestrator output segment incrementally.
   * Mirrors Python SegmentReader behavior (consume bytes before segment closes).
   */
  async subscribeOutputSegmentStream(
    onChunk: (chunk: Uint8Array) => void,
  ): Promise<Omit<GatewayLiveSubscribeSegment, "data" | "byteCount"> & { byteCount: number } | null> {
    if (!this.sessionId || !this.signerToken) {
      throw new Error("No active gateway session");
    }

    const requestedSeq = this.subscribeSeq;
    const url = new URL(
      `${this.baseUrl}/api/gateway/sessions/${encodeURIComponent(this.sessionId)}/subscribe`,
    );
    url.searchParams.set("seq", String(requestedSeq));

    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.signerToken}`,
      },
    });

    if (response.status === 204) {
      this.handleSubscribeEmpty(requestedSeq, response.headers);
      return null;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`subscribeOutputSegment failed (${response.status}): ${text.slice(0, 300)}`);
    }

    this.subscribeEmptyPolls = 0;
    const segmentSeq = parseHeaderInt(response.headers, "X-Gateway-Segment-Seq");
    const latestSeq = parseHeaderInt(response.headers, "X-Gateway-Latest-Seq");
    const resolvedSegmentSeq = Number.isFinite(segmentSeq)
      ? segmentSeq
      : requestedSeq >= 0
        ? requestedSeq
        : 0;
    const resolvedLatest = Number.isFinite(latestSeq) ? latestSeq : resolvedSegmentSeq;

    if (!response.body) {
      const data = await response.arrayBuffer();
      if (data.byteLength === 0) {
        this.handleSubscribeEmpty(requestedSeq, response.headers);
        return null;
      }
      onChunk(new Uint8Array(data));
      this.advanceSubscribeSeq(requestedSeq, response.headers, resolvedLatest);
      return {
        segmentSeq: resolvedSegmentSeq,
        latestSeq: resolvedLatest,
        nextSeq: this.subscribeSeq,
        byteCount: data.byteLength,
      };
    }

    const reader = response.body.getReader();
    let bytesRead = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value && value.byteLength > 0) {
          bytesRead += value.byteLength;
          onChunk(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (bytesRead === 0) {
      this.handleSubscribeEmpty(requestedSeq, response.headers);
      return null;
    }

    this.advanceSubscribeSeq(requestedSeq, response.headers, resolvedLatest);
    return {
      segmentSeq: resolvedSegmentSeq,
      latestSeq: resolvedLatest,
      nextSeq: this.subscribeSeq,
      byteCount: bytesRead,
    };
  }

  /** @deprecated Use subscribeOutputSegment() — live-edge-only polling does not advance output seq. */
  async subscribeLiveSegment(): Promise<GatewayLiveSubscribeSegment | null> {
    return this.subscribeOutputSegment();
  }

  private advanceSubscribeSeq(
    requestedSeq: number,
    headers: Headers,
    latestSeq: number,
  ): void {
    const nextHeader = parseHeaderInt(headers, "X-Gateway-Next-Seq");
    if (Number.isFinite(nextHeader)) {
      this.subscribeSeq = nextHeader;
    } else {
      const segmentSeq = parseHeaderInt(headers, "X-Gateway-Segment-Seq");
      if (Number.isFinite(segmentSeq) && segmentSeq >= 0) {
        this.subscribeSeq = segmentSeq + 1;
      } else if (requestedSeq >= 0) {
        this.subscribeSeq = requestedSeq + 1;
      } else if (Number.isFinite(latestSeq) && latestSeq >= 0) {
        this.subscribeSeq = latestSeq + 1;
      } else {
        this.subscribeSeq = TRICKLE_SEQ_LATEST;
      }
    }

    // Skip a large output backlog (MediaOutput LagPolicy.LATEST).
    if (
      Number.isFinite(latestSeq) &&
      latestSeq >= 0 &&
      this.subscribeSeq >= 0 &&
      latestSeq - this.subscribeSeq > 2
    ) {
      this.subscribeSeq = latestSeq;
    }
  }

  private handleSubscribeEmpty(requestedSeq: number, headers: Headers): void {
    this.subscribeEmptyPolls += 1;
    const latest = parseHeaderInt(headers, "X-Gateway-Latest-Seq");
    const wait = headers.get("X-Gateway-Wait") === "1";

    if (Number.isFinite(latest)) {
      if (wait && requestedSeq >= 0 && latest < requestedSeq) {
        // Polling ahead of live edge — retry same index (trickle_subscriber.py).
        this.subscribeSeq = requestedSeq;
        return;
      }
      if (isTrickleLeadingIndex(requestedSeq)) {
        // Leading-index bootstrap: -2 -> -1 -> latest >= 0 when available.
        this.subscribeSeq = latest >= 0 ? latest : TRICKLE_SEQ_LATEST;
        this.subscribeEmptyPolls = 0;
        return;
      }
      if (requestedSeq >= 0 && latest === requestedSeq) {
        this.subscribeSeq = requestedSeq;
        return;
      }
      if (requestedSeq >= 0 && latest > requestedSeq) {
        this.subscribeSeq = latest;
        this.subscribeEmptyPolls = 0;
        return;
      }
    }

    // No latest header: keep retrying current output index rather than rewinding.
    if (requestedSeq >= 0) {
      this.subscribeSeq = requestedSeq;
      return;
    }

    if (this.subscribeEmptyPolls >= 12) {
      this.subscribeSeq = TRICKLE_SEQ_LATEST;
      this.subscribeEmptyPolls = 0;
    }
  }

  async subscribeSegment(seq?: number): Promise<ArrayBuffer | null> {
    if (seq !== undefined) {
      this.subscribeSeq = seq;
    }
    const segment = await this.subscribeOutputSegment();
    return segment?.data ?? null;
  }

  async stop(): Promise<void> {
    if (!this.sessionId || !this.signerToken) {
      return;
    }

    await this.fetchImpl(
      `${this.baseUrl}/api/gateway/sessions/${encodeURIComponent(this.sessionId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.signerToken}`,
        },
      },
    ).catch(() => undefined);

    this.sessionId = null;
    this.publishSeq = -1;
    this.subscribeSeq = TRICKLE_SEQ_CURRENT;
    this.subscribeEmptyPolls = 0;
  }
}

import { GatewayError } from "./errors.js";

export class TricklePublisher {
  private readonly baseUrl: string;
  private readonly mimeType: string;
  private seq = -1;
  private closed = false;

  constructor(url: string, mimeType: string) {
    this.baseUrl = url.replace(/\/+$/, "");
    this.mimeType = mimeType;
  }

  async writeMessage(message: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<void> {
    if (this.closed) {
      throw new GatewayError("Trickle publisher is closed");
    }
    const payload = JSON.stringify(message);
    const seq = await this.nextSeq(fetchImpl);
    const url = `${this.baseUrl}/${seq}`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": this.mimeType,
        ...(seq === 0 ? { "Lp-Trickle-Reset": "1" } : {}),
      },
      body: payload,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new GatewayError(`Trickle POST failed url=${url} status=${response.status} body=${body}`);
    }
  }

  private async nextSeq(fetchImpl: typeof fetch): Promise<number> {
    if (this.seq >= 0) {
      this.seq += 1;
      return this.seq;
    }
    try {
      const response = await fetchImpl(`${this.baseUrl}/next`);
      const latest = response.headers.get("Lp-Trickle-Latest");
      this.seq = latest ? Number(latest) : 0;
    } catch {
      this.seq = 0;
    }
    return this.seq;
  }

  async close(fetchImpl: typeof fetch = fetch): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await fetchImpl(this.baseUrl, { method: "DELETE" });
    } catch {
      /* best effort */
    }
  }
}

export async function* subscribeTrickleJson(
  url: string,
  options: {
    startSeq?: number;
    maxRetries?: number;
    maxEventBytes?: number;
    fetchImpl?: typeof fetch;
  } = {},
): AsyncGenerator<Record<string, unknown>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const startSeq = options.startSeq ?? -2;
  const maxRetries = options.maxRetries ?? 5;
  const maxEventBytes = options.maxEventBytes ?? 1_048_576;
  let seq = startSeq;
  let errored = false;

  while (!errored) {
    const segmentUrl = `${url.replace(/\/+$/, "")}/${seq}`;
    let response: Response | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        response = await fetchImpl(segmentUrl);
      } catch {
        if (attempt < maxRetries - 1) {
          await sleep(500);
          continue;
        }
        errored = true;
        break;
      }

      if (response.status === 404) {
        return;
      }
      if (response.status === 470) {
        const latest = response.headers.get("Lp-Trickle-Latest");
        const latestSeq = latest ? Number(latest) : seq;
        if (latestSeq < seq) {
          await sleep(250);
          continue;
        }
        seq = latestSeq;
        break;
      }
      if (response.ok) break;
      if (attempt < maxRetries - 1) {
        await sleep(500);
      } else {
        errored = true;
      }
    }

    if (!response || !response.ok) {
      if (errored) return;
      continue;
    }

    const headerSeq = response.headers.get("Lp-Trickle-Seq");
    if (headerSeq) {
      seq = Number(headerSeq) + 1;
    } else if (seq >= 0) {
      seq += 1;
    }

    const buffer = await readLimited(response, maxEventBytes);
    if (!buffer.trim()) continue;

    let data: unknown;
    try {
      data = JSON.parse(buffer);
    } catch (error) {
      throw new GatewayError(
        `Trickle event JSON decode failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new GatewayError("Trickle event must be JSON object");
    }
    yield data as Record<string, unknown>;
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new GatewayError(`Trickle event exceeded maxEventBytes (${maxBytes})`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

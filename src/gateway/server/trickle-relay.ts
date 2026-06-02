import { TRICKLE_SEQ_LATEST } from "../types.js";
import { insecureFetch } from "./http-insecure.js";
import type { GatewaySessionRecord } from "./session-store.js";

function parseTrickleIntHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function publishBaseUrl(record: GatewaySessionRecord): string {
  return record.publishUrl.replace(/\/$/, "");
}

function subscribeBaseUrl(record: GatewaySessionRecord): string {
  return record.subscribeUrl.replace(/\/$/, "");
}

export async function ensureTrickleChannel(record: GatewaySessionRecord): Promise<void> {
  if (record.trickleCreated) {
    return;
  }
  const response = await insecureFetch(record.publishUrl, {
    method: "POST",
    headers: {
      "Expect-Content": record.mimeType,
    },
    body: Buffer.alloc(0),
    timeoutMs: 10_000,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Trickle create failed HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  record.trickleCreated = true;
}

/** Resolve starting sequence from trickle GET {publishUrl}/next (matches Python publisher). */
export async function resolveTricklePublishSeq(record: GatewaySessionRecord): Promise<number> {
  await ensureTrickleChannel(record);
  const url = `${publishBaseUrl(record)}/next`;
  const response = await insecureFetch(url, {
    method: "GET",
    timeoutMs: 10_000,
  });
  if (!response.ok) {
    return 0;
  }
  const latest = response.headers.get("Lp-Trickle-Latest");
  if (latest !== null) {
    const parsed = Number.parseInt(latest, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export async function prepareTricklePublish(record: GatewaySessionRecord): Promise<void> {
  await ensureTrickleChannel(record);
  if (record.publishSeq < 0) {
    record.publishSeq = await resolveTricklePublishSeq(record);
  }
}

export async function publishTrickleSegment(
  record: GatewaySessionRecord,
  seq: number,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  await prepareTricklePublish(record);

  const url = `${publishBaseUrl(record)}/${seq}`;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
  };
  if (!record.trickleResetSent) {
    headers["Lp-Trickle-Reset"] = "1";
    record.trickleResetSent = true;
  }

  const response = await insecureFetch(url, {
    method: "POST",
    headers,
    body: bytes,
    timeoutMs: 120_000,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Trickle publish failed HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  record.publishSeq = Math.max(record.publishSeq, seq + 1);
}

export type TrickleSubscribeResult =
  | {
      data: ReadableStream<Uint8Array>;
      contentType: string;
      segmentSeq: number;
      nextSeq: number;
      latestSeq: number;
    }
  | { wait: true; latestSeq: number };

/** Leading-edge subscribe index via GET {subscribeUrl}/next (plain-text body + header). */
export async function resolveTrickleSubscribeSeq(record: GatewaySessionRecord): Promise<number> {
  const url = `${subscribeBaseUrl(record)}/next`;
  const response = await insecureFetch(url, {
    method: "GET",
    timeoutMs: 10_000,
  });
  if (!response.ok) {
    return TRICKLE_SEQ_LATEST;
  }
  const fromHeader = parseTrickleIntHeader(response.headers, "Lp-Trickle-Latest");
  if (fromHeader !== null) {
    return fromHeader;
  }
  const body = (await response.text()).trim();
  const fromBody = Number.parseInt(body, 10);
  return Number.isFinite(fromBody) ? fromBody : TRICKLE_SEQ_LATEST;
}

export async function subscribeTrickleSegment(
  record: GatewaySessionRecord,
  seq: number,
): Promise<TrickleSubscribeResult | null> {
  const url = `${subscribeBaseUrl(record)}/${seq}`;
  const response = await insecureFetch(url, {
    method: "GET",
    headers: record.trickleCreated ? { Connection: "close" } : undefined,
    timeoutMs: 30_000,
  });

  if (response.status === 404) {
    // Match TrickleSubscriber behavior: expose leading edge so caller can resync.
    const latest = await resolveTrickleSubscribeSeq(record);
    return { wait: true, latestSeq: latest };
  }

  if (response.status === 470) {
    const latestHeader = response.headers.get("Lp-Trickle-Latest");
    const parsedLatest = latestHeader ? Number.parseInt(latestHeader, 10) : Number.NaN;
    const latest = Number.isFinite(parsedLatest)
      ? parsedLatest
      : await resolveTrickleSubscribeSeq(record);
    // Polling ahead of the live edge — wait for the orchestrator to catch up.
    if (latest < seq) {
      return { wait: true, latestSeq: latest };
    }
    // No progress possible yet (e.g. seq=-2, latest=-2): instruct caller to wait.
    if (latest === seq) {
      return { wait: true, latestSeq: latest };
    }
    return subscribeTrickleSegment(record, latest);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Trickle subscribe failed HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = response.body;
  if (!data) {
    throw new Error("Trickle subscribe response missing body stream");
  }
  const contentType = response.headers.get("Content-Type") ?? record.mimeType;
  const segmentSeq =
    parseTrickleIntHeader(response.headers, "Lp-Trickle-Seq") ?? Math.max(seq, 0);
  const latestSeq =
    parseTrickleIntHeader(response.headers, "Lp-Trickle-Latest") ?? segmentSeq;
  return { data, contentType, segmentSeq, nextSeq: segmentSeq + 1, latestSeq };
}

export async function closeTricklePublish(record: GatewaySessionRecord): Promise<void> {
  if (!record.trickleCreated) {
    return;
  }
  await insecureFetch(record.publishUrl, {
    method: "DELETE",
    timeoutMs: 5_000,
  }).catch(() => undefined);
  record.trickleCreated = false;
}

/** Shared gateway types (browser + server). */

export const LIVE_VIDEO_TO_VIDEO_CAPABILITY_ID = 35;

export const DEFAULT_TRICKLE_MIME_TYPE = "video/mp2t";

export const DEFAULT_DISCOVERY_TIMEOUT_MS = 60_000;

/** Trickle GET index: live edge (next write / most recent publish). */
export const TRICKLE_SEQ_LATEST = -1;

/** Trickle GET index: current in-flight segment (nextWrite - 1). */
export const TRICKLE_SEQ_CURRENT = -2;

export type StartGatewaySessionRequest = {
  modelId: string;
  orchestratorUrl?: string;
  discoveryUrl?: string;
  params?: Record<string, unknown>;
  streamId?: string;
  requestId?: string;
};

export type StartGatewaySessionResponse = {
  sessionId: string;
  manifestId: string;
  /** Trickle segment MIME (usually video/mp2t). */
  mimeType?: string;
  /** First trickle publish sequence index (from orch /next). */
  publishSeq?: number;
  /** Initial trickle subscribe index (default TRICKLE_SEQ_CURRENT / -2). */
  subscribeSeq?: number;
};

export type GatewaySessionPublic = {
  sessionId: string;
  manifestId: string;
  mimeType: string;
};

export type GatewaySegmentPublishResult = {
  seq: number;
  ok: boolean;
};

export type GatewaySubscribeResult = {
  seq: number;
  data: ArrayBuffer;
  contentType: string;
} | null;

/** One completed trickle output segment from subscribeOutputSegment(). */
export type GatewayLiveSubscribeSegment = {
  data: ArrayBuffer;
  segmentSeq: number;
  latestSeq: number;
  /** Client index for the following GET (segmentSeq + 1 after a successful read). */
  nextSeq: number;
  /** Total bytes read from this segment response (used for progressive dedupe). */
  byteCount: number;
};

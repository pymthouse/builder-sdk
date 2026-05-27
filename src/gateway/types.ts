import type { OrchestratorRejection } from "./errors.js";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface GatewayTokenPayload {
  orchestrators?: string[];
  signer?: string;
  discovery?: string;
  billing?: string;
  billing_access_token?: string;
  signer_headers?: Record<string, string>;
  discovery_headers?: Record<string, string>;
}

export interface SignerConfig {
  signerUrl?: string;
  signerHeaders?: Record<string, string>;
  discoveryUrl?: string;
  discoveryHeaders?: Record<string, string>;
  orchestrators?: string[];
}

export interface BYOCJobRequestInput {
  capability: string;
  requestId?: string;
  streamId?: string;
  request?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  body?: Record<string, unknown>;
  timeoutSeconds?: number;
  enableVideoIngress?: boolean;
  enableVideoEgress?: boolean;
  enableDataOutput?: boolean;
  streamStartEndpoint?: string;
  streamPaymentEndpoint?: string;
}

export interface BYOCJobStartOptions {
  orchestrators?: string | string[];
  token?: string;
  signerUrl?: string;
  signerHeaders?: Record<string, string>;
  discoveryUrl?: string;
  discoveryHeaders?: Record<string, string>;
  useTofu?: boolean;
}

export interface BYOCJobRecord {
  jobId: string;
  capability: string;
  publishUrl?: string;
  subscribeUrl?: string;
  controlUrl?: string;
  eventsUrl?: string;
  dataUrl?: string;
  status: "running" | "stopped" | "error";
}

export interface StartJobResponse {
  job: BYOCJobRecord;
  proxy: {
    controlUrl: string;
    eventsUrl: string;
    stopUrl: string;
    statusUrl: string;
    wsUrl?: string;
  };
}

export interface GatewayJobStatus {
  jobId: string;
  capability: string;
  status: BYOCJobRecord["status"];
  error?: string;
}

export interface GatewayProxyOptions {
  basePath?: string;
  billingBaseUrl?: string;
  discoveryUrl?: string;
  useTofu?: boolean;
  enableWebSocket?: boolean;
  authenticate?: (
    req: import("node:http").IncomingMessage,
  ) => Promise<SignerConfig | null> | SignerConfig | null;
}

export interface PmtHouseGatewayClientOptions {
  basePath?: string;
  accessToken?: string;
  getAccessToken?: () => Promise<string | null> | string | null;
  fetch?: FetchLike;
}

export interface GatewayEventMap {
  "pymthouse-job-start": CustomEvent<{ job: BYOCJobRecord }>;
  "pymthouse-job-event": CustomEvent<{ jobId: string; data: Record<string, unknown> }>;
  "pymthouse-job-error": CustomEvent<{ jobId?: string; error: string }>;
  "pymthouse-job-stop": CustomEvent<{ jobId: string; statusCode?: number }>;
}

export type OrchestratorInfoMessage = Record<string, unknown>;

export interface GetPaymentResponse {
  payment: string;
  segCreds?: string;
}

export interface SignedBYOCJob {
  sender: string;
  signature: string;
}

export interface StartByocJobResult {
  job: BYOCJobRecord;
  rejections?: OrchestratorRejection[];
}

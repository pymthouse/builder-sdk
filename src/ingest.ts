import { encodeClientSecretBasic } from "./encoding.js";
import { PmtHouseError } from "./errors.js";
import { stripTrailingSlashes } from "./string-utils.js";
import type {
  FetchLike,
  SignedTicketIngestInput,
  SignedTicketIngestResult,
} from "./types.js";
import type { SignerUsageSnapshot } from "./signer/proxy.js";

export type IngestSignedTicketOptions = {
  issuerUrl: string;
  publicClientId: string;
  m2mClientId: string;
  m2mClientSecret: string;
  ticket: SignedTicketIngestInput;
  fetch?: FetchLike;
};

export type IngestSignedTicketsBatchOptions = Omit<IngestSignedTicketOptions, "ticket"> & {
  tickets: SignedTicketIngestInput[];
};

export function signerSnapshotToIngestPayload(input: {
  snapshot: SignerUsageSnapshot;
  externalUserId: string;
  gatewayRequestId?: string;
}): SignedTicketIngestInput {
  return {
    requestId: input.snapshot.requestId,
    externalUserId: input.externalUserId,
    networkFeeUsdMicros: input.snapshot.computedFeeUsdMicros.toString(),
    feeWei: input.snapshot.computedFeeWei,
    pixels: input.snapshot.pixels,
    pipeline: input.snapshot.pipeline,
    modelId: input.snapshot.modelId,
    gatewayRequestId: input.gatewayRequestId,
    ethUsdPrice: input.snapshot.ethUsdPrice,
    ethUsdRoundId: input.snapshot.ethUsdRoundId,
    ethUsdObservedAt: input.snapshot.ethUsdObservedAt,
  };
}

function ingestUrl(issuerUrl: string, publicClientId: string): string {
  const origin = new URL(stripTrailingSlashes(issuerUrl)).origin;
  return `${origin}/api/v1/apps/${encodeURIComponent(publicClientId)}/usage/signed-tickets`;
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function ingestSignedTicket(
  options: IngestSignedTicketOptions,
): Promise<SignedTicketIngestResult> {
  const fetchImpl = options.fetch ?? fetch;
  const url = ingestUrl(options.issuerUrl, options.publicClientId);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: encodeClientSecretBasic(options.m2mClientId, options.m2mClientSecret),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(options.ticket),
    cache: "no-store",
  });

  const body = await readJsonResponse(response);
  if (!response.ok) {
    const message =
      typeof body.error === "string"
        ? body.error
        : `Signed-ticket ingest failed (${response.status})`;
    throw new PmtHouseError(message, {
      status: response.status,
      code: "ingest_failed",
      details: body,
    });
  }

  return {
    ingested: Boolean(body.ingested),
    duplicate: Boolean(body.duplicate),
    source: body.source === "openmeter" ? "openmeter" : "disabled",
  };
}

export async function ingestSignedTicketsBatch(
  options: IngestSignedTicketsBatchOptions,
): Promise<{ results: Array<SignedTicketIngestResult & { requestId?: string; ok?: boolean }> }> {
  const fetchImpl = options.fetch ?? fetch;
  const url = ingestUrl(options.issuerUrl, options.publicClientId);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: encodeClientSecretBasic(options.m2mClientId, options.m2mClientSecret),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ tickets: options.tickets }),
    cache: "no-store",
  });

  const body = await readJsonResponse(response);
  if (!response.ok) {
    const message =
      typeof body.error === "string"
        ? body.error
        : `Signed-ticket batch ingest failed (${response.status})`;
    throw new PmtHouseError(message, {
      status: response.status,
      code: "ingest_failed",
      details: body,
    });
  }

  const rawResults = Array.isArray(body.results) ? body.results : [];
  return {
    results: rawResults.map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      return {
        requestId: typeof row.requestId === "string" ? row.requestId : undefined,
        ok: row.ok === true,
        ingested: Boolean(row.ingested),
        duplicate: Boolean(row.duplicate),
        source: row.source === "openmeter" ? "openmeter" : "disabled",
      };
    }),
  };
}

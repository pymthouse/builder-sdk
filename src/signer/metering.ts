import { ingestSignedTicket, signerSnapshotToIngestPayload } from "../ingest.js";
import {
  parseSignerUsageSnapshot,
  readSignerUpstreamBody,
  stripSignerUsageFromResponse,
} from "./proxy.js";
import { resolvesToHostedMetering } from "./types.js";
import type { DirectSignerProxyConfig } from "./types.js";

export async function forwardWithOptionalMetering(input: {
  config: DirectSignerProxyConfig;
  publicClientId: string;
  externalUserId: string;
  forward: () => Promise<Response>;
}): Promise<Response> {
  const upstream = await input.forward();
  const mode = input.config.metering?.mode;
  if (!resolvesToHostedMetering(mode)) {
    return upstream;
  }

  const body = await readSignerUpstreamBody(upstream);
  const snapshot =
    upstream.ok && body !== null && typeof body === "object"
      ? parseSignerUsageSnapshot(body)
      : null;
  if (snapshot) {
    stripSignerUsageFromResponse(body);
  }

  if (upstream.ok && snapshot && snapshot.computedFeeUsdMicros > 0n) {
    try {
      await ingestSignedTicket({
        issuerUrl: input.config.pymthouseIssuerUrl,
        publicClientId: input.publicClientId,
        m2mClientId: input.config.pymthouseM2MClientId,
        m2mClientSecret: input.config.pymthouseM2MClientSecret,
        ticket: signerSnapshotToIngestPayload({
          snapshot,
          externalUserId: input.externalUserId,
        }),
        fetch: input.config.fetch,
      });
    } catch (err) {
      console.warn("[builder-sdk] signed-ticket ingest failed:", err);
    }
  }

  const headers = new Headers(upstream.headers);
  if (!headers.has("content-type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Response(JSON.stringify(body), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

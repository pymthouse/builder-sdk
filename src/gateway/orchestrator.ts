import { RemoteSignerError } from "./errors.js";
import { appendCaps, getJson, joinSignerEndpoint } from "./http.js";
import type { CapabilitiesMessage } from "./capabilities.js";
import { capabilitiesToQuery } from "./capabilities.js";

export async function discoverOrchestrators(options: {
  orchestrators?: string | string[] | null;
  signerUrl?: string;
  signerHeaders?: Record<string, string>;
  discoveryUrl?: string;
  discoveryHeaders?: Record<string, string>;
  capabilities?: CapabilitiesMessage | null;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  if (options.orchestrators != null) {
    const list = Array.isArray(options.orchestrators)
      ? options.orchestrators
      : options.orchestrators.split(",");
    const normalized = list.map((item) => item.trim()).filter(Boolean);
    if (normalized.length > 0) return normalized;
  }

  let discoveryEndpoint: string;
  let requestHeaders: Record<string, string> | undefined;
  if (options.discoveryUrl) {
    discoveryEndpoint = new URL(
      options.discoveryUrl.includes("://")
        ? options.discoveryUrl
        : `https://${options.discoveryUrl}`,
    ).toString();
    requestHeaders = options.discoveryHeaders;
  } else if (options.signerUrl) {
    discoveryEndpoint = joinSignerEndpoint(options.signerUrl, "/discover-orchestrators");
    requestHeaders = options.signerHeaders;
  } else {
    throw new RemoteSignerError("", "discover_orchestrators requires discovery_url or signer_url");
  }

  const caps = capabilitiesToQuery(options.capabilities ?? null);
  if (caps.length > 0) {
    discoveryEndpoint = appendCaps(discoveryEndpoint, caps);
  }

  let data: unknown;
  try {
    data = await getJson(discoveryEndpoint, {
      headers: requestHeaders,
      fetchImpl: options.fetchImpl,
    });
  } catch (error) {
    throw new RemoteSignerError(
      discoveryEndpoint,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!Array.isArray(data)) {
    throw new RemoteSignerError(
      discoveryEndpoint,
      `Discovery response must be a JSON list, got ${typeof data}`,
    );
  }

  const orchList: string[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const address = (item as { address?: unknown }).address;
    if (typeof address === "string" && address.trim()) {
      orchList.push(address.trim());
    }
  }
  return orchList;
}

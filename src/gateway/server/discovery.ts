import { appendCapabilityQuery } from "./capabilities.js";
import { httpOrigin, insecureFetch, readJsonResponse } from "./http-insecure.js";
import { DEFAULT_DISCOVERY_TIMEOUT_MS } from "../types.js";

const DISCOVERY_SERVICE_RAW_PATH = "/v1/discovery/raw";

export type DiscoverOrchestratorsInput = {
  orchestratorUrl?: string;
  discoveryUrl?: string;
  signerUrl?: string;
  signerHeaders?: Record<string, string>;
  modelId: string;
  discoveryTimeoutMs?: number;
};

function isDiscoveryServiceEndpoint(url: string): boolean {
  return url.includes(DISCOVERY_SERVICE_RAW_PATH);
}

function normalizeDiscoveryServiceUrl(url: string): string {
  const parsed = new URL(url.trim());
  let path = parsed.pathname.replace(/\/$/, "");
  if (!path.endsWith(DISCOVERY_SERVICE_RAW_PATH)) {
    if (path.endsWith("/v1/discovery") || !path) {
      path = DISCOVERY_SERVICE_RAW_PATH;
    }
  }
  parsed.pathname = path;
  if (!parsed.searchParams.has("serviceType")) {
    parsed.searchParams.set("serviceType", "legacy");
  }
  return parsed.toString();
}

function resolveDiscoveryEndpoint(input: DiscoverOrchestratorsInput): {
  url: string;
  headers?: Record<string, string>;
  discoveryService: boolean;
} {
  if (input.orchestratorUrl?.trim()) {
    const list = input.orchestratorUrl.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) {
      return { url: "", headers: input.signerHeaders, discoveryService: false };
    }
  }

  if (input.discoveryUrl?.trim()) {
    let url = input.discoveryUrl.trim();
    const discoveryService = isDiscoveryServiceEndpoint(url);
    if (discoveryService) {
      url = normalizeDiscoveryServiceUrl(url);
    }
    url = appendCapabilityQuery(url, input.modelId);
    return {
      url,
      headers: input.signerHeaders,
      discoveryService,
    };
  }

  if (input.signerUrl?.trim()) {
    const url = appendCapabilityQuery(
      `${httpOrigin(input.signerUrl)}/discover-orchestrators`,
      input.modelId,
    );
    return { url, headers: input.signerHeaders, discoveryService: false };
  }

  throw new Error("discovery requires orchestratorUrl, discoveryUrl, or signerUrl");
}

function parseDiscoveryList(data: unknown): string[] {
  if (!Array.isArray(data)) {
    throw new Error(`Discovery response must be a JSON list, got ${typeof data}`);
  }
  const urls: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const address =
      (typeof record.address === "string" && record.address) ||
      (typeof record.url === "string" && record.url);
    if (address?.trim()) {
      urls.push(address.trim());
    }
  }
  return urls;
}

export async function discoverOrchestrators(
  input: DiscoverOrchestratorsInput,
): Promise<string[]> {
  if (input.orchestratorUrl?.trim()) {
    return input.orchestratorUrl
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const { url, headers } = resolveDiscoveryEndpoint(input);
  const response = await insecureFetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...headers,
    },
    timeoutMs: input.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discovery failed HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = await readJsonResponse(response);
  return parseDiscoveryList(data);
}

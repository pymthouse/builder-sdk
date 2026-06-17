import { OpenMeter } from "@openmeter/sdk";
import {
  isKonnectMeteringUrl,
  normalizeKonnectMeteringUrl,
  shouldUseKonnectRoutes,
} from "./konnect/constants.js";
import { createKonnectFetch } from "./konnect/fetch.js";

export type CreateOpenMeterClientInput = {
  baseUrl: string;
  apiKey?: string;
};

/**
 * Create an @openmeter/sdk client for OpenMeter Cloud, self-hosted OpenMeter, or
 * Kong Konnect (https://{region}.api.konghq.com/v3/openmeter with kpat_ keys).
 *
 * Konnect uses different paths and response shapes than openmeter.io; when detected,
 * a custom fetch rewrites SDK requests to the Konnect Metering & Billing v3 API.
 */
export function createOpenMeterClient(input: CreateOpenMeterClientInput): OpenMeter {
  const apiKey = input.apiKey?.trim() || undefined;
  const rawBaseUrl = input.baseUrl.replace(/\/$/, "");
  const useKonnectRoutes = shouldUseKonnectRoutes(rawBaseUrl, apiKey);
  const baseUrl = useKonnectRoutes ? normalizeKonnectMeteringUrl(rawBaseUrl) : rawBaseUrl;
  const clientFetch = useKonnectRoutes ? createKonnectFetch(baseUrl) : undefined;

  if (apiKey) {
    return new OpenMeter({ baseUrl, apiKey, fetch: clientFetch });
  }
  return new OpenMeter({ baseUrl, fetch: clientFetch });
}

export { isKonnectMeteringUrl, normalizeKonnectMeteringUrl };

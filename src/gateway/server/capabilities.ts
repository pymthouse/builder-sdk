import { LIVE_VIDEO_TO_VIDEO_CAPABILITY_ID } from "../types.js";

/** Build discovery cap query value: `live-video-to-video/{modelId}`. */
export function modelCapabilityQuery(modelId: string): string {
  return `live-video-to-video/${modelId.trim()}`;
}

/** Plain object for OrchestratorRequest.capabilities via grpc proto-loader. */
export function buildLv2vCapabilitiesMessage(modelId: string): Record<string, unknown> {
  const capId = LIVE_VIDEO_TO_VIDEO_CAPABILITY_ID;
  return {
    capacities: { [capId]: 1 },
    constraints: {
      PerCapability: {
        [capId]: {
          models: {
            [modelId.trim()]: {},
          },
        },
      },
    },
  };
}

export function appendCapabilityQuery(url: string, modelId: string): string {
  const parsed = new URL(url);
  const cap = url.includes("/v1/discovery/raw")
    ? modelId.includes("/")
      ? modelId.split("/").pop()!
      : modelId
    : modelCapabilityQuery(modelId);
  parsed.searchParams.append("caps", cap);
  return parsed.toString();
}

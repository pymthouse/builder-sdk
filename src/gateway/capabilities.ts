export enum CapabilityId {
  BYOC = 37,
  LIVE_VIDEO_TO_VIDEO = 35,
}

export interface CapabilitiesMessage {
  capacities?: Record<number, number>;
  constraints?: {
    PerCapability?: Record<
      number,
      {
        models?: Record<string, Record<string, unknown>>;
      }
    >;
  };
}

export function buildCapabilities(
  capability: CapabilityId,
  constraint?: string,
): CapabilitiesMessage {
  const capId = capability;
  const caps: CapabilitiesMessage = {
    capacities: { [capId]: 1 },
    constraints: { PerCapability: {} },
  };
  if (constraint) {
    caps.constraints!.PerCapability![capId] = {
      models: { [constraint]: {} },
    };
  }
  return caps;
}

export function capabilityPipelineId(capId: number): string | null {
  if (capId === CapabilityId.BYOC) return "byoc";
  if (capId === CapabilityId.LIVE_VIDEO_TO_VIDEO) return "live-video-to-video";
  return null;
}

export function capabilitiesToQuery(caps: CapabilitiesMessage | null | undefined): string[] {
  if (!caps?.constraints?.PerCapability) return [];
  const values: string[] = [];
  const seen = new Set<string>();
  for (const capIdStr of Object.keys(caps.constraints.PerCapability).sort()) {
    const capId = Number(capIdStr);
    const pipelineId = capabilityPipelineId(capId);
    if (!pipelineId) continue;
    const models = caps.constraints.PerCapability[capId]?.models ?? {};
    for (const model of Object.keys(models).sort()) {
      if (!model) continue;
      const value = `${pipelineId}/${model}`;
      if (seen.has(value)) continue;
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

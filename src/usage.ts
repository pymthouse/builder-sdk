import type {
  UsageApiResponse,
  UsageByPipelineModelRow,
  UsageByUserRow,
  UsageForExternalUser,
} from "./types.js";

/**
 * Sum all `byUser` buckets whose `externalUserId` matches the provider user.
 *
 * PymtHouse may emit multiple rows for the same external user during transitions
 * (e.g. legacy internal ids vs external id on `usage_records.user_id`).
 */
export function aggregateUsageByExternalUserId(
  byUser: UsageByUserRow[] | undefined,
  externalUserId: string,
): UsageForExternalUser {
  const rows = byUser?.filter((row) => row.externalUserId === externalUserId) ?? [];
  if (rows.length === 0) {
    return {
      externalUserId,
      requestCount: 0,
      feeWei: "0",
    };
  }

  let feeWei = 0n;
  let requestCount = 0;
  for (const row of rows) {
    feeWei += BigInt(row.feeWei);
    requestCount += row.requestCount;
  }

  return {
    externalUserId,
    requestCount,
    feeWei: feeWei.toString(),
  };
}

/**
 * Convenience over {@link aggregateUsageByExternalUserId} using a full Usage API response.
 */
export function summarizeUsageForExternalUser(
  usage: UsageApiResponse,
  externalUserId: string,
): UsageForExternalUser {
  return aggregateUsageByExternalUserId(usage.byUser, externalUserId);
}

/**
 * Returns `byPipelineModel` rows from a Usage API response, sorted by `pipeline` then `modelId`.
 * Use with `getUsage({ groupBy: "pipeline_model", ... })`.
 */
export function listUsageByPipelineModel(usage: UsageApiResponse): UsageByPipelineModelRow[] {
  const rows = usage.byPipelineModel ?? [];
  return [...rows].sort((a, b) => {
    const p = a.pipeline.localeCompare(b.pipeline);
    if (p !== 0) return p;
    return a.modelId.localeCompare(b.modelId);
  });
}

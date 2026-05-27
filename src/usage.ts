import type {
  UsageApiResponse,
  UsageByPipelineModelFiatRow,
  UsageByUserRow,
  UsageForExternalUser,
  MeScopeUsagePayload,
} from "./types.js";

function parseSafeBigInt(value: string | number | bigint, fallback = 0n): bigint {
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
}

/** ISO bounds for the current calendar month in UTC (billing-friendly window). */
export function getUtcCalendarMonthIsoBounds(now: Date = new Date()): {
  startDate: string;
  endDate: string;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

/**
 * Parse a single date query value. Accepts ISO strings understood by `Date.parse`.
 * Returns `null` when missing, empty, or invalid.
 */
export function parseUsageDateParam(raw: string | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const t = Date.parse(trimmed);
  if (Number.isNaN(t)) return null;
  return trimmed;
}

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
    if (row.feeWei) {
      feeWei += BigInt(row.feeWei);
    }
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
 */
export function listUsageByPipelineModel(usage: UsageApiResponse) {
  const rows = usage.byPipelineModel ?? [];
  return [...rows].sort((a, b) => {
    const p = a.pipeline.localeCompare(b.pipeline);
    if (p !== 0) return p;
    return a.modelId.localeCompare(b.modelId);
  });
}

/** Map `externalUserId` to internal `endUserId` values for follow-up pipeline_model queries. */
export function getEndUserIdsForExternalUser(
  usage: UsageApiResponse,
  externalUserId: string,
): string[] {
  const userIds = new Set<string>();
  for (const row of usage.byUser ?? []) {
    if (row.externalUserId === externalUserId && row.endUserId !== "unknown") {
      userIds.add(row.endUserId);
    }
  }
  return [...userIds];
}

/** @deprecated Use {@link getEndUserIdsForExternalUser}. */
export const getUsageRecordUserIdsForExternalUser = getEndUserIdsForExternalUser;

export interface UsageFiatSummary {
  externalUserId: string;
  requestCount: number;
  currency: string;
  networkFeeUsdMicros: string;
  ownerChargeUsdMicros: string;
  endUserBillableUsdMicros: string;
}

/** Sum fiat usage fields across duplicate `byUser` buckets for one external user. */
export function summarizeUsageFiatForExternalUser(
  usageByUser: UsageApiResponse,
  externalUserId: string,
): UsageFiatSummary {
  const rows = usageByUser.byUser ?? [];
  let requestCount = 0;
  let networkFeeUsdMicros = 0n;
  let ownerChargeUsdMicros = 0n;
  let endUserBillableUsdMicros = 0n;
  let currency = "USD";

  for (const row of rows) {
    if (row.externalUserId !== externalUserId) continue;
    requestCount += row.requestCount;
    if (row.currency) currency = row.currency;
    if (row.networkFeeUsdMicros) {
      networkFeeUsdMicros += BigInt(row.networkFeeUsdMicros);
    }
    if (row.ownerChargeUsdMicros) {
      ownerChargeUsdMicros += BigInt(row.ownerChargeUsdMicros);
    }
    if (row.endUserBillableUsdMicros) {
      endUserBillableUsdMicros += BigInt(row.endUserBillableUsdMicros);
    }
  }

  return {
    externalUserId,
    requestCount,
    currency,
    networkFeeUsdMicros: networkFeeUsdMicros.toString(),
    ownerChargeUsdMicros: ownerChargeUsdMicros.toString(),
    endUserBillableUsdMicros: endUserBillableUsdMicros.toString(),
  };
}

/** Merge and sort pipeline/model rows from multiple Usage API responses. */
export function mergeUsageByPipelineModel(
  usagePipelineModels: UsageApiResponse | UsageApiResponse[] | undefined,
): UsageByPipelineModelFiatRow[] {
  let responses: UsageApiResponse[];
  if (Array.isArray(usagePipelineModels)) {
    responses = usagePipelineModels;
  } else if (usagePipelineModels) {
    responses = [usagePipelineModels];
  } else {
    responses = [];
  }
  const byKey = new Map<string, UsageByPipelineModelFiatRow>();

  for (const response of responses) {
    for (const row of response.byPipelineModel ?? []) {
      const { pipeline, modelId } = row;
      if (!pipeline || !modelId) continue;
      const key = JSON.stringify([pipeline, modelId]);
      const existing = byKey.get(key);
      const rowCurrency = row.currency ?? "USD";

      if (!existing) {
        byKey.set(key, {
          pipeline,
          modelId,
          requestCount: row.requestCount,
          currency: rowCurrency,
          networkFeeUsdMicros: row.networkFeeUsdMicros,
          ownerChargeUsdMicros: row.ownerChargeUsdMicros,
          endUserBillableUsdMicros: row.endUserBillableUsdMicros,
        });
        continue;
      }
      byKey.set(key, {
        ...existing,
        requestCount: existing.requestCount + row.requestCount,
        networkFeeUsdMicros: (
          parseSafeBigInt(existing.networkFeeUsdMicros) +
          parseSafeBigInt(row.networkFeeUsdMicros)
        ).toString(),
        ownerChargeUsdMicros: (
          parseSafeBigInt(existing.ownerChargeUsdMicros) +
          parseSafeBigInt(row.ownerChargeUsdMicros)
        ).toString(),
        endUserBillableUsdMicros: (
          parseSafeBigInt(existing.endUserBillableUsdMicros) +
          parseSafeBigInt(row.endUserBillableUsdMicros)
        ).toString(),
      });
    }
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.pipeline === b.pipeline) return a.modelId.localeCompare(b.modelId);
    return a.pipeline.localeCompare(b.pipeline);
  });
}

/** Build the session-scoped `scope=me` usage payload for integrator BFFs. */
export function buildMeScopeUsagePayload(
  usageByUser: UsageApiResponse,
  externalUserId: string,
  usagePipelineModel?: UsageApiResponse | UsageApiResponse[],
): MeScopeUsagePayload {
  const summary = summarizeUsageFiatForExternalUser(usageByUser, externalUserId);
  const pipelineModels = mergeUsageByPipelineModel(usagePipelineModel);
  return {
    clientId: usageByUser.clientId,
    period: usageByUser.period,
    currentUser: {
      externalUserId: summary.externalUserId,
      requestCount: summary.requestCount,
      currency: summary.currency,
      networkFeeUsdMicros: summary.networkFeeUsdMicros,
      ownerChargeUsdMicros: summary.ownerChargeUsdMicros,
      endUserBillableUsdMicros: summary.endUserBillableUsdMicros,
      pipelineModels,
    },
  };
}

/** Default cap for parallel pipeline_model fetches per external user (matches NaaP BFF). */
export const DEFAULT_MAX_END_USER_IDS = 25;

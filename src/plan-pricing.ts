/** Network cost pass-through: $1 retail per $1M of network USD-micros metered. */
export const NETWORK_USD_PER_MICRO = 0.000001;

const RETAIL_RATE_DECIMALS = 9;

/** Strip trailing fractional zeros without regex (avoids ReDoS on user-facing inputs). */
function trimFixedDecimalZeros(fixed: string): string {
  const dotIndex = fixed.indexOf(".");
  if (dotIndex === -1) {
    return fixed;
  }
  let end = fixed.length;
  while (end > dotIndex + 1 && fixed[end - 1] === "0") {
    end -= 1;
  }
  if (end === dotIndex + 1) {
    end = dotIndex;
  }
  const trimmed = fixed.slice(0, end);
  return trimmed.length > 0 ? trimmed : "0";
}

export function defaultRetailRateUsd(): string {
  return formatRetailRateUsd(NETWORK_USD_PER_MICRO);
}

export function formatRetailRateUsd(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return defaultRetailRateUsd();
  }
  return trimFixedDecimalZeros(value.toFixed(RETAIL_RATE_DECIMALS));
}

export function parseRetailRateUsd(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return formatRetailRateUsd(n);
}

/** Markup percent (e.g. 50 = 50%) → retail USD per network USD-micro. */
export function markupPercentToRetailRateUsd(markupPercent: number): string {
  const pct = Number.isFinite(markupPercent) ? Math.max(0, markupPercent) : 0;
  return formatRetailRateUsd(NETWORK_USD_PER_MICRO * (1 + pct / 100));
}

/** Retail USD per micro → markup percent string for UI (one decimal). */
export function retailRateUsdToMarkupPercent(raw: string | null | undefined): string {
  const rate = parseRetailRateUsd(raw);
  if (!rate) {
    return "";
  }
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= NETWORK_USD_PER_MICRO) {
    return n === NETWORK_USD_PER_MICRO ? "0" : "";
  }
  const pct = (n / NETWORK_USD_PER_MICRO - 1) * 100;
  if (!Number.isFinite(pct) || pct <= 0) {
    return "";
  }
  return pct % 1 === 0 ? String(Math.round(pct)) : pct.toFixed(1);
}

export function retailRateUsdPerMillion(raw: string | null | undefined): string {
  const rate = parseRetailRateUsd(raw);
  if (!rate) {
    return "";
  }
  const perM = Number(rate) * 1_000_000;
  if (!Number.isFinite(perM)) {
    return "";
  }
  return perM.toFixed(2);
}

export function parseMarkupPercentInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
}

/** Apply retail rate (USD per network micro) to network fee micros. */
export function applyRetailRateToNetworkMicros(
  networkFeeUsdMicros: bigint,
  retailRateUsd: string,
): bigint {
  const networkPerMicro = NETWORK_USD_PER_MICRO;
  const retail = Number(retailRateUsd);
  if (!Number.isFinite(retail) || retail <= 0) {
    return networkFeeUsdMicros;
  }
  const ratio = retail / networkPerMicro;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return networkFeeUsdMicros;
  }
  return (networkFeeUsdMicros * BigInt(Math.round(ratio * 1_000_000))) / 1_000_000n;
}

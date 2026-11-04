/** End-user `/me/billing` money APIs on owner_rollup apps. */
export const MERCHANT_BILLING_REQUIRED = "merchant_billing_required";
export const MERCHANT_WALLET_REQUIRED = "merchant_wallet_required";

export function isMerchantBillingRequiredError(error: unknown): boolean {
  if (!(error instanceof PmtHouseError) || error.status !== 403) {
    return false;
  }
  return (
    error.code === MERCHANT_BILLING_REQUIRED ||
    error.code === MERCHANT_WALLET_REQUIRED
  );
}

export class PmtHouseError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    {
      status = 500,
      code = "pymthouse_error",
      details,
    }: {
      status?: number;
      code?: string;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "PmtHouseError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function toPmtHouseError(
  error: unknown,
  fallbackMessage: string,
): PmtHouseError {
  if (error instanceof PmtHouseError) {
    return error;
  }

  if (error instanceof Error) {
    return new PmtHouseError(error.message || fallbackMessage, {
      code: "unexpected_error",
      status: 500,
    });
  }

  return new PmtHouseError(fallbackMessage, {
    code: "unexpected_error",
    status: 500,
  });
}

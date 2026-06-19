import { PmtHouseError } from "../errors.js";

/** HTTP statuses returned by go-livepeer remote signer to gateway clients. */
export const REMOTE_SIGNER_HTTP_STATUS = {
  REFRESH_SESSION: 480,
  PRICE_EXCEEDED: 481,
  NO_TICKETS: 482,
  INSUFFICIENT_BALANCE: 483,
} as const;

/** Machine-readable error codes forwarded through the identity webhook wire protocol. */
export const REMOTE_SIGNER_ERROR_CODE = {
  INSUFFICIENT_BALANCE: "insufficient_balance",
  BILLING_UNAVAILABLE: "billing_unavailable",
} as const;

export function insufficientBalanceError(message = "insufficient balance") {
  return new PmtHouseError(message, {
    status: REMOTE_SIGNER_HTTP_STATUS.INSUFFICIENT_BALANCE,
    code: REMOTE_SIGNER_ERROR_CODE.INSUFFICIENT_BALANCE,
  });
}

export function billingUnavailableError(message = "billing unavailable") {
  return new PmtHouseError(message, {
    status: 503,
    code: REMOTE_SIGNER_ERROR_CODE.BILLING_UNAVAILABLE,
  });
}

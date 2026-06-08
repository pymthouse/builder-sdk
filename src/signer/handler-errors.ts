import { PmtHouseError } from "../errors.js";

function isPmtHouseError(error: unknown): error is PmtHouseError {
  if (error instanceof PmtHouseError) {
    return true;
  }
  return (
    error instanceof Error &&
    typeof (error as PmtHouseError).status === "number" &&
    typeof (error as PmtHouseError).code === "string"
  );
}

export function signerHandlerErrorResponse(error: unknown): Response {
  if (isPmtHouseError(error)) {
    return new Response(
      JSON.stringify({
        error: error.code,
        error_description: error.message,
        details: error.details,
      }),
      {
        status: error.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const message = error instanceof Error ? error.message : "Internal error";
  return new Response(JSON.stringify({ error: "internal_error", error_description: message }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

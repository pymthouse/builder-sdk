import { PmtHouseError } from "../errors.js";

export function signerHandlerErrorResponse(error: unknown): Response {
  if (error instanceof PmtHouseError) {
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

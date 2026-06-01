export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization")?.trim();
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match?.[1]?.trim()) {
    return null;
  }
  return match[1].trim();
}

export function unauthorizedResponse(message = "unauthorized"): Response {
  return Response.json({ error: message }, { status: 401 });
}

export function forbiddenResponse(message = "forbidden"): Response {
  return Response.json({ error: message }, { status: 403 });
}

export function disabledResponse(): Response {
  return Response.json(
    {
      error: "gateway_disabled",
      error_description: "Set GATEWAY_ENABLED=1 to enable the browser gateway relay",
    },
    { status: 503 },
  );
}

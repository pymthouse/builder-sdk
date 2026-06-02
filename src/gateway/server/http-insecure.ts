import http from "node:http";
import https from "node:https";

export type InsecureFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string | Uint8Array;
  timeoutMs?: number;
  signal?: AbortSignal;
};

const insecureHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export async function insecureFetch(
  url: string,
  init: InsecureFetchInit = {},
): Promise<Response> {
  const parsed = new URL(url.includes("://") ? url : `https://${url}`);
  const isHttps = parsed.protocol === "https:";
  const lib = isHttps ? https : http;
  const timeoutMs = init.timeoutMs ?? 60_000;

  const body =
    init.body === undefined
      ? undefined
      : init.body instanceof Buffer
        ? init.body
        : Buffer.from(init.body);

  return new Promise((resolve, reject) => {
    const headers = { ...init.headers };
    if (body !== undefined && !headers["Content-Length"]) {
      headers["Content-Length"] = String(body.length);
    }

    const req = lib.request(
      parsed,
      {
        method: init.method ?? (body !== undefined ? "POST" : "GET"),
        headers,
        agent: isHttps ? insecureHttpsAgent : undefined,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const merged = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) {
              continue;
            }
            if (Array.isArray(value)) {
              for (const item of value) {
                responseHeaders.append(key, item);
              }
            } else {
              responseHeaders.set(key, value);
            }
          }
          resolve(
            new Response(merged, {
              status: res.statusCode ?? 0,
              headers: responseHeaders,
            }),
          );
        });
      },
    );

    const timer = setTimeout(() => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    if (init.signal) {
      init.signal.addEventListener("abort", () => {
        req.destroy(new Error("aborted"));
      });
    }

    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.on("close", () => clearTimeout(timer));

    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

export async function readJsonResponse<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

export function httpOrigin(url: string): string {
  const parsed = new URL(url.includes("://") ? url : `https://${url}`);
  return `${parsed.protocol}//${parsed.host}`;
}

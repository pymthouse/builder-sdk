import { createServer, type Server } from "node:http";
import { readOidcRemoteSignerWebhookConfigFromEnv } from "./config.js";
import { routeRemoteSignerWebhookRequest, type RemoteSignerWebhookConfig } from "./authorize.js";

export type RemoteSignerWebhookServerOptions = {
  config?: RemoteSignerWebhookConfig;
  addr?: string;
  port?: number;
};

export function startRemoteSignerWebhookServer(
  options: RemoteSignerWebhookServerOptions = {},
): Server {
  const config = options.config ?? readOidcRemoteSignerWebhookConfigFromEnv();
  const port = options.port ?? Number(process.env.PORT ?? 8090);
  const addr = options.addr ?? process.env.ADDR ?? "0.0.0.0";

  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "localhost";
      const url = `http://${host}${req.url ?? "/"}`;
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") {
          headers.set(name, value);
        } else if (Array.isArray(value)) {
          for (const item of value) {
            headers.append(name, item);
          }
        }
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);

      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });

      const response =
        (await routeRemoteSignerWebhookRequest(request, config)) ??
        new Response("not found", { status: 404 });

      res.statusCode = response.status;
      response.headers.forEach((value, name) => {
        res.setHeader(name, value);
      });
      const responseBody = Buffer.from(await response.arrayBuffer());
      res.end(responseBody);
    } catch (err) {
      const message = err instanceof Error ? err.message : "internal error";
      res.statusCode = 500;
      res.end(message);
    }
  });

  server.listen(port, addr, () => {
    console.log(
      `[builder-sdk] remote signer identity webhook listening on http://${addr}:${port}`,
    );
    console.log(
      `[builder-sdk] end-user auth strategy=${config.endUserAuth.kind}`,
    );
  });

  return server;
}

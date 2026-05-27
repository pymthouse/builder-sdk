/**
 * Example: attach the gateway proxy to an existing HTTP server.
 *
 * Run with: node --import tsx examples/gateway-server.ts
 */
import http from "node:http";

import { attachPmtHouseGatewayProxy } from "../src/gateway/server.js";

const billingBaseUrl = process.env.PYMTHOUSE_ISSUER_URL ?? "http://localhost:3001";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

attachPmtHouseGatewayProxy(server, {
  billingBaseUrl,
  basePath: "/pymthouse/gateway",
});

server.listen(3000, () => {
  console.log("Gateway proxy listening on http://localhost:3000/pymthouse/gateway");
});

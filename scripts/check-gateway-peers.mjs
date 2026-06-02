#!/usr/bin/env node
/** Verify optional gRPC peers are installed (used by gateway/server). */
try {
  await import("@grpc/grpc-js");
  await import("@grpc/proto-loader");
  console.log("gateway peers: ok");
} catch {
  console.error("Install @grpc/grpc-js and @grpc/proto-loader for gateway/server");
  process.exit(1);
}

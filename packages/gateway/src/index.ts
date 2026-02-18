// @spaceduck/gateway — composition root
// Entry point: create and start the gateway

import { createGateway } from "./gateway";

const gateway = await createGateway();

// Start the server
await gateway.start();

// Graceful shutdown — guard against double-fire from bun --watch
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await gateway.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("beforeExit", shutdown);

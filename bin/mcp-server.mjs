#!/usr/bin/env node
console.log = (...args) => console.error(...args);
const { startMcpServer } = await import('../src/mcp/server.js');

startMcpServer().catch((err) => {
  console.error('[cross-verifier] Fatal error starting MCP server:', err);
  process.exit(1);
});

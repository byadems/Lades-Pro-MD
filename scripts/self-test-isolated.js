"use strict";

/**
 * scripts/self-test-isolated.js
 * Runs the bot's self-test suite using only mock objects.
 * Useful for verifying command stability when disconnected.
 */

const { runSelfTest } = require("../core/self-test");
const { logger } = require("../config");

// Mock Baileys Socket
const mockSock = {
  user: { id: "test-user@s.whatsapp.net" },
  ev: {
    on: () => {},
    emit: () => {},
    removeAllListeners: () => {}
  },
  sendMessage: async () => ({}),
  groupMetadata: async () => ({ subject: "Test Group", participants: [] }),
  ws: { close: () => {} }
};

async function main() {
  console.log("🚀 [Isolated Self-Test] Starting...");
  try {
    await runSelfTest(mockSock);
    console.log("✅ [Isolated Self-Test] Completed successfully.");
    process.exit(0);
  } catch (err) {
    console.error("❌ [Isolated Self-Test] FAILED:", err);
    process.exit(1);
  }
}

main();

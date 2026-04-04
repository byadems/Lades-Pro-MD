const { loadPlugins, commands } = require("./core/handler");
const { runSelfTest } = require("./core/self-test");
const path = require("path");

const pluginsDir = path.join(__dirname, "plugins");
loadPlugins(pluginsDir);

const sock = {
    user: { id: "test@s.whatsapp.net" },
    ev: { on: () => {} },
    sendMessage: async () => ({}),
};

console.log("Starting standalone self-test...");
runSelfTest(sock).then(() => {
    console.log("Self-test finished!");
    process.exit(0);
}).catch(err => {
    console.error("Self-test error:", err);
    process.exit(1);
});

const { loadPlugins, commands } = require("./core/handler");
const path = require("path");

const pluginsDir = path.join(__dirname, "plugins");
loadPlugins(pluginsDir);

const allCmds = commands();
const seen = new Set();
const queue = [];

for (const cmd of allCmds) {
    const k = String(cmd.pattern)
        .split("?")[0].split(" ")[0]
        .replace(/[^\wçğıöşüÇĞİÖŞÜ]/gi, "")
        .slice(0, 40);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    queue.push(k);
}

console.log("Total unique commands:", queue.length);
console.log("Commands 110-140:");
for (let i = 109; i < Math.min(140, queue.length); i++) {
    console.log(`${i + 1}: ${queue[i]}`);
}

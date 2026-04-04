const fs = require('fs');
const path = require('path');

const commands = [];
function Module(cfg) {
    if (cfg.pattern) commands.push(cfg.pattern);
}

// Mock main.js to provide Module
const mainPath = path.join(__dirname, 'main.js');
const originalMain = fs.readFileSync(mainPath, 'utf8');
// We don't really need to mock main.js if we just provide a global or mock require

global.Module = Module;
global.bot = Module;
global.System = Module;

const pluginsDir = path.join(__dirname, 'plugins');
const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));

for (const file of files) {
    try {
        const content = fs.readFileSync(path.join(pluginsDir, file), 'utf8');
        // Simple extraction via regex since executing might fail due to missing multi-level deps
        const matches = content.matchAll(/(?:Module|bot|System)\s*\(\s*\{[\s\S]*?pattern\s*:\s*["'`]([^"'`]+)["'`]/g);
        for (const m of matches) {
            commands.push(m[1]);
        }
    } catch (e) {}
}

const seen = new Set();
const unique = [];
for (const p of commands) {
    const k = p.split('?')[0].split(' ')[0].replace(/[^\wçğıöşüÇĞİÖŞÜ]/gi, "").slice(0, 40);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    unique.push(k);
}

console.log("Total unique commands:", unique.length);
console.log("Command #123:", unique[122]);
console.log("Range 120-130:");
unique.slice(119, 130).forEach((c, i) => console.log(`${120+i}: ${c}`));

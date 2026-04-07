const fs = require('fs');
const path = require('path');

const pluginsDir = path.join(process.cwd(), 'plugins');
const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));

const results = [];

files.forEach(file => {
    const content = fs.readFileSync(path.join(pluginsDir, file), 'utf8');
    
    // Simple regex to find Module({ ... }) blocks
    // We catch the object inside Module({...})
    const moduleRegex = /Module\s*\(\s*\{([\s\S]*?)\}/g;
    let match;
    
    while ((match = moduleRegex.exec(content)) !== null) {
        const body = match[1];
        
        // Extract pattern
        const patternMatch = body.match(/pattern\s*:\s*['"̈](.*?)['"̈]/);
        // Extract desc
        const descMatch = body.match(/desc\s*:\s*(['"̈].*?['"̈]|Lang\.[\w.]+)/);
        
        if (patternMatch) {
            results.push({
                file: file,
                pattern: patternMatch[1].replace(' ?(.*)', '').replace('(.*)', '').trim(),
                desc: descMatch ? descMatch[1].replace(/['"̈]/g, '').trim() : 'N/A'
            });
        }
    }
});

console.log(JSON.stringify(results, null, 2));

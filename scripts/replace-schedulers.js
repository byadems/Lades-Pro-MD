const fs = require('fs');
const path = require('path');

const walk = (dir, done) => {
  let results = [];
  fs.readdir(dir, (err, list) => {
    if (err) return done(err);
    let pending = list.length;
    if (!pending) return done(null, results);
    list.forEach(file => {
      file = path.resolve(dir, file);
      fs.stat(file, (err, stat) => {
        if (stat && stat.isDirectory()) {
          const base = path.basename(file);
          if (base !== 'node_modules' && base !== '.git' && !file.includes('.gemini')) {
            walk(file, (err, res) => {
              results = results.concat(res);
              if (!--pending) done(null, results);
            });
          } else {
            if (!--pending) done(null, results);
          }
        } else {
          if (file.endsWith('.js') && file !== __filename) {
             results.push(file);
          }
          if (!--pending) done(null, results);
        }
      });
    });
  });
};

walk(path.join(__dirname, '..'), (err, files) => {
  files.forEach(f => {
    let content = fs.readFileSync(f, 'utf-8');
    let mod = false;

    // We must replace requires for memory. 
    // Usually it's require('./scheduler') or require('../core/scheduler')
    
    // Core references
    if (content.includes('require("./scheduler")')) {
      content = content.replace(/require\("\.\/scheduler"\)/g, 'require("./zamanlayici").scheduler');
      mod = true;
    }
    if (content.includes("require('./scheduler')")) {
      content = content.replace(/require\('\.\/scheduler'\)/g, 'require("./zamanlayici").scheduler');
      mod = true;
    }
    if (content.includes('require("../core/scheduler")')) {
      content = content.replace(/require\("\.\.\/core\/scheduler"\)/g, 'require("../core/zamanlayici").scheduler');
      mod = true;
    }
    if (content.includes("require('../core/scheduler')")) {
      content = content.replace(/require\('\.\.\/core\/scheduler'\)/g, 'require("../core/zamanlayici").scheduler');
      mod = true;
    }

    if (content.includes('require("./schedulers")')) {
      content = content.replace(/require\("\.\/schedulers"\)/g, 'require("./zamanlayici")');
      mod = true;
    }
    if (content.includes("require('./schedulers')")) {
      content = content.replace(/require\('\.\/schedulers'\)/g, 'require("./zamanlayici")');
      mod = true;
    }
    
    // Check if any code did const scheduler = require(...);
    // Since we export { scheduler, ... }, if a code did "const scheduler = require('...').scheduler" we are fine because of our replace.
    
    if (mod) fs.writeFileSync(f, content);
  });
  console.log('Scheduler references replaced with zamanlayici.');
});

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
    
    if (content.includes('./helpers')) {
      content = content.replace(/\.\/helpers/g, './yardimcilar');
      mod = true;
    }
    
    if (content.includes('../core/helpers')) {
      content = content.replace(/\.\.\/core\/helpers/g, '../core/yardimcilar');
      mod = true;
    }

    if (content.includes('./lid-helper')) {
      content = content.replace(/\.\/lid-helper/g, './yardimcilar');
      mod = true;
    }

    if (content.includes('../core/lid-helper')) {
      content = content.replace(/\.\.\/core\/lid-helper/g, '../core/yardimcilar');
      mod = true;
    }
    
    if (mod) fs.writeFileSync(f, content);
  });
  console.log('Helpers and lid-helper references replaced with yardimcilar.');
});

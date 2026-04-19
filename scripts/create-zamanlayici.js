const fs = require('fs');

const scheduler = fs.readFileSync('core/scheduler.js', 'utf-8');
const schedulers = fs.readFileSync('core/schedulers.js', 'utf-8');

let newScheduler = scheduler.replace(/module\.exports = scheduler;/g, '');
let newSchedulers = schedulers
  .replace(/"use strict";/g, '')
  .replace(/const \{ logger \} = require\("\.\.\/config"\);/g, '')
  .replace(/const scheduler = require\("\.\/scheduler"\);/g, '')
  .replace(/module\.exports = \{[\s\S]*?\};/g, '');

const combined = newScheduler + '\n' + newSchedulers + '\nmodule.exports = { scheduler, startSchedulers, registerSchedule, addSchedule, removeSchedule, stopAllSchedulers };\n';

fs.writeFileSync('core/zamanlayici.js', combined);
console.log('zamanlayici.js created');

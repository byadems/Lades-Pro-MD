const config = require('../../config');
const LANGUAGE = config.LANGUAGE || 'turkish';
const {existsSync,readFileSync} = require('fs');

const langFile = __dirname + '/lang/' + LANGUAGE + '.json';
const defaultLangFile = __dirname + '/lang/turkish.json';
const json = existsSync(langFile) 
  ? JSON.parse(readFileSync(langFile, 'utf8')) 
  : JSON.parse(readFileSync(defaultLangFile, 'utf8'));

function getString(file) { 
  return json['STRINGS']?.[file] || file; 
}

module.exports = { language: json, getString };
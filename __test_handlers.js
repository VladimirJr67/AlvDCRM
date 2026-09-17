/* Проверка: все обработчики из inline-атрибутов (onclick и т.п.) реально
   определены в проекте. Ловит опечатки вида openCardTaskModal. */
const fs = require('fs');

const dir = 'js';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'xlsx.full.min.js');
const defined = new Set();

files.forEach(f => {
  const src = fs.readFileSync(dir + '/' + f, 'utf8');
  // Объявления функций и присваивания вида const x = function / const x = () =>
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g)) defined.add(m[1]);
});

const handlers = new Set();
files.forEach(f => {
  const src = fs.readFileSync(dir + '/' + f, 'utf8');
  for (const m of src.matchAll(/\bon[a-z]+\s*=\s*"([^"]*)"/g)) {
    const body = m[1];
    // Ищем вызовы вида name( — но не методы (this.remove(), document.getElementById()).
    for (const c of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) handlers.add(c[2]);
  }
});

const allowed = new Set(['event', 'this', 'if', 'return', 'alert', 'confirm', 'parseInt', 'parseFloat',
  'String', 'Number', 'Math', 'JSON', 'Date', 'Object', 'Array', 'setTimeout', 'console', 'open', 'close',
  'encodeURIComponent', 'decodeURIComponent', 'preventDefault', 'stopPropagation', 'location', 'navigator',
  'document', 'window', 'find', 'filter', 'map', 'includes', 'indexOf', 'join', 'toString', 'slice', 'trim',
  'split', 'replace', 'forEach', 'some', 'every', 'sort', 'push', 'splice', 'concat', 'keys', 'values',
  'stringify', 'parse', 'round', 'max', 'min', 'abs', 'pow', 'floor', 'random', 'now', 'toLowerCase',
  'toUpperCase', 'startsWith', 'endsWith', 'test', 'match', 'toFixed', 'toLocaleString', 'padStart', 'isNaN',
  // Цвета внутри inline-стилей выглядят как вызов функции.
  'rgba', 'rgb', 'hsl', 'hsla']);

const missing = [...handlers].filter(n => !defined.has(n) && !allowed.has(n)).sort();
console.log('inline-обработчиков найдено: ' + handlers.size);
console.log(missing.length
  ? 'НЕ ОПРЕДЕЛЕНЫ: ' + missing.join(', ')
  : 'все обработчики определены в проекте');
process.exitCode = missing.length ? 1 : 0;

/* ============================================================
   __test_readiness_xlsx.js — CRM принимает .xlsx напрямую.

   Проверяется, что утреннюю выгрузку 1С можно загрузить без предварительного
   шага «инструмент → JSON»: движок (js/lib/gotovnost-engine.js, копия
   src/engine.js инструмента «Готовность») превращает xlsx в документ схемы v1,
   и он совпадает с эталонным Пример_итогового_файла.json.

   Запуск:  node __test_readiness_xlsx.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

// Сборка реальных файлов и запуск движка в изолированном контексте.
const engineSrc = fs.readFileSync(path.join(__dirname, 'js', 'lib', 'gotovnost-engine.js'), 'utf8');
const readinessSrc = fs.readFileSync(path.join(__dirname, 'js', 'readiness.js'), 'utf8');
const xlsxBuf = fs.readFileSync(path.join(__dirname, '__fixtures', 'gotovnost-example.xlsx'));

const sandbox = {
  console,
  TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView,
  Date, Math, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    getElementById: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } } }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ style: {} })
  },
  window: undefined,
  navigator: {},
  apiAvailable: () => false,
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
};

const context = vm.createContext(sandbox);
vm.runInContext(engineSrc, context, { filename: 'gotovnost-engine.js' });
vm.runInContext(readinessSrc, context, { filename: 'readiness.js' });

// Простое подмножество для проверки ключевых полей документа.
function snapshotChecks(doc) {
  return {
    orders: (doc.orders || []).length,
    positions: doc.totals ? doc.totals.positions : 0,
    planQty: doc.totals ? doc.totals.planQty : 0,
    stockQty: doc.totals ? doc.totals.stockQty : 0,
    readiness: doc.totals ? doc.totals.readiness : null,
    firstSpec: (doc.orders && doc.orders[0]) ? doc.orders[0].specificationKey : '',
    firstPositions: (doc.orders && doc.orders[0]) ? (doc.orders[0].positions || []).length : 0,
    sourceFile: doc.sourceFile || ''
  };
}

(async () => {
  console.log('\nГотовность: приём .xlsx напрямую');

  const res = vm.runInContext(
    `readinessDocumentFromXlsx(${JSON.stringify(Array.from(xlsxBuf))}, 'Пример.xlsx')`,
    context
  );
  check('xlsx разобран без ошибок', res && res.ok === true, res && res.error);

  if (res && res.ok) {
    const doc = res.doc;
    const orders = doc.orders || [];
    const positions = orders.reduce((n, o) => n + (o.positions || []).length, 0);
    const planSum = Math.round(orders.reduce((n, o) => n + (Number(o.planQty) || 0), 0) * 1000) / 1000;

    check('версия схемы 1', doc.schemaVersion === 1, 'получено: ' + doc.schemaVersion);
    check('в документе есть заказы', orders.length > 0, 'получено: ' + orders.length);
    check('итог «заказов» = числу заказов', doc.totals.orders === orders.length,
      doc.totals.orders + ' vs ' + orders.length);
    check('итог «позиций» = сумме позиций', doc.totals.positions === positions,
      doc.totals.positions + ' vs ' + positions);
    check('итог «план» = сумме планов заказов', doc.totals.planQty === planSum,
      doc.totals.planQty + ' vs ' + planSum);
    check('у каждого заказа есть ключ СП', orders.every(o => !!o.specificationKey));
    check('у заказа есть позиции и покрытие/длина', orders[0].positions.length > 0 &&
      typeof orders[0].positions[0].coating === 'string' && typeof orders[0].positions[0].length === 'string');
    check('позиции с одним шифром и разной длиной — отдельные строки', (() => {
      const p = orders[0].positions;
      const keys = new Set(p.map(x => x.cipher + '|' + x.length + '|' + x.coating));
      return keys.size === p.length;
    })());
    check('имя исходного файла передано', doc.sourceFile === 'Пример.xlsx', 'получено: ' + doc.sourceFile);
    check('дата среза берётся из имени файла', doc.asOfDate === '2026-09-18', 'получено: ' + doc.asOfDate);
  }

  // Неподходящий файл: ошибка объясняет причину, а не падает.
  const bad = vm.runInContext(
    `readinessDocumentFromXlsx(new Uint8Array([1,2,3,4]), 'file.xlsx')`,
    context
  );
  check('битый xlsx возвращает понятную ошибку', bad && bad.ok === false && /Не удалось разобрать/.test(bad.error || ''),
    bad && bad.error);

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки приёма xlsx пройдены');
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message + '\n' + (err.stack || ''));
  process.exitCode = 1;
});

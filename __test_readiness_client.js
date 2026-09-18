/* ============================================================
   __test_readiness_client.js — логика готовности на стороне браузера.

   Проверяется по спецификации формата (Схема v1):
     сопоставление по specificationKey заказа;
     крайние случаи: нет данных, нет СП, срез не загружен, устаревший срез,
     readiness = null, planReadyDate = null, workDays = null;
     карточка СП с позициями (одинаковый шифр с разными длинами — разные строки);
     точечная загрузка среза по СП видимых заказов.

   Запуск:  node __test_readiness_client.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

const elements = {};
function el(id) {
  if (!elements[id]) {
    const classes = new Set();
    elements[id] = {
      id, value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        contains: c => classes.has(c),
        toggle: (c, on) => { if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (on) classes.add(c); else classes.delete(c); }
      },
      appendChild() {}, focus() {}, addEventListener() {}, reset() {},
      querySelector() { return null; }, querySelectorAll() { return []; }
    };
  }
  return elements[id];
}

// Адрес запроса на точечную выборку среза.
function isLookupRequest(r) {
  return String(r.url).indexOf('/api/readiness/lookup') === 0;
}

const store = {};
const requests = [];   // что браузер отправил на сервер

// Срез, который «отдаёт» сервер. Меняется по ходу теста.
let serverSnapshot = {
  status: {
    available: true, asOfDate: '2026-09-18', uploadedAt: '2026-09-18T19:59:00.000Z',
    sourceFile: 'Готовность 18.09.26 1.xlsx', count: 2, ageDays: 0, warnings: [],
    totals: { orders: 2, positions: 16, planQty: 8392, stockQty: 6306, shippedQty: 1861, readiness: 97.3 }
  },
  orders: {
    'СП43191': {
      specification: 'СП43191', specificationKey: 'СП43191', client: 'Мегапроф',
      orderDate: '2026-08-13', planReadyDate: '2026-08-30', workDays: 18,
      planQty: 8152, stockQty: 6264, shippedQty: 1861, notReadyQty: 27,
      planWeight: 11690.049, stockWeight: 7673.352, shippedWeight: 4101.45,
      readiness: 99.7, status: 'В работе', statusCode: 'in_progress', overdueDays: 19,
      positionCount: 2, positions: [
        { cipher: 'АВД-7779', name: 'АВД-7779, Алюминиевый профиль', length: '4.22', coating: 'Черный/дробь', planQty: 300, stockQty: 311, shippedQty: 0, readiness: 100, status: 'Готово к отгрузке', statusCode: 'ready' },
        { cipher: 'АВД-7779', name: 'АВД-7779, Алюминиевый профиль', length: '6.05', coating: 'Серебро/дробь', planQty: 300, stockQty: 85, shippedQty: 0, readiness: 28.3, status: 'В работе', statusCode: 'in_progress' }
      ]
    },
    'СП43525': {
      specification: 'СП43525', specificationKey: 'СП43525', client: 'Василёк',
      orderDate: null, planReadyDate: null, workDays: null,
      planQty: 0, stockQty: 0, shippedQty: 0, notReadyQty: 0,
      planWeight: 0, stockWeight: 0, shippedWeight: 0,
      readiness: null, status: 'Без плана', statusCode: 'no_plan', overdueDays: 0,
      positionCount: 0, positions: []
    }
  }
};

const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: () => {}, confirm: () => true, prompt: () => null,
  Intl, Date, Math, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat,
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  URLSearchParams,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    getElementById: el,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => el('__created'),
    body: el('body'),
    documentElement: el('html')
  },
  window: { addEventListener: () => {}, location: { protocol: 'http:' }, isSecureContext: true },
  navigator: { sendBeacon: () => true },
  queueServerSave: () => {},
  apiAvailable: () => true,
  updateUserInfo: () => {},
  goToSection: () => {},
  // Живут в других модулях, для проверки готовности достаточно заглушек.
  escapeHtml: s => String(s == null ? '' : s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
  formatDate: () => '—',
  // Заглушка сервера: только readiness-эндпоинты.
  async fetch(url, options) {
    const body = options && options.body ? JSON.parse(options.body) : null;
    requests.push({ url, body });
    const json = (obj) => ({ ok: true, status: 200, json: async () => obj });

    if (String(url).indexOf('/api/readiness/lookup') === 0) {
      const keys = (body && body.keys) || [];
      const orders = {};
      const missing = [];
      keys.forEach(k => { if (serverSnapshot.orders[k]) orders[k] = serverSnapshot.orders[k]; else missing.push(k); });
      return json({ ok: true, status: serverSnapshot.status, orders, missing });
    }
    if (String(url) === '/api/readiness') {
      return json({ ok: true, status: serverSnapshot.status });
    }
    return json({ ok: false });
  }
};

const context = vm.createContext(sandbox);
const read = f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
['data.js', 'storage.js', 'users.js', 'interactionTypes.js', 'dictionaries.js',
 'orders.js', 'readiness.js'].forEach(f => {
  vm.runInContext(read(f), context, { filename: f });
});

const run = code => vm.runInContext(code, context);
const html = id => el(id).innerHTML;

run(`
  currentSection = 'orders';
  users = [{ id: 1, login: 'Admin', role: 'admin', name: 'Администратор' },
           { id: 2, login: 'manager', role: 'manager', name: 'Иванов Иван' }];
  currentUser = users[1];
  clients = [];
  orders = [
    { id: 1, clientName: 'Мегапроф', createdBy: 2, specification: 'сп 43191', specificationKey: '', kg: 560, condition: 'Сырой', date: '2026-09-18T21:24:00.000Z' },
    { id: 2, clientName: 'Василёк', createdBy: 2, specification: '', kg: 100, condition: 'Анод', date: '2026-09-17T10:00:00.000Z' }
  ];
`);

(async () => {
  console.log('\nГотовность: сопоставление, крайние случаи и карточка СП');

  /* ===== 1. Ключ сопоставления ===== */
  check('пробелы убираются, регистр верхний',
    run('normalizeSpecificationKey("сп 43525")') === 'СП43525');
  check('точки и дефисы сохраняются',
    run('normalizeSpecificationKey("СП2125.1")') === 'СП2125.1' &&
    run('normalizeSpecificationKey(" Б/С-2 ")') === 'Б/С-2');
  check('ключ заказа считается и из specification',
    run('orderSpecificationKey(orders[0])') === 'СП43191');

  /* ===== 2. Загрузка среза по СП видимых заказов ===== */
  requests.length = 0;
  await run('refreshReadinessForVisibleOrders()');
  const lookup = requests.find(isLookupRequest);
  check('браузер запрашивает только нужные СП', !!lookup &&
    JSON.stringify(lookup.body.keys.slice().sort()) === JSON.stringify(['СП43191']),
    lookup ? JSON.stringify(lookup.body.keys) : 'запроса нет');
  check('запись среза нашлась по заказу', !!run('readinessForOrder(orders[0])'));
  check('у заказа без СП данных нет', run('readinessForOrder(orders[1])') === null);

  const before = requests.length;
  await run('refreshReadinessForVisibleOrders()');
  check('повторный запрос с теми же СП не отправляется', requests.length === before);

  /* ===== 3. Колонка готовности ===== */
  run('currentSection = "orders"');
  const cell = run('orderReadinessCellHtml(orders[0])');
  check('в колонке видно процент готовности', /99,7 %/.test(cell), cell.replace(/\s+/g, ' ').slice(0, 90));
  check('в колонке виден статус', /В работе/.test(cell));
  check('в колонке видна дата среза', /данные на 18\.09\.2026/.test(cell));
  check('в колонке есть полоска готовности', /readiness-bar/.test(cell));
  check('клик открывает карточку СП', /openReadinessCard\(1\)/.test(cell));

  /* ===== 4. Крайние случаи ===== */
  const noSpec = run('orderReadinessCellHtml(orders[1])');
  check('заказ без СП помечен «нет СП»', /нет СП/.test(noSpec));

  run(`orders[1].specification = 'СП99999'; orders[1].specificationKey = 'СП99999'`);
  const noData = run('orderReadinessCellHtml(orders[1])');
  check('СП без записи в срезе → «Нет данных готовности»', /Нет данных готовности/.test(noData));

  // «Без плана»: запись есть, но плана нет — проценты показываем прочерком.
  run(`readinessByKey['СП43525'] = ${JSON.stringify(serverSnapshot.orders['СП43525'])}`);
  const noPlanCell = run('orderReadinessCellHtml({ id: 3, specification: "СП43525" })');
  check('readiness = null показывается как «—», а не 0 %', /—/.test(noPlanCell) && !/0 %/.test(noPlanCell),
    noPlanCell.replace(/\s+/g, ' ').slice(0, 100));

  // Срез не загружен
  const savedSnapshot = serverSnapshot;
  serverSnapshot = { status: { available: false, count: 0 }, orders: {} };
  run('readinessStatus = null; readinessByKey = {}; readinessLookupKey = ""');
  const notLoaded = run('orderReadinessCellHtml(orders[0])');
  check('без среза → «Нет данных готовности»', /Нет данных готовности/.test(notLoaded));
  check('подпись объясняет, что среза нет', /срез готовности не загружен/.test(run('readinessAsOfText()')));

  // Устаревший срез
  serverSnapshot = savedSnapshot;
  run('readinessStatus = { available: true, asOfDate: "2026-09-15", count: 2, ageDays: 3 }; readinessByKey = { "СП43191": { readiness: 99.7, status: "В работе", statusCode: "in_progress" } }');
  const staleCell = run('orderReadinessCellHtml(orders[0])');
  check('устаревший срез помечен в колонке', /устарело/.test(staleCell));
  check('подпись говорит, сколько дней нет обновлений',
    /не обновлялись 3 дн\./.test(run('readinessAsOfText()')), run('readinessAsOfText()'));
  check('срез считается устаревшим', run('readinessStale()') === true);

  /* ===== 5. Карточка СП ===== */
  run('readinessStatus = { available: true, asOfDate: "2026-09-18", count: 2, ageDays: 0 }; readinessByKey = { "СП43191": ' + JSON.stringify(savedSnapshot.orders['СП43191']) + ' }');
  requests.length = 0;
  run('openReadinessCard(1)');
  const card = html('readinessCardBody');
  check('карточка открылась на нужном СП', el('readinessModal').classList.contains('active') === true);
  check('в карточке есть шапка СП и клиент', /СП43191/.test(card) && /Мегапроф/.test(card));
  check('в карточке есть плановая дата, дни на работу и дата заказа',
    /30\.08\.2026/.test(card) && /Кол-во дней на работу/.test(card) && /13\.08\.2026/.test(card));
  check('в карточке есть итоги по СП', /План, кол-во/.test(card) && /На складе/.test(card) && /Отгружено/.test(card));
  check('в карточке есть позиции', /АВД-7779/.test(card));
  check('одинаковый шифр с разными длинами — разные строки',
    (card.match(/АВД-7779/g) || []).length >= 2 && /4\.22/.test(card) && /6\.05/.test(card));
  check('итоговая строка по СП на месте', /Итого по СП, позиций: 2/.test(card));

  // «Без плана»: null-значения показываются прочерками
  requests.length = 0;
  run(`readinessByKey['СП43525'] = ${JSON.stringify(savedSnapshot.orders['СП43525'])}`);
  run('openReadinessCard(1)');
  run(`orders.push({ id: 3, clientName: 'Василёк', createdBy: 2, specification: 'СП43525' })`);
  run('openReadinessCard(3)');
  const noPlanCard = html('readinessCardBody');
  check('нет плановой даты → «—», а не сегодня',
    /Плановая дата готовности: <strong>—<\/strong>/.test(noPlanCard));
  check('нет дней на работу → «—»', /Кол-во дней на работу: <strong>—<\/strong>/.test(noPlanCard));
  check('нет плана → готовность «—»', /Готовность<\/span><strong>—<\/strong>/.test(noPlanCard));
  check('статус «Без плана» показан', /Без плана/.test(noPlanCard));

  // Карточка без данных
  run('orders.push({ id: 4, clientName: "Ромашка", createdBy: 2, specification: "СП77777" })');
  run('openReadinessCard(4)');
  check('карточка без записи объясняет причину',
    /Нет данных готовности по СП СП77777/.test(html('readinessCardBody')));

  /* ===== 6. Колонка СП ===== */
  check('пустой СП можно указать', /указать СП/.test(run('orderSpecificationCellHtml({ id: 5 }, true)')));
  check('без прав правки нет', !/указать СП/.test(run('orderSpecificationCellHtml({ id: 5 }, false)')));
  check('номер СП показан и его можно изменить',
    /СП43191|сп 43191/.test(run('orderSpecificationCellHtml(orders[0], true)')) &&
    /editOrderSpecification\(1\)/.test(run('orderSpecificationCellHtml(orders[0], true)')));

  /* ===== 7. Обновление среза сервером (SSE) ===== */
  requests.length = 0;
  run('onReadinessUpdated()');
  await new Promise(r => setTimeout(r, 20));
  check('после сигнала сервера срез перезапрашивается',
    requests.some(isLookupRequest), 'запросов: ' + requests.length);

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки готовности (клиент) пройдены');
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message + '\n' + (err.stack || ''));
  process.exitCode = 1;
});

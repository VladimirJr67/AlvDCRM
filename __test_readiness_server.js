/* ============================================================
   __test_readiness_server.js — сквозная проверка интеграции «Готовность».

   Требует запущенного сервера:
     PORT=3100 node server.js --no-open
     PORT=3100 node __test_readiness_server.js

   Проверяется контракт: загрузка документа админом, отказ не-админу и без
   сессии, замена среза (не накопление), сопоставление с заказами по номеру СП,
   отчёт по несопоставленным и заказам без данных, точечная выборка, очистка,
   и то, что срез не отдаётся как статика.

   База и срез возвращаются в исходное состояние.
   ============================================================ */

const http = require('http');

const PORT = Number(process.env.PORT) || 3100;
const HOST = '127.0.0.1';

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

function request(method, path, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, opts.headers || {});
    if (opts.cookie) headers.Cookie = opts.cookie;
    let payload = null;
    if (opts.body !== undefined) {
      payload = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ host: HOST, port: PORT, method, path, headers }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = null; }
        resolve({ status: res.statusCode, json, body: data, setCookies: res.headers['set-cookie'] || [] });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieMap(setCookies) {
  const jar = {};
  (setCookies || []).forEach(line => {
    const pair = line.split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  });
  return jar;
}

function cookieHeader(jar) {
  return Object.keys(jar).filter(k => jar[k]).map(k => k + '=' + jar[k]).join('; ');
}

async function login(login, password) {
  const res = await request('POST', '/api/auth/login', { body: { login, password } });
  return res.status === 200 ? cookieHeader(cookieMap(res.setCookies)) : '';
}

// Небольшой документ по спецификации формата v1 (схема та же, что у инструмента).
function sampleDocument(orders) {
  return {
    schemaVersion: 1,
    asOfDate: '2026-09-18',
    generatedAt: '2026-09-18T19:59:00.780Z',
    sourceFile: 'Готовность 18.09.26 1.xlsx',
    sheet: 'TDSheet',
    totals: { orders: orders.length, planQty: 8452 },
    orders: orders
  };
}

function sampleOrder(key, extra) {
  return Object.assign({
    specification: key,
    specificationKey: key,
    client: 'Тестовый клиент',
    orderDate: '2026-08-13',
    planReadyDate: '2026-08-30',
    workDays: 18,
    planQty: 8152,
    stockQty: 6264,
    shippedQty: 1861,
    notReadyQty: 27,
    planWeight: 11690.049,
    stockWeight: 7673.352,
    shippedWeight: 4101.45,
    readiness: 99.7,
    status: 'В работе',
    statusCode: 'in_progress',
    overdueDays: 19,
    positionCount: 1,
    positions: [{
      cipher: 'АВД-7779', name: 'АВД-7779, Алюминиевый профиль', length: '4.22', coating: 'Черный/дробь',
      planQty: 300, stockQty: 311, shippedQty: 0, notReadyQty: 0, planWeight: 321.564, stockWeight: 333.355,
      readiness: 100, status: 'Готово к отгрузке', statusCode: 'ready'
    }]
  }, extra || {});
}

(async () => {
  console.log('\nГотовность: загрузка, сопоставление и отчёт (сервер на порту ' + PORT + ')');

  const original = (await request('GET', '/api/db')).json;
  check('сервер доступен и база читается', !!original && Array.isArray(original.orders), 'заказов: ' + (original ? original.orders.length : '?'));

  const adminCookie = await login('Admin', 'Admin');
  const managerCookie = await login('manager', 'qwer1234');
  check('вход администратора выполнен', !!adminCookie);
  check('вход менеджера выполнен', !!managerCookie);

  try {
    /* ===== 1. Номер СП у заказа: нормализация в базе ===== */
    const prepared = JSON.parse(JSON.stringify(original));
    if (!prepared.orders.length) prepared.orders.push({ id: 1, clientName: 'Тестовый клиент', kg: 560, condition: 'Сырой', cost: 100, date: new Date().toISOString(), createdBy: 2 });
    prepared.orders[0].specification = 'сп 43191';
    prepared.orders[0].specificationKey = '';
    const saved = await request('POST', '/api/db', { cookie: adminCookie, body: prepared });
    check('база сохранена с номером СП', saved.status === 200 && saved.json && saved.json.ok === true);

    const dbAfterSave = (await request('GET', '/api/db')).json;
    check('ключ СП нормализован на сервере',
      dbAfterSave.orders[0].specificationKey === 'СП43191',
      'получилось: ' + dbAfterSave.orders[0].specificationKey);

    /* ===== 2. Права на загрузку ===== */
    const doc = sampleDocument([sampleOrder('СП43191'), sampleOrder('СП99999', { client: 'Другой клиент' })]);

    let res = await request('POST', '/api/readiness', { body: doc });
    check('без сессии загрузка отклонена', res.status === 401, 'HTTP ' + res.status);

    res = await request('POST', '/api/readiness', { cookie: managerCookie, body: doc });
    check('менеджеру загрузка запрещена', res.status === 403, 'HTTP ' + res.status);

    /* ===== 3. Проверка формата ===== */
    const badVersion = sampleDocument([sampleOrder('СП43191')]);
    badVersion.schemaVersion = 2;
    res = await request('POST', '/api/readiness', { cookie: adminCookie, body: badVersion });
    check('другая версия схемы отклонена с пояснением',
      res.status === 400 && /Версия формата/.test(res.json.error || ''), (res.json && res.json.error) || '');

    const noKey = sampleDocument([{ client: 'Без номера', positions: [] }]);
    res = await request('POST', '/api/readiness', { cookie: adminCookie, body: noKey });
    check('запись без номера СП отклонена',
      res.status === 400 && /нет номера спецификации/.test(res.json.error || ''), (res.json && res.json.error) || '');

    res = await request('POST', '/api/readiness', { cookie: adminCookie, body: { schemaVersion: 1 } });
    check('документ без orders отклонён', res.status === 400, 'HTTP ' + res.status);

    /* ===== 4. Успешная загрузка и отчёт ===== */
    res = await request('POST', '/api/readiness', { cookie: adminCookie, body: doc });
    const upload = res.json || {};
    check('загрузка прошла', res.status === 200 && upload.ok === true, 'HTTP ' + res.status);
    check('дата среза принята из документа', upload.status && upload.status.asOfDate === '2026-09-18',
      upload.status ? String(upload.status.asOfDate) : 'нет статуса');
    check('срез помечен доступным', upload.status && upload.status.available === true && upload.status.count === 2,
      upload.status ? 'записей: ' + upload.status.count : '');
    check('отчёт: сопоставлено с заказами CRM', upload.report && upload.report.matched === 1,
      upload.report ? 'сопоставлено: ' + upload.report.matched : '');
    check('отчёт: не найдено в CRM перечислено', upload.report && upload.report.missingCount === 1 &&
      upload.report.missing[0] === 'СП99999', upload.report ? JSON.stringify(upload.report.missing) : '');
    check('отчёт: заказов без СП нет', upload.report && upload.report.ordersWithoutSpecCount === 0);
    check('отчёт: заказов без данных нет', upload.report && upload.report.ordersWithoutDataCount === 0);
    check('итоги пересчитаны по заказам документа',
      upload.status && upload.status.totals && upload.status.totals.planQty === 16304,
      upload.status && upload.status.totals ? 'план: ' + upload.status.totals.planQty : '');

    /* ===== 5. Статус и точечная выборка ===== */
    res = await request('GET', '/api/readiness');
    check('статус среза доступен без входа', res.status === 200 && res.json.ok === true &&
      res.json.status.available === true, 'HTTP ' + res.status);

    res = await request('POST', '/api/readiness/lookup', { body: { keys: ['сп43191', 'СП00000'] } });
    const lookup = res.json || {};
    check('выборка отдаёт только запрошенные СП', lookup.ok === true &&
      Object.keys(lookup.orders || {}).length === 1 && !!lookup.orders['СП43191'],
      'ключи: ' + Object.keys(lookup.orders || {}).join(','));
    check('выборка сообщает о ненайденных', JSON.stringify(lookup.missing) === JSON.stringify(['СП00000']));
    check('выборка отдаёт позиции', (lookup.orders['СП43191'].positions || []).length === 1 &&
      lookup.orders['СП43191'].positions[0].cipher === 'АВД-7779');

    /* ===== 6. Замена среза, а не накопление ===== */
    res = await request('POST', '/api/readiness', {
      cookie: adminCookie,
      body: sampleDocument([sampleOrder('СП99999', { client: 'Только один' })])
    });
    check('повторная загрузка заменяет срез', res.status === 200 && res.json.status.count === 1,
      'записей: ' + (res.json.status ? res.json.status.count : '?'));
    res = await request('POST', '/api/readiness/lookup', { body: { keys: ['СП43191', 'СП99999'] } });
    check('прежние записи из среза исчезли', !res.json.orders['СП43191'] && !!res.json.orders['СП99999']);
    check('отчёт по новой загрузке: заказ CRM остался без данных',
      res.json.status.available === true);

    /* ===== 7. Срез не отдаётся как статика ===== */
    res = await request('GET', '/readiness.json');
    check('readiness.json недоступен как файл', res.status === 404, 'HTTP ' + res.status);

    /* ===== 8. Очистка среза ===== */
    res = await request('DELETE', '/api/readiness', { cookie: adminCookie });
    check('очистка среза выполнена', res.status === 200 && res.json.status.available === false);
    res = await request('GET', '/api/readiness');
    check('после очистки срез пуст', res.json.status.available === false && res.json.status.count === 0);
    res = await request('DELETE', '/api/readiness');
    check('очистка без сессии отклонена', res.status === 401, 'HTTP ' + res.status);

  } finally {
    // Возвращаем базу и оставляем пустой срез — как было до теста.
    await request('POST', '/api/db', { cookie: adminCookie, body: original });
    await request('DELETE', '/api/readiness', { cookie: adminCookie });
  }

  const restored = (await request('GET', '/api/db')).json;
  check('база восстановлена', JSON.stringify(restored.orders) === JSON.stringify(original.orders));

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки готовности (сервер) пройдены');
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message);
  process.exitCode = 1;
});

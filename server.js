/* ============================================================
   «Алвид CRM» — локальный сервер с файловой базой данных.
   Без внешних зависимостей: раздаёт статику проекта и хранит
   все данные в файле db.json на диске.

   Запуск:  node server.js        (или npm start)
   Флаги:   --no-open  — не открывать браузер автоматически
            PORT=3100 node server.js  — другой порт
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = path.join(ROOT, 'db.json');
const TMP_DB_PATH = path.join(ROOT, 'db.json.tmp');

// ===== Локальная конфигурация интеграций =====
// В этом файле хранятся API-ключи внешних сервисов. Он внесён в .gitignore
// и никогда не отдаётся как статика. Переменные окружения имеют приоритет
// над файлом, поэтому ключ можно задать и без записи на диск.
const CONFIG_PATH = path.join(ROOT, 'config.local.json');
const CONFIG_TMP_PATH = path.join(ROOT, 'config.local.json.tmp');

// Файлы, которые сервер не отдаёт клиенту ни при каких условиях.
const NEVER_SERVE = new Set(['config.local.json', 'config.local.json.tmp', 'db.json.tmp']);

const DADATA_URL = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs';

// Чтение JSON-файла с устойчивостью к BOM: «Блокнот» и PowerShell при
// сохранении в UTF-8 добавляют невидимый префикс, на котором JSON.parse
// падает с ошибкой — из-за этого конфиг молча выглядел пустым.
function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function loadConfig() {
  try {
    return readJsonFile(CONFIG_PATH);
  } catch (err) {
    return {};
  }
}

// Атомарная запись конфигурации — как и у БД: временный файл + переименование.
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_TMP_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(CONFIG_TMP_PATH, CONFIG_PATH);
}

// Ключ DaData: сначала переменные окружения, затем config.local.json.
function dadataToken() {
  const fromEnv = process.env.DADATA_API_KEY || process.env.DADATA_TOKEN || '';
  if (fromEnv.trim()) return fromEnv.trim();
  const cfg = loadConfig();
  return ((cfg.dadata && cfg.dadata.token) || '').trim();
}

function dadataConfigured() {
  return !!dadataToken();
}

// Запросы, меняющие конфигурацию, принимаем только с этой машины (loopback):
// полноценной авторизации у приложения нет, поэтому ключ нельзя разрешать
// записывать любому, кто дотянется до порта по сети.
function isLoopback(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req, cb) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1024 * 1024) req.destroy(); // лимит 1 МБ
  });
  req.on('end', () => {
    try {
      cb(null, JSON.parse(body || '{}'));
    } catch (err) {
      cb(err);
    }
  });
}

// Вызов Suggestions API Дадаты. Ключ подставляется здесь, на сервере,
// поэтому в браузер он не попадает.
async function dadataCall(endpoint, payload) {
  const token = dadataToken();
  if (!token) {
    const err = new Error('Ключ DaData не задан');
    err.code = 'NO_TOKEN';
    throw err;
  }
  const res = await fetch(DADATA_URL + endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Token ' + token
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error('DaData HTTP ' + res.status + (text ? ': ' + text.slice(0, 200) : ''));
    err.code = res.status === 401 || res.status === 403 ? 'BAD_TOKEN' : 'UPSTREAM';
    throw err;
  }
  return res.json();
}

// Реквизиты организации по ИНН (или ОГРН) — приведены к плоскому виду.
async function dadataParty(query) {
  const json = await dadataCall('/findById/party', { query: query, count: 1 });
  const s = (json && Array.isArray(json.suggestions) && json.suggestions[0]) || null;
  if (!s) return null;
  const d = s.data || {};
  const addr = d.address || {};
  const addrData = addr.data || {};
  return {
    name: (d.name && (d.name.short_with_opf || d.name.short)) || s.value || '',
    fullName: (d.name && d.name.full_with_opf) || s.unrestricted_value || '',
    inn: d.inn || '',
    ogrn: d.ogrn || '',
    address: addr.value || addr.unrestricted_value || '',
    city: addrData.city || '',
    country: addrData.country_iso_code || '',
    status: (d.state && d.state.status) || '',
    management: (d.management && d.management.name) || '',
    phones: Array.isArray(d.phones) ? d.phones.slice(0, 3) : [],
    emails: Array.isArray(d.emails) ? d.emails.slice(0, 3) : []
  };
}

// Подсказки городов, ограниченные страной.
async function dadataCities(query, countryCode) {
  const payload = {
    query: query,
    count: 10,
    from_bound: { value: 'city' },
    to_bound: { value: 'city' }
  };
  if (countryCode) payload.locations = [{ country_iso_code: countryCode }];
  const json = await dadataCall('/suggest/address', payload);
  const list = (json && json.suggestions) || [];
  return list.map(s => (s.data && s.data.city) || s.value).filter(Boolean);
}

// Дефолтная структура БД — создаётся при первом старте.
const DEFAULT_DB = {
  version: 5,
  users: [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор' },
    { id: 2, login: 'manager', password: 'manager', role: 'user', name: 'Менеджер' }
  ],
  clients: [],
  contacts: [],
  tasks: [],
  taskColumns: [],
  reminders: [],
  notifications: [],
  interactionTypes: [],
  orders: [],
  // Общие справочники: типы организаций и должности контактных лиц.
  // Заполняются менеджерами и доступны всем остальным.
  orgTypes: [],
  contactPositions: [],
  // Лента новостей и объявлений для команды.
  news: []
};

// Типы взаимодействий по умолчанию — сидируются только при первом старте
// (когда в db.json ещё нет коллекции interactionTypes).
const DEFAULT_INTERACTION_TYPES = ['Звонок', 'Информация', 'Встреча', 'Письмо', 'Размещение заказа'];

// Легаси-набор без «Размещения заказа» — при миграции дополняется новым типом.
const LEGACY_INTERACTION_TYPES = ['Звонок', 'Информация', 'Встреча', 'Письмо'];

function normalizeDb(db) {
  const d = Object.assign({}, DEFAULT_DB, db || {});
  d.users = d.users || [];
  d.clients = d.clients || [];
  d.contacts = d.contacts || [];
  d.tasks = d.tasks || [];
  d.taskColumns = d.taskColumns || [];
  d.reminders = d.reminders || [];
  d.notifications = d.notifications || [];
  d.orders = d.orders || [];
  d.orgTypes = Array.isArray(d.orgTypes) ? d.orgTypes : [];
  d.contactPositions = Array.isArray(d.contactPositions) ? d.contactPositions : [];
  d.news = Array.isArray(d.news) ? d.news : [];
  d.interactionTypes = Array.isArray(d.interactionTypes) ? d.interactionTypes : [];
  // Легаси/fresh-базы без коллекции — наполняем дефолтами.
  if (!(db && Array.isArray(db.interactionTypes)) && !d.interactionTypes.length) {
    d.interactionTypes = DEFAULT_INTERACTION_TYPES.slice();
  } else if (d.interactionTypes.length === LEGACY_INTERACTION_TYPES.length &&
             LEGACY_INTERACTION_TYPES.every((t, i) => d.interactionTypes[i] === t)) {
    // Одноразовая миграция: старый «чистый» справочник дополняется «Размещением заказа».
    // Если администратор уже правил справочник — его изменения не трогаем.
    d.interactionTypes = DEFAULT_INTERACTION_TYPES.slice();
  }
  return d;
}

function loadDb() {
  try {
    return normalizeDb(readJsonFile(DB_PATH));
  } catch (err) {
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

// Атомарная запись: сначала во временный файл, затем переименование.
function saveDb(db) {
  fs.writeFileSync(TMP_DB_PATH, JSON.stringify(normalizeDb(db), null, 2), 'utf8');
  fs.renameSync(TMP_DB_PATH, DB_PATH);
}

// ===== Серверные события (SSE): мгновенная синхронизация клиентов =====
// При каждом сохранении БД всем подключённым браузерам отправляется сигнал,
// по которому они обновляют данные без ручной перезагрузки страницы.
const sseClients = new Set();

function broadcastSse() {
  const payload = 'data: changed\n\n';
  sseClients.forEach(res => {
    try { res.write(payload); } catch (e) { sseClients.delete(res); }
  });
}

// Дёшево вычисляемый «отпечаток» БД для опроса: изменения на диске сказываются
// и на mtime, и на размере файла, поэтому пара (mtime, size) надёжно ловит
// обновления без передачи всего содержимого db.json.
function dbFingerprint() {
  try {
    const st = fs.statSync(DB_PATH);
    return `${st.mtimeMs}:${st.size}`;
  } catch (e) {
    return '0:0';
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };

    // Файлы приложения меняются часто. Без запрета кэширования браузер может
    // показывать старую версию скриптов после обновления проекта — тогда
    // исправления «не применяются» до ручного обновления с Ctrl+F5.
    if (/\.(html?|js|css|json)$/i.test(filePath)) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }

    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (err) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const pathname = url.pathname;

  // ---- API базы данных ----
  if (pathname === '/api/db') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(loadDb()));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 100 * 1024 * 1024) req.destroy(); // лимит 100 МБ
      });
      req.on('end', () => {
        try {
          const db = JSON.parse(body);
          saveDb(db);
          broadcastSse(); // мгновенно уведомить остальные окна/пользователей
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    return;
  }

  // Дёшево вычисляемый «отпечаток» БД — для поллинга без скачивания всего файла.
  if (pathname === '/api/db/hash') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ hash: dbFingerprint() }));
    return;
  }

  // ---- Интеграции: статус и настройка ключа ----
  if (pathname === '/api/integrations/status') {
    const cfg = loadConfig();
    const envToken = !!(process.env.DADATA_API_KEY || process.env.DADATA_TOKEN || '').trim();
    sendJson(res, 200, {
      ok: true,
      dadata: {
        configured: dadataConfigured(),
        source: envToken ? 'env' : ((cfg.dadata && cfg.dadata.token) ? 'config' : null)
      }
    });
    return;
  }

  if (pathname === '/api/integrations/dadata') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    if (!isLoopback(req)) {
      sendJson(res, 403, {
        ok: false,
        error: 'Ключ можно задать только с компьютера, на котором запущен сервер (localhost)'
      });
      return;
    }
    readJsonBody(req, (err, body) => {
      if (err) {
        sendJson(res, 400, { ok: false, error: 'Некорректный JSON' });
        return;
      }
      const token = String(body.token || '').trim();
      const cfg = loadConfig();
      if (token) cfg.dadata = { token: token };
      else delete cfg.dadata;
      try {
        saveConfig(cfg);
        sendJson(res, 200, { ok: true, configured: dadataConfigured() });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: 'Не удалось сохранить конфигурацию: ' + e.message });
      }
    });
    return;
  }

  // ---- Подсказки: реквизиты по ИНН/ОГРН и города ----
  if (pathname === '/api/suggest/party') {
    const inn = (url.searchParams.get('inn') || '').replace(/\D/g, '');
    if (!/^(\d{10}|\d{12}|\d{13}|\d{15})$/.test(inn)) {
      sendJson(res, 400, { ok: false, error: 'Укажите ИНН (10 цифр) или ОГРН (13 или 15 цифр)' });
      return;
    }
    dadataParty(inn)
      .then(party => sendJson(res, 200, { ok: true, party: party }))
      .catch(err => sendJson(res, err.code === 'NO_TOKEN' ? 503 : 502, {
        ok: false, error: err.message, code: err.code || 'UPSTREAM'
      }));
    return;
  }

  if (pathname === '/api/suggest/city') {
    const q = (url.searchParams.get('q') || '').trim();
    const country = (url.searchParams.get('country') || '').trim().toUpperCase();
    if (q.length < 2) {
      sendJson(res, 200, { ok: true, cities: [] });
      return;
    }
    dadataCities(q, country)
      .then(cities => sendJson(res, 200, { ok: true, cities: cities }))
      .catch(err => sendJson(res, err.code === 'NO_TOKEN' ? 503 : 502, {
        ok: false, error: err.message, code: err.code || 'UPSTREAM'
      }));
    return;
  }

  // Server-Sent Events: канал мгновенных уведомлений об изменении БД.
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    // Периодический heartbeat — чтобы прокси/браузер не разрывали соединение.
    const hb = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (e) { clearInterval(hb); }
    }, 25000);
    req.on('close', () => clearInterval(hb));
    return;
  }

  // ---- Статика ----
  let filePath = pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, pathname);

  // Конфигурацию с API-ключами и служебные файлы БД как статику не отдаём.
  if (NEVER_SERVE.has(path.basename(filePath))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  // Защита от выхода за пределы каталога проекта
  const prefix = ROOT + path.sep;
  if (filePath !== ROOT && !filePath.startsWith(prefix)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      const indexFile = path.join(filePath, 'index.html');
      fs.stat(indexFile, (err2) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        serveFile(indexFile, res);
      });
      return;
    }
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    serveFile(filePath, res);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Алвид CRM');
  console.log(`  Откройте: http://localhost:${PORT}`);
  console.log('  Файл БД: ' + DB_PATH);
  console.log('');

  if (!process.argv.includes('--no-open')) {
    try {
      const cmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      require('child_process').exec(cmd + ' http://localhost:' + PORT);
    } catch (e) { /* браузер не открылся — не критично */ }
  }
});

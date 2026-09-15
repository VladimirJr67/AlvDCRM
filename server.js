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
  orders: []
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
    return normalizeDb(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
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
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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

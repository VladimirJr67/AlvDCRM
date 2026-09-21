/* ============================================================
   __test_login_background.js — фон страницы входа (server side).

   Требует запущенного сервера:
     PORT=3100 node server.js --no-open
     PORT=3100 node __test_login_background.js

   Проверяет: инъекцию window.__LOGIN_BACKGROUND__ в index.html;
   эндпоинты разработчика /api/login-background (GET/POST/upload/remove)
   доступны только developer; загрузка/выбор/удаление файла работают.
   Конфиг config.local.json и assets/login/ восстанавливаются после теста.
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3100;
const HOST = '127.0.0.1';
const CONFIG = path.join(__dirname, 'config.local.json');
const ASSETS = path.join(__dirname, 'assets', 'login');

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

function request(method, pathname, options) {
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
    const req = http.request({ host: HOST, port: PORT, method, path: pathname, headers }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = null; }
        resolve({ status: res.statusCode, json, setCookies: res.headers['set-cookie'] || [], body: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieJar(setCookies) {
  const jar = {};
  setCookies.forEach(line => {
    const pair = line.split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  });
  return jar;
}
function cookieHeader(jar) { return Object.keys(jar).filter(k => jar[k]).map(k => k + '=' + jar[k]).join('; '); }

async function login(login, password) {
  const r = await request('POST', '/api/auth/login', { body: { login, password } });
  return r.status === 200 && r.json && r.json.ok ? cookieHeader(cookieJar(r.setCookies)) : null;
}

// 1×1 прозрачный PNG.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  console.log('\nФон страницы входа');

  let originalConfig = null;
  try { originalConfig = fs.readFileSync(CONFIG, 'utf8'); } catch (e) { originalConfig = null; }
  const uploadedFile = path.join(ASSETS, '__test_upload.png');
  try { fs.unlinkSync(uploadedFile); } catch (e) {}

  try {
    // 1. Инъекция: пустой конфиг → null.
    let cfg = {};
    try { cfg = JSON.parse(originalConfig || '{}'); } catch (e) { cfg = {}; }
    delete cfg.loginBackground;
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), 'utf8');

    let r = await request('GET', '/');
    check('index.html отдаётся', r.status === 200 && /loginScreen/.test(r.body));
    check('пустой конфиг → __LOGIN_BACKGROUND__=null', /window\.__LOGIN_BACKGROUND__=null/.test(r.body));

    // 2. Инъекция заданного пути.
    cfg.loginBackground = '/assets/login/photo.jpg';
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), 'utf8');
    r = await request('GET', '/');
    check('заданный путь → инъекция пути', /window\.__LOGIN_BACKGROUND__="\/assets\/login\/photo\.jpg"/.test(r.body));

    // 3. Эндпоинты разработчика.
    const dev = await login('developer', 'developer');
    const admin = await login('Admin', 'Admin');
    check('вход разработчиком', !!dev);
    check('вход администратором', !!admin);

    const getAdmin = await request('GET', '/api/login-background', { cookie: admin });
    check('администратору раздел закрыт', getAdmin.status === 403, 'HTTP ' + getAdmin.status);

    const getDev = await request('GET', '/api/login-background', { cookie: dev });
    check('разработчик читает статус фона', getDev.status === 200 && getDev.json && getDev.json.ok);

    // Загрузка файла.
    const up = await request('POST', '/api/login-background/upload', {
      cookie: dev,
      body: { filename: '__test_upload.png', data: 'data:image/png;base64,' + TINY_PNG }
    });
    check('загрузка файла работает', up.status === 200 && up.json && up.json.ok && /__test_upload\.png/.test(up.json.url || ''),
      (up.json && up.json.url) || '');
    check('файл появился в списке', fs.existsSync(uploadedFile));

    // Выбор фона из загруженного файла.
    const set = await request('POST', '/api/login-background', { cookie: dev, body: { loginBackground: '/assets/login/__test_upload.png' } });
    check('выбор фона сохраняется', set.status === 200 && set.json && set.json.loginBackground === '/assets/login/__test_upload.png');

    const status = await request('GET', '/api/login-background', { cookie: dev });
    check('список файлов содержит загруженный',
      status.json && Array.isArray(status.json.files) && status.json.files.indexOf('__test_upload.png') > -1);

    // Удаление файла (и сброс фона, т.к. он был текущим).
    const rm = await request('POST', '/api/login-background/remove', { cookie: dev, body: { filename: '__test_upload.png' } });
    check('удаление файла работает', rm.status === 200 && rm.json && rm.json.ok);
    check('файл удалён с диска', !fs.existsSync(uploadedFile));
    check('текущий фон сброшен', rm.json && !rm.json.loginBackground);

    const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    check('MIME: webp/mp4/webm объявлены',
      /'\.webp':\s*'image\/webp'/.test(serverSrc) && /'\.mp4':\s*'video\/mp4'/.test(serverSrc) && /'\.webm':\s*'video\/webm'/.test(serverSrc));
  } finally {
    if (originalConfig === null) { try { fs.unlinkSync(CONFIG); } catch (e) {} }
    else { fs.writeFileSync(CONFIG, originalConfig, 'utf8'); }
    try { fs.unlinkSync(uploadedFile); } catch (e) {}
  }

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки фона входа пройдены');
  process.exit(failures ? 1 : 0);
})().catch(err => {
  console.error('Ошибка теста: ' + err.message);
  process.exit(1);
});

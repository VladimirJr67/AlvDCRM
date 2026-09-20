/* ============================================================
   __test_permissions.js — проверка матрицы прав и роли developer.

   Требует запущенного сервера:
     PORT=3100 node server.js --no-open
     PORT=3100 node __test_permissions.js

   Проверяется: разработчик видит и меняет матрицу, другие роли — нет;
   /api/db не даёт не-разработчику менять rolePermissions; миграция
   засеяла каталог прав и роль developer.
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
function cookieHeader(jar) {
  return Object.keys(jar).filter(k => jar[k]).map(k => k + '=' + jar[k]).join('; ');
}

async function login(login, password) {
  const r = await request('POST', '/api/auth/login', { body: { login, password } });
  return r.status === 200 && r.json && r.json.ok ? cookieHeader(cookieJar(r.setCookies)) : null;
}

(async () => {
  console.log('\nМатрица прав и роль developer');

  const devCookie = await login('developer', 'developer');
  const adminCookie = await login('Admin', 'Admin');
  const managerCookie = await login('manager', 'qwer1234');
  check('вход разработчиком', !!devCookie);
  check('вход администратором', !!adminCookie);
  check('вход менеджером', !!managerCookie);

  const db0 = await request('GET', '/api/db');
  check('миграция засеяла роль developer', db0.json && db0.json.users.some(u => u.role === 'developer'));
  check('миграция засеяла каталог прав', db0.json && Array.isArray(db0.json.permissions) && db0.json.permissions.length >= 20,
    'прав: ' + (db0.json && db0.json.permissions ? db0.json.permissions.length : 0));
  check('миграция дала admin все права',
    db0.json && db0.json.rolePermissions && Array.isArray(db0.json.rolePermissions.admin) &&
    db0.json.rolePermissions.admin.length === db0.json.permissions.length);

  // GET матрицы: только разработчик
  const getDev = await request('GET', '/api/permissions', { cookie: devCookie });
  check('разработчик читает матрицу', getDev.status === 200 && getDev.json && getDev.json.ok);
  const getAdmin = await request('GET', '/api/permissions', { cookie: adminCookie });
  check('администратор не читает матрицу', getAdmin.status === 403, 'HTTP ' + getAdmin.status);
  const getMgr = await request('GET', '/api/permissions', { cookie: managerCookie });
  check('менеджер не читает матрицу', getMgr.status === 403, 'HTTP ' + getMgr.status);

  // PUT матрицы: только разработчик
  const original = (db0.json && db0.json.rolePermissions) || {};
  const modified = JSON.parse(JSON.stringify(original));
  if (!modified.admin) modified.admin = [];
  const idx = modified.admin.indexOf('news.publish');
  if (idx > -1) modified.admin.splice(idx, 1); else modified.admin.push('news.publish');

  const putAdmin = await request('PUT', '/api/permissions', { cookie: adminCookie, body: { rolePermissions: modified } });
  check('администратор не меняет матрицу', putAdmin.status === 403, 'HTTP ' + putAdmin.status);

  const putDev = await request('PUT', '/api/permissions', { cookie: devCookie, body: { rolePermissions: modified } });
  check('разработчик меняет матрицу', putDev.status === 200 && putDev.json && putDev.json.ok);

  const after = await request('GET', '/api/permissions', { cookie: devCookie });
  check('изменение применилось сразу',
    after.json && after.json.rolePermissions && after.json.rolePermissions.admin.indexOf('news.publish') === -1,
    'news.publish у admin: ' + (after.json && after.json.rolePermissions && after.json.rolePermissions.admin.indexOf('news.publish')));

  // Вернуть исходную матрицу
  await request('PUT', '/api/permissions', { cookie: devCookie, body: { rolePermissions: original } });

  // /api/db: не-разработчик не может поменять rolePermissions/roles
  const tampered = JSON.parse(JSON.stringify(db0.json));
  tampered.rolePermissions = modified;
  const dbPutMgr = await request('POST', '/api/db', { cookie: managerCookie, body: tampered });
  check('/api/db блокирует смену матрицы не-разработчиком', dbPutMgr.status === 403, 'HTTP ' + dbPutMgr.status);

  const normal = JSON.parse(JSON.stringify(db0.json));
  const dbPutAdmin = await request('POST', '/api/db', { cookie: adminCookie, body: normal });
  check('/api/db пропускает обычное сохранение администратором', dbPutAdmin.status === 200, 'HTTP ' + dbPutAdmin.status);

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки матрицы прав пройдены');
  process.exit(failures ? 1 : 0);
})().catch(err => {
  console.error('Ошибка теста: ' + err.message);
  process.exit(1);
});

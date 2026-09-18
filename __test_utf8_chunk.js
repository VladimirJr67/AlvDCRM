/* ============================================================
   __test_utf8_chunk.js — регрессия: многобайтовые символы при
   разрезе сетевого пакета не портятся в U+FFFD.

   Воспроизводит старую ошибку: тело POST /api/db делилось на части и
   декодировалось как «body += chunk», из-за чего буква, попавшая на границу
   пакета, превращалась в «�». Теперь сервер собирает чанки в буфер и
   декодирует в конце — символ должен выжить даже при разрезе посередине.

   Требует запущенного сервера:
     PORT=3100 node server.js --no-open
     PORT=3100 node __test_utf8_chunk.js

   База возвращается в исходное состояние.
   ============================================================ */

const net = require('net');
const http = require('http');

const PORT = Number(process.env.PORT) || 3100;
const HOST = '127.0.0.1';
const MARKER = 'ПроверкаКодировки_АВД_профиль'; // много 2-байтовых букв

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

// Отправка тела с принудительным разрезом внутри 2-байтового символа.
function postSplit(bytes, splitAt) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, HOST, () => {
      sock.write(
        `POST /api/db HTTP/1.1\r\n` +
        `Host: ${HOST}\r\n` +
        `Content-Type: application/json; charset=utf-8\r\n` +
        `Content-Length: ${bytes.length}\r\n` +
        `Connection: close\r\n\r\n`
      );
      sock.write(bytes.slice(0, splitAt));
      setTimeout(() => {
        sock.write(bytes.slice(splitAt));
        sock.end();
      }, 30);
    });
    let resp = '';
    sock.on('data', c => { resp += c; });
    sock.on('end', () => resolve(resp));
    sock.on('error', reject);
  });
}

(async () => {
  console.log('\nUTF-8: многобайтовые символы не портятся при разрезе пакета');

  const original = await getJson('/api/db');
  const backup = JSON.parse(JSON.stringify(original));
  if (!backup.clients.length) backup.clients.push({ orgName: 'Клиент' });
  backup.clients[0].orgName = MARKER;

  const body = JSON.stringify(backup);
  const bytes = Buffer.from(body, 'utf8');

  // Находим в байтах двухбайтовый символ «и» (U+0438 = 0xD0 0xB8) и режем
  // ровно между его байтами.
  const target = Buffer.from([0xd0, 0xb8]);
  const charPos = bytes.indexOf(target);
  check('в теле есть двухбайтовый символ для разреза', charPos >= 0);
  const splitAt = charPos + 1;

  const response = await postSplit(bytes, splitAt);
  check('сервер принял разрезанный запрос', /200 OK/.test(response), 'HTTP: ' + (response.split('\r\n')[0] || '?'));

  const after = await getJson('/api/db');
  check('символ пережил разрез пакета без U+FFFD',
    after.clients[0].orgName === MARKER,
    'получено: ' + JSON.stringify(after.clients[0].orgName));
  // Сравниваем с исходным количеством: новые повреждения не должны появиться.
  const beforeCount = (JSON.stringify(original).match(/\uFFFD/g) || []).length;
  const afterCount = (JSON.stringify(after).match(/\uFFFD/g) || []).length;
  check('новых повреждений U+FFFD не появилось', afterCount === beforeCount,
    'было ' + beforeCount + ', стало ' + afterCount);

  // Возвращаем базу в исходное состояние.
  await new Promise((resolve, reject) => {
    const payload = JSON.stringify(backup);
    const req = http.request({
      host: HOST, port: PORT, path: '/api/db', method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) }
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
  // Вторая запись нужна, чтобы вернуть именно original (маркер убран).
  await new Promise((resolve, reject) => {
    const payload = JSON.stringify(original);
    const req = http.request({
      host: HOST, port: PORT, path: '/api/db', method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) }
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  const restored = await getJson('/api/db');
  check('база восстановлена', JSON.stringify(restored) === JSON.stringify(original));

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки UTF-8 пройдены');
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message);
  process.exitCode = 1;
});

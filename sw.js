/* ============================================================
   sw.js — Service Worker «Алвид CRM».

   Нужен для системных уведомлений: попап рисует сама операционная система
   через registration.showNotification(), поэтому он виден поверх любых окон,
   даже когда вкладка свёрнута или браузер не в фокусе. Клик по уведомлению
   открывает (или поднимает) окно CRM.

   Файл лежит в корне проекта, чтобы область действия была «/». Регистрация
   возможна только в защищённом контексте: http://localhost подходит, обычный
   адрес по локальной сети (http://192.168.x.x) — нет. Если регистрация не
   удалась, приложение автоматически переходит на new Notification(), а затем
   на всплывающие карточки внутри страницы (см. js/notifications.js).
   ============================================================ */

const SW_VERSION = 'alvid-crm-sw-1';

self.addEventListener('install', () => {
  // Новая версия вступает в силу сразу, без ожидания закрытия вкладок.
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Клик по системному уведомлению: поднять уже открытое окно CRM
// или открыть новое.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return null;
    })
  );
});

// Заглушка на будущее: если сервер начнёт отправлять push-сообщения,
// обработчик уже на месте.
self.addEventListener('push', event => {
  let payload = { title: 'Алвид CRM', body: 'Новое уведомление' };
  try {
    if (event.data) payload = Object.assign(payload, event.data.json());
  } catch (e) { /* не JSON — показываем текст как есть */ }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag || SW_VERSION,
      data: { url: payload.url || '/' }
    })
  );
});

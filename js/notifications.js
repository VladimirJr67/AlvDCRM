/* ============================================================
   js/notifications.js — системные уведомления в личном кабинете.

   Индикатор непрочитанных на пункте меню; клик по уведомлению
   открывает связанную задачу.

   Кроме списка внутри приложения уведомления показываются системой
   (Web Notifications API) — такой попап виден поверх всех окон, даже когда
   вкладка свёрнута. Показ идёт через Service Worker (см. sw.js), поэтому
   уведомление можно кликнуть и вернуться в CRM; если Service Worker
   недоступен — через new Notification(), а если и его нет (не защищённый
   контекст, запрет в браузере) — остаётся всплывающая карточка в странице.
   ============================================================ */

let notifications = [];

const NOTIFICATIONS_KEY = 'alvid_crm_notifications';

// Иконка для системного попапа — тот же логотип, что в сайдбаре.
const NOTIFY_ICON = 'https://avatars.mds.yandex.net/i?id=59709a441721a5e380612fdd93e30472_l-5098586-images-thumbs&n=13';

let notifySwRegistration = null;   // регистрация Service Worker
let notifySwTried = false;         // регистрацию пробуем один раз за сессию

function loadNotifications() {
  const saved = localStorage.getItem(NOTIFICATIONS_KEY);
  notifications = saved ? JSON.parse(saved) : [];
}

function saveNotifications() {
  localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
  queueServerSave();
}

/* ===== Системные уведомления (поверх всех окон) ===== */

// Требуется защищённый контекст (localhost или https) и разрешение пользователя.
function nativeNotifySupported() {
  return typeof window !== 'undefined' &&
    typeof Notification !== 'undefined' &&
    window.isSecureContext !== false;
}

function nativeNotifyPermission() {
  if (!nativeNotifySupported()) return 'unsupported';
  return Notification.permission;   // 'default' | 'granted' | 'denied'
}

// Включены ли системные попапы у текущего пользователя.
function nativeNotifyEnabled() {
  if (!nativeNotifySupported()) return false;
  if (Notification.permission !== 'granted') return false;
  const s = (currentUser && currentUser.settings) || {};
  return s.native !== false;        // по умолчанию включены
}

// Регистрация Service Worker — один раз за сессию, без падений:
// в режиме file:// и по адресу в локальной сети она просто не сработает.
async function initNativeNotifications() {
  if (notifySwTried) return notifySwRegistration;
  notifySwTried = true;
  if (!nativeNotifySupported()) return null;
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return null;
  if (typeof apiAvailable === 'function' && !apiAvailable()) return null;
  try {
    notifySwRegistration = await navigator.serviceWorker.register('/sw.js');
  } catch (e) {
    notifySwRegistration = null;   // останутся new Notification / карточки в странице
  }
  return notifySwRegistration;
}

// Запрос разрешения у браузера (кнопка в профиле).
async function requestNativeNotifyPermission() {
  if (!nativeNotifySupported()) {
    return { ok: false, error: 'Браузер не поддерживает системные уведомления' };
  }
  await initNativeNotifications();
  try {
    const result = await Notification.requestPermission();
    if (result !== 'granted') {
      return { ok: false, error: 'Разрешение не выдано — уведомления будут только внутри приложения' };
    }
    showNativeNotification('Алвид CRM', 'Системные уведомления включены', { tag: 'alvid-permission' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Не удалось получить разрешение: ' + e.message };
  }
}

// Показать системный попап. Возвращает true, если его приняла система.
async function showNativeNotification(title, body, opts) {
  if (!nativeNotifyEnabled()) return false;
  const o = opts || {};
  const options = {
    body: String(body == null ? '' : body),
    tag: o.tag || 'alvid-crm',
    icon: NOTIFY_ICON,
    badge: NOTIFY_ICON,
    data: { url: '/', taskId: o.taskId != null ? o.taskId : null }
  };
  try {
    if (notifySwRegistration && notifySwRegistration.showNotification) {
      await notifySwRegistration.showNotification(String(title || 'Алвид CRM'), options);
      return true;
    }
    new Notification(String(title || 'Алвид CRM'), options);
    return true;
  } catch (e) {
    return false;
  }
}

// Создать уведомление для пользователя (например, при назначении задачи).
// opts.silent — не дублировать попап и звук (их уже показал вызывающий код).
function notifyUser(userId, title, message, taskId, opts) {
  const o = opts || {};
  const maxId = notifications.reduce((m, n) => Math.max(m, n.id || 0), 0);
  notifications.push({
    id: maxId + 1,
    userId: userId,
    title: title,
    message: message,
    taskId: taskId || null,
    read: false,
    position: notifySettings().position,
    sound: notifySettings().sound,
    createdAt: new Date().toISOString()
  });
  saveNotifications();

  // Системный попап поверх окон и звук — только для самого пользователя:
  // уведомления другим людям покажет их собственный браузер.
  if (!o.silent && currentUser && userId === currentUser.id) {
    playNotifySound();
    showNativeNotification(title, message, { taskId: taskId });
  }
  updateNotificationBadge();
}

function unreadNotifications() {
  if (!currentUser) return 0;
  return notifications.filter(n => n.userId === currentUser.id && !n.read).length;
}

function updateNotificationBadge() {
  const count = unreadNotifications();
  const badge = document.getElementById('notificationsMenuBadge');
  if (!badge) return;
  badge.style.display = count > 0 ? 'flex' : 'none';
  badge.textContent = count;
  badge.title = count > 0 ? `Непрочитанных уведомлений: ${count}` : 'Нет непрочитанных уведомлений';
}

function renderNotifications() {
  const main = document.getElementById('mainContent');
  if (!main) return;
  if (!currentUser) return;

  const mine = notifications
    .filter(n => n.userId === currentUser.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const unread = mine.filter(n => !n.read).length;

  main.innerHTML = `
    <div style="padding:30px;max-width:900px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">Уведомления</h1>
        <button class="btn btn-secondary btn-sm" onclick="markAllNotificationsRead()" ${unread ? '' : 'disabled'}>Прочитать все</button>
      </div>
      ${mine.length === 0 ? `
        <div class="empty-state" style="padding:80px 20px;"><p>Нет уведомлений</p></div>
      ` : `
        <div class="notifications-list">
          ${mine.map(n => `
            <div class="notification-item ${n.read ? '' : 'unread'}" onclick="openNotification(${n.id})">
              <div class="notification-dot"></div>
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;color:#111;">${escapeHtml(n.title)}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(n.message)}</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:4px;">${formatDateTime(n.createdAt)}</div>
              </div>
              <div style="flex-shrink:0;">
                ${n.read
                  ? '<span class="badge" style="background:#f3f4f6;color:#9ca3af;">прочитано</span>'
                  : '<span class="badge" style="background:#dbeafe;color:#1e40af;">новое</span>'}
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
  updateNotificationBadge();
}

function openNotification(id) {
  const n = notifications.find(x => x.id === id);
  if (!n) return;
  if (!n.read) {
    n.read = true;
    saveNotifications();
  }
  renderNotifications();
  if (n.taskId) {
    const t = tasks.find(x => x.id === n.taskId);
    if (t) openTaskModal(t);
  }
}

function markAllNotificationsRead() {
  if (!currentUser) return;
  notifications.forEach(n => {
    if (n.userId === currentUser.id) n.read = true;
  });
  saveNotifications();
  renderNotifications();
}

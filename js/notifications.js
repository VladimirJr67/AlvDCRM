/* ============================================================
   js/notifications.js — системные уведомления в личном кабинете.
   Индикатор непрочитанных на пункте меню; клик по уведомлению
   открывает связанную задачу.
   ============================================================ */

let notifications = [];

const NOTIFICATIONS_KEY = 'alvid_crm_notifications';

function loadNotifications() {
  const saved = localStorage.getItem(NOTIFICATIONS_KEY);
  notifications = saved ? JSON.parse(saved) : [];
}

function saveNotifications() {
  localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
  queueServerSave();
}

// Создать уведомление для пользователя (например, при назначении задачи).
function notifyUser(userId, title, message, taskId) {
  const maxId = notifications.reduce((m, n) => Math.max(m, n.id || 0), 0);
  notifications.push({
    id: maxId + 1,
    userId: userId,
    title: title,
    message: message,
    taskId: taskId || null,
    read: false,
    createdAt: new Date().toISOString()
  });
  saveNotifications();
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
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">🔔 Уведомления</h1>
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

/* ============================================================
   js/chat.js — «Чат менеджеров».

   Общий канал для сотрудников с ролью «менеджер по продажам» (role=manager).
   Администратор и руководитель этот раздел не видят — он изолирован: чужие
   роли не только не получают пункт меню, но и не могут отправить или прочитать
   сообщение, даже вызвав функцию напрямую.

   Сообщения лежат в общей коллекции chatManagers (db.json) и синхронизируются
   между окнами как остальные данные. Непрочитанные считаются по списку readBy:
   у каждого сообщения хранится, кто его прочитал.
   ============================================================ */

// Роль, которой доступен чат менеджеров. Строго 'manager': руководитель и
// администратор в этом канале не участвуют.
const CHAT_MANAGERS_ROLE = 'manager';

// Длина сообщения — чтобы база не разрасталась от случайной вставки.
const CHAT_MESSAGE_MAX = 2000;

function saveChatManagers() {
  if (typeof queueServerSave === 'function') queueServerSave();
}

// Разрешён ли текущему пользователю чат менеджеров. Роль берём из актуального
// списка пользователей, а не из сессии: понижение роли закрывает доступ.
function canUseManagersChat() {
  if (!currentUser) return false;
  const live = findUserById(currentUser.id) || findUserByLogin(currentUser.login);
  return !!live && normalizeRole(live.role) === CHAT_MANAGERS_ROLE;
}

function chatMessages() {
  return (chatManagers || []).slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

function chatMessageAuthor(m) {
  const u = m && m.authorId ? findUserById(m.authorId) : null;
  return u ? (u.name || u.login) : ((m && m.authorName) || '—');
}

// Непрочитанные сообщения текущего менеджера: написанные не им и без него в readBy.
function unreadChatCount() {
  if (!canUseManagersChat() || !currentUser) return 0;
  const me = currentUser.id;
  return (chatManagers || []).filter(m =>
    m && m.authorId !== me && (m.readBy || []).indexOf(me) === -1
  ).length;
}

function updateChatMenuBadge() {
  const badge = document.getElementById('chatMenuBadge');
  if (!badge) return;
  const count = unreadChatCount();
  badge.style.display = count > 0 ? 'flex' : 'none';
  badge.textContent = count;
  badge.title = count > 0 ? `Непрочитанных сообщений: ${count}` : '';
}

// Отметить все чужие сообщения прочитанными (при открытии раздела).
function markChatRead() {
  if (!canUseManagersChat() || !currentUser) return;
  const me = currentUser.id;
  let changed = false;
  (chatManagers || []).forEach(m => {
    if (!m || m.authorId === me) return;
    if (!Array.isArray(m.readBy)) m.readBy = [];
    if (m.readBy.indexOf(me) === -1) { m.readBy.push(me); changed = true; }
  });
  if (changed) saveChatManagers();
  updateChatMenuBadge();
}

// Отправка сообщения. Доступна только менеджерам; остальным — отказ.
// Уведомления в раздел «Уведомления» НЕ создаются: коллеги видят новое
// сообщение по общему счётчику непрочитанных в меню (chatMenuBadge).
function sendChatMessage(text) {
  if (!canUseManagersChat()) {
    return { ok: false, error: 'Чат менеджеров доступен только менеджерам по продажам' };
  }
  const clean = String(text == null ? '' : text).trim();
  if (!clean) return { ok: false, error: 'Введите сообщение' };
  if (clean.length > CHAT_MESSAGE_MAX) {
    return { ok: false, error: 'Сообщение слишком длинное (максимум ' + CHAT_MESSAGE_MAX + ' символов)' };
  }

  const me = currentUser.id;
  const maxId = (chatManagers || []).reduce((m, x) => Math.max(m, x.id || 0), 0);
  chatManagers.push({
    id: maxId + 1,
    authorId: me,
    authorName: currentUser.name || currentUser.login || '',
    text: clean,
    createdAt: new Date().toISOString(),
    readBy: [me]
  });
  saveChatManagers();

  updateChatMenuBadge();
  return { ok: true };
}

function sendChatMessageFromForm() {
  const input = document.getElementById('chatInput');
  const res = sendChatMessage(input ? input.value : '');
  if (!res.ok) { alert(res.error); return; }
  if (input) input.value = '';
  renderChat();
}

// Сообщение по Enter без Shift (Shift+Enter — перенос строки).
function onChatInputKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  sendChatMessageFromForm();
}

/* ===== Правка и удаление своих сообщений (П.21) ===== */

function isMyChatMessage(m) {
  return !!(m && currentUser && m.authorId === currentUser.id);
}

function editChatMessage(id) {
  if (!canUseManagersChat()) return { ok: false, error: 'Чат менеджеров доступен только менеджерам по продажам' };
  const m = (chatManagers || []).find(x => x && x.id === id);
  if (!m) return { ok: false, error: 'Сообщение не найдено' };
  if (!isMyChatMessage(m)) return { ok: false, error: 'Редактировать можно только свои сообщения' };

  const value = prompt('Редактировать сообщение:', m.text || '');
  if (value === null) return { ok: false, error: 'Отменено' };
  const clean = String(value || '').trim();
  if (!clean) { alert('Сообщение не может быть пустым'); return { ok: false, error: 'Пустое сообщение' }; }
  if (clean.length > CHAT_MESSAGE_MAX) {
    alert('Сообщение слишком длинное (максимум ' + CHAT_MESSAGE_MAX + ' символов)');
    return { ok: false, error: 'Слишком длинное сообщение' };
  }

  m.text = clean;
  m.editedAt = new Date().toISOString();
  saveChatManagers();
  renderChat();
  return { ok: true };
}

function deleteChatMessage(id) {
  if (!canUseManagersChat()) return { ok: false, error: 'Чат менеджеров доступен только менеджерам по продажам' };
  const m = (chatManagers || []).find(x => x && x.id === id);
  if (!m) return { ok: false, error: 'Сообщение не найдено' };
  if (!isMyChatMessage(m)) return { ok: false, error: 'Удалять можно только свои сообщения' };
  if (!confirm('Удалить сообщение?')) return { ok: false, error: 'Отменено' };

  chatManagers = (chatManagers || []).filter(x => !x || x.id !== id);
  saveChatManagers();
  renderChat();
  return { ok: true };
}

/* ===== Раздел «Чат менеджеров» ===== */

function renderChat() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  // Раздел изолирован: посторонним — понятный отказ, даже при прямом переходе.
  if (!canUseManagersChat()) {
    main.innerHTML = `
      <div class="placeholder">
        <h2>Доступ запрещён</h2>
        <p>Чат менеджеров доступен только менеджерам по продажам.</p>
      </div>`;
    return;
  }

  markChatRead();
  const list = chatMessages();
  const me = currentUser.id;

  main.innerHTML = `
    <div class="chat-page">
      <div class="chat-head">
        <h1>Чат менеджеров</h1>
        <span class="chat-badge">только менеджеры по продажам</span>
      </div>
      <div class="chat-feed" id="chatFeed">
        ${list.length === 0
          ? '<div class="chat-empty">Сообщений пока нет. Напишите первым.</div>'
          : list.map(m => `
            <div class="chat-msg${m.authorId === me ? ' mine' : ''}">
              <div class="chat-msg-head">
                <strong>${escapeHtml(chatMessageAuthor(m))}</strong>
                <span>${escapeHtml(formatDateTime(m.createdAt))}${m.editedAt ? ' · изменено' : ''}</span>
                ${isMyChatMessage(m) ? `<span class="chat-msg-actions">
                  <button class="btn-icon-btn" onclick="editChatMessage(${m.id})" title="Редактировать сообщение">Изменить</button>
                  <button class="btn-icon-btn" onclick="deleteChatMessage(${m.id})" title="Удалить сообщение">Удалить</button>
                </span>` : ''}
              </div>
              <div class="chat-msg-text">${escapeHtml(m.text)}</div>
            </div>`).join('')}
      </div>
      <div class="chat-form">
        <textarea id="chatInput" rows="2" placeholder="Сообщение коллегам… (Enter — отправить, Shift+Enter — новая строка)"
                  onkeydown="onChatInputKeydown(event)"></textarea>
        <button type="button" class="btn" onclick="sendChatMessageFromForm()">Отправить</button>
      </div>
    </div>
  `;

  // Прокручиваем ленту к последнему сообщению.
  const feed = document.getElementById('chatFeed');
  if (feed) feed.scrollTop = feed.scrollHeight;
}

/* ============================================================
   js/reminders.js — модуль «Напоминания».

   — раскладка адаптивная, без центрирования: список и календарь
     перестраиваются под ширину окна;
   — тип напоминания: «Для себя» (личное, видит только автор) или
     «Для клиента» (видно всем, выводится индикатором в карточке);
   — важность задаёт цвет индикатора: красный — обязательно
     к просмотру, жёлтый — обратить внимание, зелёный — информационное;
   — в назначенное время всплывает уведомление в интерфейсе.
   ============================================================ */

let reminders = [];
let currentReminderMonth = new Date().getMonth();
let currentReminderYear = new Date().getFullYear();
let reminderDateFilter = null;
let reminderScopeFilter = 'all';

// Важность напоминания. Значение хранится в поле color (совместимо со
// старыми записями), но смысл теперь строго трёхуровневый.
const REMINDER_LEVELS = [
  { value: '#ef4444', key: 'urgent', name: 'Обязательно к просмотру' },
  { value: '#f59e0b', key: 'attention', name: 'Обратить внимание' },
  { value: '#10b981', key: 'info', name: 'Информационное' }
];

const REMINDER_LEVEL_RANK = { urgent: 3, attention: 2, info: 1 };

// Раньше можно было выбрать произвольный цвет из палитры — приводим
// старые значения к трём уровням.
const LEGACY_LEVEL_MAP = {
  '#ef4444': '#ef4444',
  '#f59e0b': '#f59e0b',
  '#10b981': '#10b981',
  '#3b82f6': '#f59e0b',
  '#6b7280': '#10b981'
};

function reminderLevelInfo(color) {
  const normalized = LEGACY_LEVEL_MAP[color] || REMINDER_LEVELS[2].value;
  const lvl = REMINDER_LEVELS.find(l => l.value === normalized) || REMINDER_LEVELS[2];
  // color продублирован как отдельное поле: он подставляется прямо в разметку
  // (рамки карточек, точки календаря, индикатор клиента).
  return { value: lvl.value, color: lvl.value, key: lvl.key, name: lvl.name };
}

// Локальная дата в формате YYYY-MM-DD: toISOString() отдаёт UTC,
// из-за чего ночью «сегодня» уезжало на день назад.
function todayISO(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function formatReminderDate(dateStr) {
  if (!dateStr) return '—';
  const today = todayISO();
  const tomorrow = todayISO(new Date(Date.now() + 24 * 60 * 60 * 1000));
  if (dateStr === today) return 'Сегодня';
  if (dateStr === tomorrow) return 'Завтра';
  const d = new Date(String(dateStr) + 'T00:00:00');
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function reminderDateTime(r) {
  return new Date((r.date || '') + 'T' + (r.time || '09:00'));
}

function loadReminders() {
  const saved = localStorage.getItem('alvid_crm_reminders');
  reminders = saved ? JSON.parse(saved) : [];
  if (!Array.isArray(reminders)) reminders = [];
}

function saveReminders() {
  localStorage.setItem('alvid_crm_reminders', JSON.stringify(reminders));
  // Напоминания должны попадать в общую базу (db.json), чтобы их видели
  // другие пользователи через поллинг/SSE.
  queueServerSave();
}

/* ===== Тип и видимость ===== */

function reminderScope(r) {
  if (r && (r.scope === 'self' || r.scope === 'client')) return r.scope;
  // Старые записи: привязанные к клиенту считаем клиентскими.
  return (r && r.clientId) ? 'client' : 'self';
}

function reminderScopeLabel(r) {
  return reminderScope(r) === 'client' ? 'Для клиента' : 'Для себя';
}

// Личные напоминания видит только автор. Если автор неизвестен
// (записи до появления типов), напоминание остаётся общим.
function canSeeReminder(r) {
  if (reminderScope(r) === 'client') return true;
  if (!r.createdBy) return true;
  return !!currentUser && r.createdBy === currentUser.id;
}

function visibleReminders() {
  return reminders.filter(canSeeReminder);
}

function isMyReminder(r) {
  return !!currentUser && r.createdBy === currentUser.id;
}

/* ===== Индикатор напоминаний в карточке клиента ===== */

// Важнейшее из активных напоминаний клиента: красное важнее жёлтого,
// жёлтое — зелёного. Нужно для цветного маркера в разделе «Клиенты».
function clientReminderMarker(clientId) {
  if (!clientId) return null;
  const active = reminders.filter(r => !r.completed && r.clientId === clientId && canSeeReminder(r));
  if (!active.length) return null;

  let best = active[0];
  active.forEach(r => {
    if (REMINDER_LEVEL_RANK[reminderLevelInfo(r.color).key] >
        REMINDER_LEVEL_RANK[reminderLevelInfo(best.color).key]) best = r;
  });

  const nearest = active.slice().sort((a, b) => reminderDateTime(a) - reminderDateTime(b))[0];
  return {
    level: reminderLevelInfo(best.color),
    count: active.length,
    nearest: nearest
  };
}

function clientReminderTitle(clientId) {
  const m = clientReminderMarker(clientId);
  if (!m) return '';
  const when = formatReminderDate(m.nearest.date) + (m.nearest.time ? ' ' + m.nearest.time : '');
  return 'Напоминаний: ' + m.count + ' · ' + m.level.name + ' · ближайшее: ' + when + ' — ' + m.nearest.title;
}

// Цветная точка-маркер для таблицы клиентов и карточки.
function clientReminderDotHtml(clientId) {
  const m = clientReminderMarker(clientId);
  if (!m) return '';
  return `<span class="client-reminder-dot" style="background:${m.level.color};" title="${escapeHtml(clientReminderTitle(clientId))}"></span>`;
}

// Плашка для карточки: «Напоминания: 2» нужным цветом.
function clientReminderBadgeHtml(clientId) {
  const m = clientReminderMarker(clientId);
  if (!m) return '';
  return `<span class="client-reminder-badge" style="background:${m.level.color}1f;color:${m.level.color};border-color:${m.level.color}66;"
                title="${escapeHtml(clientReminderTitle(clientId))}">Напоминания: ${m.count}</span>`;
}

/* ===== Раздел «Напоминания» ===== */

function setReminderScopeFilter(value) {
  reminderScopeFilter = value || 'all';
  renderReminders();
}

function renderReminders() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  const visible = visibleReminders();
  let filtered = visible;
  if (reminderScopeFilter !== 'all') filtered = filtered.filter(r => reminderScope(r) === reminderScopeFilter);
  if (reminderDateFilter) filtered = filtered.filter(r => r.date === reminderDateFilter);

  const today = todayISO();
  const upcoming = filtered
    .filter(r => !r.completed && r.date >= today)
    .sort((a, b) => reminderDateTime(a) - reminderDateTime(b));
  const overdue = filtered
    .filter(r => !r.completed && r.date < today)
    .sort((a, b) => reminderDateTime(b) - reminderDateTime(a));
  const completed = filtered
    .filter(r => r.completed)
    .sort((a, b) => reminderDateTime(b) - reminderDateTime(a));

  const group = (title, list, status, color) => list.length === 0 ? '' : `
    <section class="reminders-group">
      <h3 class="reminders-group-title" style="color:${color};">
        ${title}<span class="reminders-group-count">${list.length}</span>
      </h3>
      <div class="reminders-list">${list.map(r => renderReminderCard(r, status)).join('')}</div>
    </section>`;

  const scopeOption = (value, label) =>
    `<option value="${value}"${reminderScopeFilter === value ? ' selected' : ''}>${label}</option>`;

  main.innerHTML = `
    <div class="reminders-page">
      <div class="reminders-head">
        <div class="reminders-head-text">
          <h1>Напоминания${reminderDateFilter ? ' — ' + formatReminderDate(reminderDateFilter) : ''}</h1>
          <div class="reminders-sub">Личные напоминания видите только вы, клиентские — вся команда</div>
        </div>
        <div class="reminders-head-actions">
          <select class="reminders-scope-filter" onchange="setReminderScopeFilter(this.value)" title="Фильтр по типу">
            ${scopeOption('all', 'Все типы')}
            ${scopeOption('self', 'Для себя')}
            ${scopeOption('client', 'Для клиента')}
          </select>
          ${reminderDateFilter ? '<button class="btn btn-secondary btn-sm" onclick="clearReminderDateFilter()">Сбросить дату</button>' : ''}
          <button class="btn" onclick="openReminderModal()">+ Новое напоминание</button>
        </div>
      </div>

      <div class="reminders-stats">
        <div class="stat-card"><div class="stat-value" style="color:#ef4444">${overdue.length}</div><div class="stat-label">Просрочено</div></div>
        <div class="stat-card"><div class="stat-value" style="color:#3b82f6">${upcoming.length}</div><div class="stat-label">Предстоит</div></div>
        <div class="stat-card"><div class="stat-value" style="color:#10b981">${completed.length}</div><div class="stat-label">Выполнено</div></div>
      </div>

      <div class="reminders-layout">
        <div class="reminders-main">
          ${group('Просрочено', overdue, 'overdue', '#ef4444')}
          ${group('Предстоящие', upcoming, 'upcoming', '#3b82f6')}
          ${group('Выполнено', completed.slice(0, 12), 'completed', '#10b981')}
          ${filtered.length === 0 ? `
            <div class="reminders-empty">
              <h2>${reminderDateFilter ? 'На выбранную дату напоминаний нет' : 'Нет напоминаний'}</h2>
              <p>Создайте первое напоминание — кнопкой «+ Новое напоминание» или «Быстрое напоминание» в боковом меню.</p>
            </div>` : ''}
        </div>
        <aside class="reminders-side">${renderReminderCalendar()}</aside>
      </div>
    </div>
  `;
}

function renderReminderCard(reminder, status) {
  const level = reminderLevelInfo(reminder.color);
  const isCompleted = status === 'completed';
  const client = reminder.clientId ? clients.find(c => c.id === reminder.clientId) : null;
  const isClient = reminderScope(reminder) === 'client';

  return `
    <article class="reminder-card${isCompleted ? ' done' : ''}${status === 'overdue' ? ' overdue' : ''}"
             style="border-left-color:${status === 'overdue' ? '#ef4444' : level.color};">
      <div class="reminder-card-head">
        <input type="checkbox" ${isCompleted ? 'checked' : ''} onchange="toggleReminderComplete(${reminder.id})"
               title="Отметить выполненным" class="reminder-card-check">
        <div class="reminder-card-title">${escapeHtml(reminder.title)}</div>
        <div class="reminder-card-actions">
          <button class="btn-icon-btn" onclick="editReminder(${reminder.id})" title="Редактировать">Изменить</button>
          <button class="btn-icon-btn" onclick="deleteReminder(${reminder.id})" title="Удалить">Удалить</button>
        </div>
      </div>

      ${reminder.description ? `<p class="reminder-card-text">${escapeHtml(reminder.description)}</p>` : ''}

      <div class="reminder-card-when${status === 'overdue' ? ' overdue' : ''}">
        ${formatReminderDate(reminder.date)} · ${escapeHtml(reminder.time || '—')}
      </div>

      <div class="reminder-card-meta">
        <span class="reminder-chip" style="background:${level.color}1f;color:${level.color};">${escapeHtml(level.name)}</span>
        <span class="reminder-chip reminder-chip-scope">${isClient ? 'Для клиента' : 'Для себя'}</span>
        ${client ? `<a href="#" class="reminder-client-link" onclick="event.preventDefault(); goToClient(${client.id});">${escapeHtml(client.orgName)}</a>` : ''}
      </div>
    </article>
  `;
}

function renderReminderCalendar() {
  const year = currentReminderYear;
  const month = currentReminderMonth;
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDay = firstDay.getDay() || 7;

  const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const todayStr = todayISO();
  const visible = visibleReminders();

  let html = `
    <div class="reminders-calendar">
      <div class="reminders-calendar-head">
        <button onclick="changeReminderMonth(-1)" title="Предыдущий месяц">‹</button>
        <span>${monthNames[month]} ${year}</span>
        <button onclick="changeReminderMonth(1)" title="Следующий месяц">›</button>
      </div>
      <div class="reminders-calendar-grid">
  `;

  ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(d => {
    html += `<div class="reminders-calendar-dow">${d}</div>`;
  });

  for (let i = 1; i < startDay; i++) html += '<div></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayReminders = visible.filter(r => r.date === dateStr && !r.completed);
    const isSelected = reminderDateFilter === dateStr;
    const isToday = dateStr === todayStr;

    html += `<div class="reminders-calendar-day${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}"
                  onclick="filterRemindersByDate('${dateStr}')" title="${dayReminders.length ? 'Напоминаний: ' + dayReminders.length : 'Напоминаний нет'}">
      <div class="reminders-calendar-num">${day}</div>
      <div class="reminders-calendar-dots">
        ${dayReminders.slice(0, 4).map(r =>
          `<span style="background:${reminderLevelInfo(r.color).color};"></span>`).join('')}
      </div>
    </div>`;
  }

  html += '</div></div>';
  return html;
}

function changeReminderMonth(delta) {
  currentReminderMonth += delta;
  if (currentReminderMonth > 11) { currentReminderMonth = 0; currentReminderYear++; }
  if (currentReminderMonth < 0) { currentReminderMonth = 11; currentReminderYear--; }
  renderReminders();
}

function filterRemindersByDate(dateStr) {
  reminderDateFilter = reminderDateFilter === dateStr ? null : dateStr;
  renderReminders();
}

function clearReminderDateFilter() {
  reminderDateFilter = null;
  renderReminders();
}

/* ===== Форма напоминания ===== */

function getSelectedReminderScope() {
  const checked = document.querySelector('input[name="reminderScope"]:checked');
  return checked ? checked.value : 'self';
}

// Клиентское напоминание требует клиента, личное — нет, поэтому поле выбора
// клиента показываем только для «Для клиента» и только если клиента ещё нет:
// из карточки клиента он приходит уже выбранным.
function onReminderScopeChange() {
  const scope = getSelectedReminderScope();
  const row = document.getElementById('reminderClientRow');
  const search = document.getElementById('reminderClientSearch');
  const link = document.getElementById('reminderClientLink');
  const fixed = document.getElementById('reminderClientFixed');
  const clientIdEl = document.getElementById('reminderClientId');

  const linkedId = (clientIdEl && clientIdEl.value) ? parseInt(clientIdEl.value, 10) : null;
  const linked = linkedId ? clients.find(c => c.id === linkedId) : null;

  if (row) row.style.display = (scope === 'client' && !linked) ? '' : 'none';
  if (fixed) {
    fixed.style.display = linked ? 'block' : 'none';
    fixed.innerHTML = linked ? `Клиент: <strong>${escapeHtml(linked.orgName)}</strong>` : '';
  }

  if (scope === 'self') {
    if (clientIdEl) clientIdEl.value = '';
    if (search) search.value = '';
    selectedReminderClientId = null;
    if (link) { link.style.display = 'none'; link.innerHTML = ''; }
    if (fixed) { fixed.style.display = 'none'; fixed.innerHTML = ''; }
  } else if (!linked) {
    updateReminderClientLink();
  }
}

function openReminderModal(reminder = null, clientId = null) {  document.getElementById('reminderModalTitle').textContent = reminder ? 'Редактировать напоминание' : 'Новое напоминание';
  document.getElementById('reminderId').value = reminder?.id || '';
  document.getElementById('reminderTitle').value = reminder?.title || '';
  document.getElementById('reminderDescription').value = reminder?.description || '';
  document.getElementById('reminderDate').value = reminder?.date || todayISO();
  document.getElementById('reminderTime').value = reminder?.time || '09:00';

  // Тип: у нового напоминания — «Для себя», если оно открыто не из карточки клиента.
  const scope = reminder ? reminderScope(reminder) : (clientId ? 'client' : 'self');
  document.querySelectorAll('input[name="reminderScope"]').forEach(el => {
    el.checked = (el.value === scope);
  });

  // Важность: для нового напоминания по умолчанию «Обратить внимание».
  const levelSelect = document.getElementById('reminderLevel');
  levelSelect.innerHTML = REMINDER_LEVELS.map(l =>
    `<option value="${l.value}">${escapeHtml(l.name)}</option>`).join('');
  levelSelect.value = reminder ? reminderLevelInfo(reminder.color).value : REMINDER_LEVELS[1].value;

  document.getElementById('reminderClientId').value = reminder?.clientId || clientId || '';
  initReminderClientSearch();
  onReminderScopeChange();
  document.getElementById('reminderModal').classList.add('active');
}

// Убрать привязку к клиенту из окна напоминания (кнопка «убрать» рядом с
// подписью клиента). Напоминание при этом остаётся, просто становится личным.
function unlinkReminderFromClient() {
  const idEl = document.getElementById('reminderClientId');
  if (idEl) idEl.value = '';
  const search = document.getElementById('reminderClientSearch');
  if (search) search.value = '';
  selectedReminderClientId = null;

  const link = document.getElementById('reminderClientLink');
  if (link) { link.style.display = 'none'; link.innerHTML = ''; }
  const fixed = document.getElementById('reminderClientFixed');
  if (fixed) { fixed.style.display = 'none'; fixed.innerHTML = ''; }

  const selfRadio = document.querySelector('input[name="reminderScope"][value="self"]');
  if (selfRadio) selfRadio.checked = true;
  onReminderScopeChange();
}

function saveReminder(e) {
  e.preventDefault();
  const id = document.getElementById('reminderId').value;
  const scope = getSelectedReminderScope();
  const clientIdVal = document.getElementById('reminderClientId').value;
  const clientId = (scope === 'client' && clientIdVal) ? parseInt(clientIdVal) : null;

  if (scope === 'client' && !clientId) {
    alert('Выберите клиента или переключите тип на «Для себя».');
    return;
  }

  const data = {
    title: document.getElementById('reminderTitle').value.trim(),
    description: document.getElementById('reminderDescription').value.trim(),
    date: document.getElementById('reminderDate').value,
    time: document.getElementById('reminderTime').value,
    color: document.getElementById('reminderLevel').value,
    scope: scope,
    clientId: clientId
  };

  if (id) {
    const idx = reminders.findIndex(r => r.id === parseInt(id));
    if (idx !== -1) {
      // Время изменили — напоминание должно сработать заново.
      if (reminders[idx].date !== data.date || reminders[idx].time !== data.time) data.notifiedAt = null;
      reminders[idx] = { ...reminders[idx], ...data };
    }
  } else {
    const maxId = reminders.reduce((m, r) => Math.max(m, r.id || 0), 0);
    data.id = maxId + 1;
    data.completed = false;
    data.createdAt = new Date().toISOString();
    data.createdBy = currentUser ? currentUser.id : null;
    reminders.push(data);
  }

  saveReminders();
  closeModal('reminderModal');
  if (currentSection === 'reminders') renderReminders();
}

function editReminder(id) {
  const r = reminders.find(x => x.id === id);
  if (r) openReminderModal(r);
}

function deleteReminder(id) {
  if (!confirm('Удалить напоминание?')) return;
  reminders = reminders.filter(r => r.id !== id);
  saveReminders();
  renderReminders();
}

function toggleReminderComplete(id) {
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  r.completed = !r.completed;
  r.completedAt = r.completed ? new Date().toISOString() : null;
  saveReminders();
  // Перерисовываем список только если открыт раздел напоминаний: иначе
  // отметка «Выполнено» из всплывающего окна уводила бы пользователя
  // из того раздела, где он работает.
  if (currentSection === 'reminders') renderReminders();
}

/* ===== Навигация ===== */

function goToClient(id) {
  goToSection('clients');
  setTimeout(() => selectClient(id), 50);
}

/* ===== Всплывающее уведомление в назначенное время ===== */

let reminderWatchTimer = null;

function startReminderWatcher() {
  if (reminderWatchTimer) return;
  checkDueReminders();
  reminderWatchTimer = setInterval(checkDueReminders, 20000);
}

// Напоминание пора показать: сегодня, время наступило, ещё не показывали,
// не выполнено и принадлежит текущему пользователю.
function isReminderDue(r, now) {
  if (!r || r.completed || r.notifiedAt) return false;
  if (!isMyReminder(r)) return false;
  const today = todayISO(now);
  if (r.date !== today) return false;
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  return String(r.time || '09:00') <= hhmm;
}

function checkDueReminders() {
  if (!currentUser) return 0;
  const now = new Date();
  const due = reminders.filter(r => isReminderDue(r, now));
  if (!due.length) return 0;

  due.forEach(r => {
    r.notifiedAt = new Date().toISOString();
    showReminderPopup(r);
    // Дубль в «Уведомления» — чтобы напоминание не потерялось, если попап
    // закрыли. Попап, звук и системное уведомление уже показаны, поэтому
    // запись в список идёт без повторного всплытия (silent).
    notifyUser(r.createdBy, 'Напоминание: ' + r.title,
      (r.description || '') + (r.time ? ' · ' + r.time : ''), null, { silent: true });
  });

  saveReminders();
  return due.length;
}

// Всплывающая карточка в правом нижнем углу (позицию и звук берём из профиля).
// Дополнительно показываем системное уведомление — оно видно поверх всех окон,
// если окно CRM свёрнуто.
function showReminderPopup(reminder) {
  const host = ensureToastHost();
  playNotifySound();
  showNativeNotification('Напоминание: ' + reminder.title,
    (reminder.description || '') + (reminder.time ? ' · ' + reminder.time : ''), { tag: 'alvid-reminder' });

  const level = reminderLevelInfo(reminder.color);
  const client = reminder.clientId ? clients.find(c => c.id === reminder.clientId) : null;

  const el = document.createElement('div');
  el.className = 'toast';
  el.style.borderLeftColor = level.color;
  el.innerHTML = `
    <div class="toast-head">
      <span class="toast-dot" style="background:${level.color};"></span>
      <strong>Напоминание</strong>
      <button type="button" class="toast-close" title="Закрыть">✕</button>
    </div>
    <div class="toast-title">${escapeHtml(reminder.title)}</div>
    ${reminder.description ? `<div class="toast-text">${escapeHtml(reminder.description)}</div>` : ''}
    <div class="toast-meta">
      ${escapeHtml(reminder.time || '')}${client ? ' · ' + escapeHtml(client.orgName) : ''} · ${escapeHtml(level.name)}
    </div>
    <div class="toast-actions">
      <button type="button" class="btn btn-sm btn-secondary toast-close-action">Закрыть</button>
      <button type="button" class="btn btn-sm btn-secondary toast-open">Открыть раздел</button>
    </div>`;

  el.querySelector('.toast-close').onclick = () => el.remove();
  // Кнопка в попапе только убирает его с экрана: напоминание не помечается
  // выполненным — это делается в разделе «Напоминания».
  el.querySelector('.toast-close-action').onclick = () => el.remove();
  el.querySelector('.toast-open').onclick = () => { el.remove(); goToSection('reminders'); };

  host.appendChild(el);
  // Автоматически убираем, чтобы уведомления не копились на экране.
  setTimeout(() => { if (el.parentNode) el.remove(); }, 60000);
}

/* ===== Форматирование даты и времени ===== */

function formatDateTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

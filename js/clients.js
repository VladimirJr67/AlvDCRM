let clients = [];
let selectedClientId = null;
let historyFilter = 'all';
let cardClientId = null;

// Карточка просмотра, из которой открыли форму редактирования. Пока форма
// открыта, карточка закрыта; после сохранения или отмены возвращаемся в неё.
let editReturnToCardId = null;

// Индекс выбранного контактного лица: по нему фильтруются комментарии
// в блоке истории. null — выбрано «все контакты».
let selectedContactIdx = null;

// Фильтр списка клиентов: 'mine' (только мои) | 'all' (все) | id менеджера.
let clientManagerFilter = 'mine';
let clientSearchTimer = null;

// Статусы клиента: значение → подпись и цвет квадратного индикатора.
const CLIENT_STATUSES = {
  cooperation: { label: 'Сотрудничество', color: '#10b981' },   // зелёный
  in_progress: { label: 'В работе', color: '#f59e0b' },          // оранжевый
  not_working: { label: 'Не прорабатывать', color: '#ef4444' }   // красный
};

// Статус клиента хранится в поле orgStatus. Раньше чтение шло из ключа
// `status`, которого никто не записывал, поэтому колонка «Статус» всегда
// показывала «—», а при редактировании сохранённое значение затиралось.
function clientStatusInfo(c) {
  const raw = c && (c.orgStatus || c.status);
  const s = raw ? CLIENT_STATUSES[raw] : null;
  return s || { label: '—', color: '#9ca3af' };
}

// Ответственный менеджер клиента — пользователь, создавший карточку.
function clientManager(c) {
  if (!c || !c.createdBy) return null;
  return findUserById(c.createdBy);
}

function clientManagerName(c) {
  const u = clientManager(c);
  if (!u) return '—';
  return u.name || u.login || '—';
}

function normalizeSite(s) {
  if (!s) return '';
  s = s.trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

// Права на редактирование компании и её контента (контакты, комментарии):
// владелец (создатель) + администратор. Остальные — только чтение.
function canEditClient(client) {
  if (!currentUser) return false;
  if (isAdmin()) return true;
  return !!client && client.createdBy === currentUser.id;
}

// Набор видимых компаний в зависимости от выбранного фильтра.
function visibleClientsForFilter() {
  if (!currentUser) return [];
  const f = clientManagerFilter;

  if (f === 'mine') {
    return clients.filter(c => c.createdBy === currentUser.id);
  }
  if (f === 'all') {
    // Администратор — все; пользователь — свои + общие (без владельца).
    if (isAdmin()) return clients;
    return clients.filter(c => c.createdBy === currentUser.id || !c.createdBy);
  }
  // Конкретный менеджер.
  const uid = parseInt(f, 10);
  return clients.filter(c => c.createdBy === uid);
}

// Поиск по всем полям карточки клиента: название, сайт, email, телефон,
// адрес, город, направление, ИНН/ОГРН, основной контакт.
function searchClient(c, q) {
  if (!q) return true;
  const fields = [
    c.orgName, c.orgCity, c.orgDirection, c.orgAddress,
    c.orgPhones, c.orgEmails, c.orgWebsite, c.orgInn, c.orgOgrn
  ];
  return fields.some(f => (f || '').toLowerCase().includes(q));
}

// Debounce поиска в реальном времени (350 мс).
function scheduleClientsSearch() {
  clearTimeout(clientSearchTimer);
  clientSearchTimer = setTimeout(renderClientsTable, 350);
}

// Программная смена фильтра (вызывается из выбора менеджера).
function setClientManagerFilter(value) {
  clientManagerFilter = value;
  renderClientsTable();
  if (selectedClientId) renderClientContacts(selectedClientId);
}

/* ===== Поиск ответственного менеджера =====
   Раньше это был обычный <select>: чтобы дойти до нужного человека,
   приходилось прокручивать список. Теперь это поле ввода с фильтрацией
   по имени/фамилии и логину, плюс те же два фиксированных варианта. */

// Подпись текущего фильтра — то, что видно в поле ввода.
function managerFilterLabel() {
  const f = clientManagerFilter;
  if (f === 'mine') return 'Только мои компании';
  if (f === 'all') return 'Все компании';
  const u = findUserById(parseInt(f, 10));
  return u ? (u.name || u.login) : 'Все компании';
}

// Разметка поля поиска менеджера над таблицей клиентов.
function managerPickerHtml() {
  return `
    <div class="manager-picker" id="managerPicker">
      <input type="text" id="managerSearchInput" class="manager-picker-input"
             placeholder="Менеджер: начните вводить имя..."
             autocomplete="off" value="${escapeHtml(managerFilterLabel())}"
             oninput="onManagerSearchInput()" onfocus="onManagerSearchFocus(event)"
             onkeydown="onManagerSearchKeydown(event)">
      <button type="button" class="manager-picker-clear" onclick="resetManagerFilter()" title="Сбросить фильтр">✕</button>
      <div class="manager-picker-dropdown" id="managerDropdown" onmousedown="event.preventDefault()"></div>
    </div>`;
}

const MANAGER_FIXED_OPTIONS = [
  { value: 'mine', label: 'Только мои компании', hint: 'по умолчанию' },
  { value: 'all', label: 'Все компании', hint: '' }
];

// Варианты с учётом введённого текста: сначала служебные, затем люди.
function managerOptions(query) {
  const q = (query || '').trim().toLowerCase();
  const fixed = MANAGER_FIXED_OPTIONS.filter(o => !q || o.label.toLowerCase().includes(q));
  const people = users
    .filter(u => !q
      || (u.name || '').toLowerCase().includes(q)
      || (u.login || '').toLowerCase().includes(q))
    .map(u => ({ value: String(u.id), label: u.name || u.login, hint: u.login }));
  return fixed.concat(people);
}

let managerHighlight = -1;

function renderManagerDropdown(query) {
  const dd = document.getElementById('managerDropdown');
  if (!dd) return;
  const opts = managerOptions(query);
  managerHighlight = opts.length ? 0 : -1;
  dd.innerHTML = opts.length
    ? opts.map((o, i) => `
        <div class="manager-option${i === 0 ? ' highlight' : ''}${String(clientManagerFilter) === o.value ? ' active' : ''}"
             data-mvalue="${o.value}" data-mlabel="${escapeHtml(o.label)}">
          <span>${escapeHtml(o.label)}</span>
          ${o.hint ? `<span class="mo-hint">${escapeHtml(o.hint)}</span>` : ''}
        </div>`).join('')
    : '<div class="manager-option-empty">Никого не найдено</div>';
  dd.classList.add('show');
}

function closeManagerDropdown() {
  const dd = document.getElementById('managerDropdown');
  if (dd) dd.classList.remove('show');
}

function onManagerSearchFocus(e) {
  const input = (e && e.target) || document.getElementById('managerSearchInput');
  if (input && input.select) input.select(); // сразу можно печатать поверх подписи
  renderManagerDropdown('');
}

function onManagerSearchInput() {
  closeManagerDropdown();
  renderManagerDropdown((document.getElementById('managerSearchInput') || {}).value || '');
}

// Стрелки и Enter — выбор без мыши.
function onManagerSearchKeydown(e) {
  const dd = document.getElementById('managerDropdown');
  const items = dd ? Array.from(dd.querySelectorAll('.manager-option')) : [];
  if (e.key === 'Escape') { closeManagerDropdown(); return; }
  if (!items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    managerHighlight = e.key === 'ArrowDown'
      ? (managerHighlight + 1) % items.length
      : (managerHighlight - 1 + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('highlight', i === managerHighlight));
    items[managerHighlight].scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const el = items[managerHighlight] || items[0];
    if (el) applyManagerFilter(el.dataset.mvalue, el.dataset.mlabel);
  }
}

// Применить выбранного ответственного и перерисовать список.
function applyManagerFilter(value, label) {
  const input = document.getElementById('managerSearchInput');
  if (input) input.value = label || managerFilterLabel();
  closeManagerDropdown();
  setClientManagerFilter(value);
}

function resetManagerFilter() {
  applyManagerFilter('mine', 'Только мои компании');
}

// Клик по варианту в списке и закрытие списка при клике вне поля.
document.addEventListener('click', (e) => {
  if (!e.target || !e.target.closest) return;
  const opt = e.target.closest('.manager-option');
  if (opt) {
    applyManagerFilter(opt.dataset.mvalue, opt.dataset.mlabel);
    return;
  }
  if (!e.target.closest('#managerPicker')) closeManagerDropdown();
});

function renderClientsTable() {
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const filtered = visibleClientsForFilter().filter(c => searchClient(c, search));

  const wrap = document.getElementById('tableWrap');
  if (!wrap) return;

  if (filtered.length === 0) {
    const visibleAll = visibleClientsForFilter().length;
    wrap.innerHTML = `<div class="empty-state"><p>${visibleAll === 0 ? 'Список клиентов пуст' : 'Ничего не найдено'}</p></div>`;
    return;
  }

  let html = `<table><thead><tr>
    <th>Организация</th><th>Статус</th><th>Тип организации</th><th>Город</th><th>Телефон</th><th>Почта</th><th>Менеджер</th><th>Сайт</th>
  </tr></thead><tbody>`;
  filtered.forEach(c => {
    const phones = (c.orgPhones || '').split(',').map(p => p.trim()).filter(Boolean);
    const emails = (c.orgEmails || '').split(',').map(e => e.trim()).filter(Boolean);
    const site = normalizeSite(c.orgWebsite);
    const st = clientStatusInfo(c);
    const managerName = clientManagerName(c);
    // Страну показываем рядом с городом, только если она не Россия —
    // иначе колонка превращается в шум.
    const otherCountry = (c.orgCountry && c.orgCountry !== DEFAULT_COUNTRY)
      ? (countryName(c.orgCountry) || c.orgCountry)
      : '';
    html += `<tr onclick="selectClient(${c.id})" ondblclick="openClientCard(${c.id})" class="${selectedClientId === c.id ? 'selected' : ''}">
      <td><strong>${escapeHtml(c.orgName)}</strong></td>
      <td><span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:12px;height:12px;background:${st.color};border-radius:2px;display:inline-block;flex-shrink:0;"></span>${escapeHtml(st.label)}</span></td>
      <td>${escapeHtml(c.orgDirection || '—')}</td>
      <td>${escapeHtml(c.orgCity || '—')}${otherCountry ? ` <span style="color:#9ca3af;font-size:11px;">(${escapeHtml(otherCountry)})</span>` : ''}</td>
      <td>${phones.length ? escapeHtml(phones[0]) : '—'}</td>
      <td>${emails.length ? `<a href="mailto:${escapeHtml(emails[0])}" title="Написать на ${escapeHtml(emails[0])}" onclick="event.stopPropagation()">${escapeHtml(emails[0])}</a>` : '—'}</td>
      <td>${escapeHtml(managerName)}</td>
      <td>${site ? `<a href="${site}" target="_blank" rel="noopener" title="${escapeHtml(c.orgWebsite)}" onclick="event.stopPropagation()">${escapeHtml(c.orgWebsite)}</a>` : '—'}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// Экспорт видимого (после фильтра и поиска) списка клиентов в Excel.
// Включает новые поля: статус, направление, почта (кликабельная в таблице,
// здесь — текстом), ФИО менеджера.
function exportClientsExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Библиотека экспорта Excel не загружена.');
    return;
  }
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const rows = visibleClientsForFilter().filter(c => searchClient(c, search)).map(c => {
    const phones = (c.orgPhones || '').split(',').map(p => p.trim()).filter(Boolean);
    const emails = (c.orgEmails || '').split(',').map(e => e.trim()).filter(Boolean);
    const st = clientStatusInfo(c);
    return {
      'Организация': c.orgName || '—',
      'Статус': st.label,
      'Тип организации': c.orgDirection || '—',
      'Страна': countryName(c.orgCountry) || countryName(DEFAULT_COUNTRY),
      'Город': c.orgCity || '—',
      'ИНН': c.orgInn || '—',
      'ОГРН': c.orgOgrn || '—',
      'Телефон': phones.join(', ') || '—',
      'Почта': emails.join(', ') || '—',
      'Менеджер': clientManagerName(c),
      'Сайт': c.orgWebsite || '—'
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Клиенты');
  const today = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `Клиенты_${today}.xlsx`);
}

function selectClient(id) {
  // При переходе к другому клиенту фильтр по контактному лицу сбрасывается.
  if (selectedClientId !== id) selectedContactIdx = null;
  selectedClientId = id;
  historyFilter = 'all';
  renderClientsTable();
  renderClientContacts(id);
}

function renderClientContacts(id) {
  const panel = document.getElementById('contactPanel');
  if (!panel) return;

  const countEl = document.getElementById('contactsCount');
  const addBtn = document.getElementById('contactsAddBtn');

  if (!id) {
    if (countEl) countEl.textContent = '';
    if (addBtn) addBtn.disabled = true;
    panel.innerHTML = `<div class="placeholder"><h2>Выберите клиента</h2><p>Кликните на строку в таблице, чтобы увидеть контактные лица</p></div>`;
    return;
  }

  const client = clients.find(c => c.id === id);
  if (!client) return;

  const contacts = client.contacts || [];
  const editable = canEditClient(client);
  // Индекс мог устареть, если контактное лицо удалили.
  if (selectedContactIdx !== null && !contacts[selectedContactIdx]) selectedContactIdx = null;
  if (countEl) countEl.textContent = contacts.length ? `(${contacts.length})` : '';
  if (addBtn) addBtn.disabled = !editable;

  if (contacts.length === 0) {
    panel.innerHTML = `<div class="empty-state"><p>${editable ? 'Нет контактных лиц.<br>Нажмите «+ Добавить», чтобы создать первое' : 'Нет контактных лиц'}</p></div>
      ${renderHistoryBlock(client, editable)}`;
    return;
  }

  // Список — окно фиксированной высоты: при большом числе контактов
  // появляется вертикальная прокрутка (см. .contact-list.table-body).
  panel.innerHTML = `
    <div class="contact-list table-body">
      <table>
        <thead><tr>
          <th>ФИО</th><th>Должность</th><th>Рабочий тел.</th><th>Сотовый</th><th>Мессенджеры</th><th>Email</th>${editable ? '<th class="col-actions">Действия</th>' : ''}
        </tr></thead>
        <tbody>
          ${contacts.map((ct, idx) => `<tr class="contact-row${selectedContactIdx === idx ? ' selected' : ''}"
              onclick="selectClientContact(${idx})" title="Показать комментарии этого контактного лица">
            <td><strong>${escapeHtml(ct.name || '—')}</strong></td>
            <td>${escapeHtml(ct.position || '—')}</td>
            <td>${escapeHtml(ct.phoneWork || '—')}</td>
            <td>${escapeHtml(ct.phoneMobile || '—')}</td>
            <td>${messengerChipsHtml(ct.messengers)}</td>
            <td>${escapeHtml(ct.email || '—')}</td>
            ${editable ? `<td class="col-actions">
              <button class="btn-icon-btn" onclick="event.stopPropagation(); editClientContact(${id}, ${idx})" title="Редактировать">✏️</button>
              <button class="btn-icon-btn" onclick="event.stopPropagation(); deleteContact(${id}, ${idx})" title="Удалить">🗑️</button>
            </td>` : ''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${renderHistoryBlock(client, editable)}`;
}

/* ===== Мессенджеры контактного лица ===== */

// Плашки мессенджеров в таблице контактов.
function messengerChipsHtml(ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return '<span style="color:#9ca3af;">—</span>';
  return list.map(id => {
    const name = messengerName(id) || id;
    return `<span class="messenger-chip-icon" title="${escapeHtml(name)}">${escapeHtml(messengerShort(id) || name)}</span>`;
  }).join(' ');
}

// Чекбоксы мессенджеров в форме контактного лица.
function messengerCheckboxesHtml(selected) {
  const sel = Array.isArray(selected) ? selected : [];
  return MESSENGERS.map(m => `
    <label class="messenger-chip">
      <input type="checkbox" value="${m.id}"${sel.indexOf(m.id) > -1 ? ' checked' : ''}>
      <span class="messenger-chip-icon">${escapeHtml(m.short)}</span>
      <span>${escapeHtml(m.name)}</span>
    </label>`).join('');
}

function readMessengerCheckboxes(containerId) {
  const box = document.getElementById(containerId);
  if (!box || !box.querySelectorAll) return [];
  return Array.from(box.querySelectorAll('input[type=checkbox]'))
    .filter(cb => cb.checked)
    .map(cb => cb.value);
}

/* ===== Выбор контактного лица для фильтра комментариев ===== */

// Имя выбранного контактного лица (null — фильтр не задан).
function selectedContactName(client) {
  if (selectedContactIdx === null || !client) return null;
  const ct = (client.contacts || [])[selectedContactIdx];
  return ct && ct.name ? ct.name : null;
}

// Клик по строке: показываем комментарии только этого человека.
// Повторный клик по той же строке снимает фильтр.
function selectClientContact(idx) {
  selectedContactIdx = (selectedContactIdx === idx) ? null : idx;
  renderClientContacts(selectedClientId);
}

function clearContactHistoryFilter() {
  selectedContactIdx = null;
  renderClientContacts(selectedClientId);
}

// Одна запись истории — используется и в блоке контактов, и в окне всей истории.
function historyEntryHtml(h) {
  return `
    <div class="history-entry">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <span style="font-size:11px;color:#9ca3af;">${formatDate(h.date)}</span>
        <span class="badge">${escapeHtml(h.type)}</span>
      </div>
      <div class="history-comment">${escapeHtml(h.comment)}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;">
        ${escapeHtml(h.manager || '')}${h.contactPerson ? ' · ' + escapeHtml(h.contactPerson) : ''}
      </div>
    </div>
  `;
}

// Блок «История взаимодействий» под списком контактных лиц.
// Если контактное лицо выбрано — показываем только его комментарии.
function renderHistoryBlock(client, editable) {
  const all = [...(client.history || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const person = selectedContactName(client);
  const history = person ? all.filter(h => (h.contactPerson || '') === person) : all;

  const filterHint = person
    ? `<div class="history-filter-hint">Показаны комментарии: <strong>${escapeHtml(person)}</strong>
         <button type="button" class="link-btn" onclick="clearContactHistoryFilter()">показать все</button></div>`
    : '';

  return `
    <div class="client-history-section">
      <div class="section-header">
        <h3>История взаимодействий (${history.length}${person ? ' из ' + all.length : ''})</h3>
        <div class="history-actions">
          <button class="btn btn-sm btn-secondary" onclick="openAllHistoryModal(${client.id})">Вся история взаимодействий</button>
          ${editable !== false ? `<button class="btn btn-sm" onclick="openHistoryModal(${client.id})">+ Добавить</button>` : ''}
        </div>
      </div>
      ${filterHint}
      ${history.length === 0
        ? `<p style="color:#9ca3af;font-size:12px;padding:10px 0">${person ? 'У этого контактного лица нет комментариев' : 'Нет записей'}</p>`
        : `<div class="history-scroll">${history.map(historyEntryHtml).join('')}</div>`}
    </div>
  `;
}

// Окно со всеми комментариями по клиенту — от текущей даты к самой первой записи.
function openAllHistoryModal(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  const content = document.getElementById('allHistoryContent');
  if (!content) return;

  const all = [...(client.history || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const title = document.getElementById('allHistoryTitle');
  if (title) title.textContent = 'Вся история взаимодействий — ' + (client.orgName || '');

  content.innerHTML = `
    <div style="font-size:12px;color:#6b7280;margin-bottom:12px;">
      Всего записей: <strong>${all.length}</strong> · от новых к старым
    </div>
    ${all.length === 0 ? '<div class="empty-state" style="padding:40px 20px;"><p>Комментариев пока нет</p></div>' : `
      <div class="scrollable-table">
        <div class="table-body" style="max-height:60vh;">
          <table>
            <thead><tr>
              <th style="width:120px">Дата</th><th style="width:140px">Тип взаимодействия</th>
              <th style="width:160px">Контактное лицо</th><th style="width:110px">Менеджер</th><th>Комментарий</th>
            </tr></thead>
            <tbody>
              ${all.map(h => `<tr style="cursor:default;">
                <td>${formatDate(h.date)}</td>
                <td><span class="badge">${escapeHtml(h.type)}</span></td>
                <td>${escapeHtml(h.contactPerson || '—')}</td>
                <td>${escapeHtml(h.manager || '—')}</td>
                <td><div class="history-comment">${escapeHtml(h.comment)}</div></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`}
  `;
  const modal = document.getElementById('allHistoryModal');
  if (modal) modal.classList.add('active');
}

function openClientCard(id) {
  selectedClientId = id;
  cardClientId = id;
  historyFilter = 'all';
  renderClientsTable();
  renderClientContacts(id);
  renderClientCard(id);
  const modal = document.getElementById('clientCardModal');
  if (modal) modal.classList.add('active');
}

// Карточка просмотра: информация сгруппирована в блоки с рамками,
// чтобы реквизиты, контакты и история читались отдельно друг от друга.
function renderClientCard(id) {
  const content = document.getElementById('clientCardContent');
  if (!content) return;

  const client = clients.find(c => c.id === id);
  if (!client) return;

  const history = client.history || [];
  const phones = (client.orgPhones || '').split(',').map(p => p.trim()).filter(Boolean);
  const emails = (client.orgEmails || '').split(',').map(e => e.trim()).filter(Boolean);
  const site = normalizeSite(client.orgWebsite);
  const editable = canEditClient(client);
  const st = clientStatusInfo(client);
  const managerName = clientManagerName(client);
  const country = countryName(client.orgCountry) || countryName(DEFAULT_COUNTRY);

  const filteredHistory = historyFilter === 'all' ? history : history.filter(h => h.contactPerson === historyFilter);
  const sortedHistory = [...filteredHistory].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Одно поле карточки: подпись сверху, значение снизу.
  const field = (label, value, mono) =>
    `<div class="cc-item">
       <div class="cc-label">${escapeHtml(label)}</div>
       <div class="cc-value${mono ? ' mono' : ''}">${value || '—'}</div>
     </div>`;

  const html = `
    <div class="client-card">
      <div class="cc-head">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div style="min-width:0;">
            <div class="cc-title">${escapeHtml(client.orgName || '—')}</div>
            <div class="cc-sub">
              <span class="cc-status"><span class="cc-status-dot" style="background:${st.color};"></span>${escapeHtml(st.label)}</span>
              <span class="cc-sep">|</span>
              <span>ID: ${client.id}</span>
              <span class="cc-sep">|</span>
              <span>Менеджер: <strong>${escapeHtml(managerName)}</strong></span>
            </div>
          </div>
          <div class="cc-actions">
            <button class="btn btn-sm btn-secondary" onclick="openTaskModalWithClient(${client.id})">+ Задача</button>
            <button class="btn btn-sm btn-secondary" onclick="openReminderModal(null, ${client.id})">+ Напоминание</button>
          </div>
        </div>
      </div>

      <div class="cc-block">
        <div class="cc-block-head">
          <h3>Реквизиты организации</h3>
          ${editable ? `<button class="btn btn-sm btn-secondary" onclick="openClientModal(clients.find(c=>c.id===${client.id}))">Редактировать</button>` : ''}
        </div>
        <div class="cc-block-body">
          <div class="cc-grid">
            ${field('Страна', escapeHtml(country))}
            ${field('Город', escapeHtml(client.orgCity || ''))}
            ${field('Тип организации', escapeHtml(client.orgDirection || ''))}
            ${field('Адрес', escapeHtml(client.orgAddress || ''))}
            ${field('ИНН', escapeHtml(client.orgInn || ''), true)}
            ${field('ОГРН', escapeHtml(client.orgOgrn || ''), true)}
            ${field('Сайт', site ? `<a href="${site}" target="_blank" rel="noopener">${escapeHtml(client.orgWebsite)}</a>` : '')}
          </div>
        </div>
      </div>

      <div class="cc-block">
        <div class="cc-block-head"><h3>Контакты</h3></div>
        <div class="cc-block-body">
          <div class="cc-grid">
            ${field('Телефоны', phones.length ? phones.map(escapeHtml).join(', ') : '')}
            ${field('Электронная почта', emails.length
              ? emails.map(e => `<a href="mailto:${escapeHtml(e)}" title="Написать на ${escapeHtml(e)}">${escapeHtml(e)}</a>`).join(', ')
              : '')}
          </div>
        </div>
      </div>

      <div class="cc-block">
        <div class="cc-block-head">
          <h3>История взаимодействий <span class="cc-count">${sortedHistory.length}</span></h3>
          <div style="display:flex;gap:8px;align-items:center;">
            <select onchange="changeHistoryFilter(this.value)" style="padding:5px 9px;border:1px solid #d0d5dd;border-radius:5px;font-size:12px;outline:none;">
              <option value="all" ${historyFilter === 'all' ? 'selected' : ''}>Все контакты</option>
              ${historyContacts(client).map(ct => `<option value="${escapeHtml(ct)}" ${historyFilter === ct ? 'selected' : ''}>${escapeHtml(ct)}</option>`).join('')}
            </select>
            ${editable ? `<button class="btn btn-sm" onclick="openHistoryModal(${client.id})">+ Добавить</button>` : ''}
          </div>
        </div>
        <div class="cc-block-body flush">
          ${sortedHistory.length === 0
            ? '<div class="cc-empty" style="padding:14px 16px;">Нет записей</div>'
            : `<div class="scrollable-table" style="border:none;border-radius:0;">
            <div class="table-body" style="max-height:300px;">
              <table>
                <thead><tr>
                  <th style="width:110px">Дата</th><th style="width:130px">Тип</th><th style="width:150px">Контакт</th><th style="width:120px">Менеджер</th><th>Комментарий</th>
                </tr></thead>
                <tbody>
                  ${sortedHistory.map(h => `<tr style="cursor:default;">
                    <td>${formatDate(h.date)}</td>
                    <td><span class="badge">${escapeHtml(h.type)}</span></td>
                    <td>${escapeHtml(h.contactPerson || '—')}</td>
                    <td>${escapeHtml(h.manager || '—')}</td>
                    <td><div class="history-comment">${escapeHtml(h.comment)}</div></td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>`}
        </div>
      </div>
    </div>`;
  content.innerHTML = html;
}

function historyContacts(client) {
  return [...new Set((client.history || []).map(h => h.contactPerson).filter(Boolean))];
}

function changeHistoryFilter(value) { historyFilter = value; renderClientCard(cardClientId || selectedClientId); }

function openClientModal(client = null) {
  // Форма заменяет карточку, а не открывается поверх неё: иначе карточка
  // с блоком истории остаётся видна за формой и мешает работать.
  const cardEl = document.getElementById('clientCardModal');
  const cardActive = !!(cardEl && cardEl.classList.contains('active'));
  editReturnToCardId = (client && client.id && cardActive) ? client.id : null;
  if (cardActive) closeModal('clientCardModal');

  document.getElementById('clientModalTitle').textContent = client ? 'Редактировать клиента' : 'Новый клиент';
  document.getElementById('clientId').value = client?.id || '';
  document.getElementById('orgName').value = client?.orgName || '';

  // Страна: список формируется из справочника js/geo.js, выбранное значение
  // определяет, по каким городам искать подсказки.
  const countrySelect = document.getElementById('orgCountry');
  countrySelect.innerHTML = countryOptionsHtml(client?.orgCountry);
  countrySelect.value = (client?.orgCountry && countryExists(client.orgCountry))
    ? client.orgCountry
    : DEFAULT_COUNTRY;

  document.getElementById('orgCity').value = client?.orgCity || '';
  document.getElementById('orgDirection').value = client?.orgDirection || '';
  document.getElementById('orgAddress').value = client?.orgAddress || '';
  document.getElementById('orgPhones').value = client?.orgPhones || '';
  document.getElementById('orgStatus').value = client?.orgStatus || 'cooperation';
  document.getElementById('orgEmails').value = client?.orgEmails || '';
  document.getElementById('orgWebsite').value = client?.orgWebsite || '';
  document.getElementById('orgInn').value = client?.orgInn || '';
  document.getElementById('orgOgrn').value = client?.orgOgrn || '';

  hideCitySuggestions();
  setInnStatus('');
  document.getElementById('clientModal').classList.add('active');
}

function saveClient(e) {
  e.preventDefault();
  const id = document.getElementById('clientId').value;
  // Поля «Основного контакта» больше не собираются: блок удалён из формы,
  // а старые ключи вычищаются из записи при сохранении.
  const data = {
    orgName: document.getElementById('orgName').value.trim(),
    orgCountry: document.getElementById('orgCountry').value || DEFAULT_COUNTRY,
    orgCity: document.getElementById('orgCity').value.trim(),
    orgDirection: document.getElementById('orgDirection').value.trim(),
    orgAddress: document.getElementById('orgAddress').value.trim(),
    orgPhones: document.getElementById('orgPhones').value.trim(),
    orgStatus: document.getElementById('orgStatus').value || 'cooperation',
    orgEmails: document.getElementById('orgEmails').value.trim(),
    orgWebsite: document.getElementById('orgWebsite').value.trim(),
    orgInn: document.getElementById('orgInn').value.trim(),
    orgOgrn: document.getElementById('orgOgrn').value.trim()
  };

  if (id) {
    const idx = clients.findIndex(c => c.id === parseInt(id));
    if (idx !== -1) {
      if (!canEditClient(clients[idx])) {
        alert('Редактировать компанию может только пользователь, который её создал.');
        return;
      }
      data.id = clients[idx].id;
      data.contacts = clients[idx].contacts || [];
      data.history = clients[idx].history || [];
      data.createdBy = clients[idx].createdBy; // владелец не меняется
      clients[idx] = data;
    }
  } else {
    const maxId = clients.reduce((m, c) => Math.max(m, c.id || 0), 0);
    data.id = maxId + 1;
    data.contacts = [];
    data.history = [];
    data.createdBy = currentUser ? currentUser.id : null; // компанию создаёт текущий пользователь
    clients.push(data);
  }
  saveClients(clients);
  hideCitySuggestions();
  closeModal('clientModal');
  renderClientsTable();
  if (selectedClientId) renderClientContacts(selectedClientId);
  // Форму открывали из карточки — возвращаем пользователя в неё с новыми данными.
  returnToClientCard();
}

// Отмена редактирования: закрываем форму и возвращаемся в карточку просмотра.
function cancelClientEdit() {
  hideCitySuggestions();
  closeModal('clientModal');
  returnToClientCard();
}

// Вернуть пользователя в карточку просмотра, если форма открывалась из неё.
function returnToClientCard() {
  const id = editReturnToCardId;
  editReturnToCardId = null;
  if (id) openClientCard(id);
}

function openContactModal(clientId) {
  if (!clientId) { alert('Сначала выберите клиента'); return; }
  document.getElementById('contactClientId').value = clientId;
  document.getElementById('contactModalTitle').textContent = 'Добавить контактное лицо';
  document.getElementById('editContactIdx').value = '';
  document.getElementById('newContactName').value = '';
  document.getElementById('newContactPosition').value = '';
  document.getElementById('newContactPhoneWork').value = '';
  document.getElementById('newContactPhoneMobile').value = '';
  document.getElementById('newContactEmail').value = '';
  document.getElementById('newContactMessengers').innerHTML = messengerCheckboxesHtml([]);
  document.getElementById('contactModal').classList.add('active');
}

function editClientContact(clientId, idx) {
  const client = clients.find(c => c.id === clientId);
  if (!client || !client.contacts[idx]) return;
  const ct = client.contacts[idx];
  document.getElementById('contactClientId').value = clientId;
  document.getElementById('contactModalTitle').textContent = 'Редактировать контактное лицо';
  document.getElementById('editContactIdx').value = idx;
  document.getElementById('newContactName').value = ct.name || '';
  document.getElementById('newContactPosition').value = ct.position || '';
  document.getElementById('newContactPhoneWork').value = ct.phoneWork || '';
  document.getElementById('newContactPhoneMobile').value = ct.phoneMobile || '';
  document.getElementById('newContactEmail').value = ct.email || '';
  document.getElementById('newContactMessengers').innerHTML = messengerCheckboxesHtml(ct.messengers);
  document.getElementById('contactModal').classList.add('active');
}

function saveContact(e) {
  e.preventDefault();
  const clientId = parseInt(document.getElementById('contactClientId').value);
  const editIdx = document.getElementById('editContactIdx').value;
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  if (!canEditClient(client)) {
    alert('Добавлять и изменять контактные лица может только владелец компании.');
    return;
  }
  if (!client.contacts) client.contacts = [];
  
  const contactData = {
    name: document.getElementById('newContactName').value.trim(),
    position: document.getElementById('newContactPosition').value.trim(),
    phoneWork: document.getElementById('newContactPhoneWork').value.trim(),
    phoneMobile: document.getElementById('newContactPhoneMobile').value.trim(),
    email: document.getElementById('newContactEmail').value.trim(),
    messengers: readMessengerCheckboxes('newContactMessengers')
  };

  // Должность пополняет общий справочник — её увидят все менеджеры.
  if (contactData.position) dictAdd('positions', contactData.position);
  
  if (editIdx !== '') {
    client.contacts[parseInt(editIdx)] = contactData;
  } else {
    client.contacts.push(contactData);
  }
  
  saveClients(clients);
  closeModal('contactModal');
  renderClientContacts(clientId);
}

function deleteContact(clientId, idx) {
  if (!confirm('Удалить контактное лицо?')) return;
  const client = clients.find(c => c.id === clientId);
  if (!client || !canEditClient(client)) {
    alert('Удалять контактные лица может только владелец компании.');
    return;
  }
  client.contacts.splice(idx, 1);
  saveClients(clients);
  renderClientContacts(clientId);
}

function openHistoryModal(clientId) {
  document.getElementById('historyClientId').value = clientId;
  const client = clients.find(c => c.id === clientId);
  const select = document.getElementById('historyContactPerson');
  select.innerHTML = '<option value="">—</option>';
  if (client && client.contacts) {
    client.contacts.forEach(ct => {
      const opt = document.createElement('option');
      opt.value = ct.name; opt.textContent = ct.name || '—';
      select.appendChild(opt);
    });
  }
  // Типы взаимодействий — только из справочника администратора.
  const typeSelect = document.getElementById('historyType');
  const types = (interactionTypes && interactionTypes.length) ? interactionTypes : ['Звонок'];
  typeSelect.innerHTML = types.map(t => `<option>${escapeHtml(t)}</option>`).join('');
  // Сбрасываем состояние формы заказа («Размещение заказа»).
  resetOrderForm();
  onHistoryTypeChange();
  // Менеджер — всегда тот, кто оставил комментарий (текущий пользователь),
  // поэтому поле в модалке не показываем и проставляем автоматически при сохранении.
  document.getElementById('historyModal').classList.add('active');
}

/* ===== Форма заказа в комментарии =====
   Порядок заполнения: кол-во кг и общая стоимость заказа, а стоимость за кг
   считается автоматически: Стоимость_кг = Общая_стоимость / Кол-во_кг. */

// Тип считается «заказным», если в названии есть «заказ»: так работают
// и «Размещение заказа», и созданный в справочнике тип «Заказ».
function isOrderType(type) {
  return /заказ/i.test(String(type || ''));
}

// Стоимость за килограмм. null, если данных не хватает: нулевой вес или
// незаполненная (нулевая) сумма — тогда в форме показываем «—», а не 0.
function orderPricePerKg(kg, cost) {
  const k = Number(kg);
  const c = Number(cost);
  if (!k || !c || !isFinite(k) || !isFinite(c)) return null;
  return Math.round((c / k) * 100) / 100;
}

// Состояния поставки из справочного списка. Значение из старой записи,
// которого нет в списке, добавляется отдельным пунктом — чтобы не потерялось.
function renderOrderConditions(current) {
  const select = document.getElementById('orderCondition');
  if (!select) return;
  const list = ORDER_CONDITIONS.slice();
  const value = String(current || '').trim();
  if (value && list.indexOf(value) === -1) list.push(value);
  select.innerHTML = '<option value="">—</option>' +
    list.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  select.value = value;
}

function resetOrderForm() {
  const kg = document.getElementById('orderKg');
  const cost = document.getElementById('orderCost');
  const price = document.getElementById('orderPricePerKg');
  if (kg) kg.value = '';
  if (cost) cost.value = '';
  if (price) price.value = '';
  renderOrderConditions('');
}

// Показываем блок параметров заказа при выборе «заказного» типа.
function onHistoryTypeChange() {
  const section = document.getElementById('orderFormSection');
  const typeEl = document.getElementById('historyType');
  const isOrder = isOrderType(typeEl ? typeEl.value : '');
  if (section) section.style.display = isOrder ? 'block' : 'none';
  if (isOrder) recalcOrderCost();
}

// Автопересчёт: Стоимость за кг = Общая стоимость / Кол-во кг.
function recalcOrderCost() {
  const kg = document.getElementById('orderKg');
  const cost = document.getElementById('orderCost');
  const priceEl = document.getElementById('orderPricePerKg');
  if (!kg || !cost || !priceEl) return;
  const perKg = orderPricePerKg(kg.value, cost.value);
  priceEl.value = perKg === null ? '' : fmtMoney(perKg);
}

function saveHistory(e) {
  e.preventDefault();
  const clientId = parseInt(document.getElementById('historyClientId').value);
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  if (!canEditClient(client)) {
    alert('Добавлять комментарии может только владелец компании.');
    return;
  }

  const type = document.getElementById('historyType').value;
  let comment = document.getElementById('historyComment').value.trim();
  let orderData = null;

  // Заказ: собираем параметры, формируем текст комментария и создаём
  // запись в модуле «Заказы». Стоимость за кг считаем из суммы и веса.
  if (isOrderType(type)) {
    const conditionEl = document.getElementById('orderCondition');
    const kgRaw = document.getElementById('orderKg').value;
    const costRaw = document.getElementById('orderCost').value;

    const kg = kgRaw === '' ? null : Number(kgRaw);
    const cost = costRaw === '' ? null : Number(costRaw);
    const condition = conditionEl ? conditionEl.value.trim() : '';
    const avgPrice = orderPricePerKg(kg, cost);

    orderData = { kg, condition, avgPrice, cost };

    const parts = [
      'Кол-во кг — ' + (kg === null ? '—' : fmtKg(kg)),
      'Состояние поставки — ' + (condition || '—'),
      'Общая стоимость — ' + (cost === null ? '—' : fmtMoney(cost)),
      'Стоимость за кг — ' + (avgPrice === null ? '—' : fmtMoney(avgPrice))
    ];
    const autoComment = type + ': ' + parts.join(', ');
    comment = comment || autoComment;
  }

  if (!comment) { alert('Заполните комментарий'); return; }
  if (!client.history) client.history = [];

  client.history.push({
    date: new Date().toISOString(),
    type: type,
    contactPerson: document.getElementById('historyContactPerson').value,
    manager: currentUser ? currentUser.login : '',
    comment: comment,
    order: orderData
  });
  saveClients(clients);

  if (orderData) {
    addOrder({
      clientId: client.id,
      clientName: client.orgName,
      kg: orderData.kg,
      condition: orderData.condition,
      avgPrice: orderData.avgPrice,
      cost: orderData.cost,
      date: new Date().toISOString(),
      createdBy: currentUser ? currentUser.id : null,
      comment: comment
    });
  }

  closeModal('historyModal');
  e.target.reset();
  resetOrderForm();
  // Реактивное обновление без перезагрузки страницы: перерисовываем
  // и нижнюю панель контактов (блок «История взаимодействий»), и карточку,
  // если она открыта.
  renderClientContacts(clientId);
  if (document.getElementById('clientCardModal')?.classList.contains('active')) {
    renderClientCard(cardClientId || clientId);
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

function deleteSelectedClient() {
  if (!selectedClientId) { alert('Сначала выберите клиента в таблице'); return; }
  const client = clients.find(c => c.id === selectedClientId);
  if (!client) return;
  // Удалять может только владелец компании (или администратор).
  if (!canEditClient(client)) {
    alert('Удалять компанию может только пользователь, который её создал.');
    return;
  }
  if (!confirm(`Удалить компанию «${client.orgName}»?\nКонтактные лица и история также будут удалены.`)) return;
  clients = clients.filter(c => c.id !== selectedClientId);
  selectedClientId = null;
  cardClientId = null;
  closeModal('clientCardModal');
  saveClients(clients);
  renderClientsTable();
  renderClientContacts(null);
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function openTaskModalWithClient(clientId) {
  document.getElementById('taskModalTitle').textContent = 'Новая задача';
  document.getElementById('taskId').value = '';
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskDescription').value = '';
  document.getElementById('taskDeadline').value = '';
  document.getElementById('taskClientId').value = clientId;
  initTaskClientSearch();

  const prioritySelect = document.getElementById('taskPriority');
  prioritySelect.innerHTML = TASK_PRIORITIES.map(p => 
    `<option value="${p.value}">${p.name}</option>`
  ).join('');
  
  const columnSelect = document.getElementById('taskColumn');
  const sortedCols = [...taskColumns].sort((a, b) => a.order - b.order);
  columnSelect.innerHTML = sortedCols.map(c => 
    `<option value="${c.id}">${escapeHtml(c.name)}</option>`
  ).join('');
  
  const meCheckbox = document.getElementById('taskAssignMe');
  const assigneesSelect = document.getElementById('taskAssignees');
  meCheckbox.checked = false;
  assigneesSelect.innerHTML = contacts.map(c => 
    `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.department || '—')})</option>`
  ).join('');
  
  const client = clients.find(c => c.id === clientId);
  const clientLink = document.getElementById('taskClientLink');
  if (client) {
    clientLink.style.display = 'block';
    clientLink.innerHTML = `🏢 <strong>${escapeHtml(client.orgName)}</strong> <button type="button" onclick="unlinkTaskFromClient()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;margin-left:6px;"> убрать</button>`;
  }
  
  const contactRow = document.getElementById('taskContactRow');
  const contactSelect = document.getElementById('taskContactSelect');
  if (client && client.contacts && client.contacts.length > 0) {
    contactRow.style.display = 'block';
    contactSelect.innerHTML = '<option value="">— Не выбрано —</option>' + 
      client.contacts.map(ct => `<option value="${ct.id}">${escapeHtml(ct.name)}${ct.position ? ' (' + escapeHtml(ct.position) + ')' : ''}</option>`).join('');
  } else {
    contactRow.style.display = 'none';
  }
  
  document.getElementById('taskModal').classList.add('active');
}

/* ===== Умный ввод города =====
   Подсказки зависят от выбранной страны. Источник — Дадата, если она
   настроена; иначе (или при сбое запроса) локальный справочник js/geo.js. */

let citySuggestTimer = null;

function hideCitySuggestions() {
  const dd = document.getElementById('orgCityDropdown');
  if (dd) dd.style.display = 'none';
}

// Задержка 250 мс: не дёргаем сервис на каждую букву.
function onCityInput() {
  clearTimeout(citySuggestTimer);
  hideCitySuggestions();
  citySuggestTimer = setTimeout(runCitySuggestions, 250);
}

async function runCitySuggestions() {
  const input = document.getElementById('orgCity');
  const dd = document.getElementById('orgCityDropdown');
  if (!input || !dd) return;

  const query = input.value.trim();
  if (query.length < 2) return;

  const countrySelect = document.getElementById('orgCountry');
  const country = (countrySelect && countrySelect.value) || DEFAULT_COUNTRY;
  const res = await citySuggestions(query, country, 10);

  // Пока шёл запрос, пользователь мог стереть текст.
  if (input.value.trim() !== query) return;

  if (!res.items.length) {
    dd.innerHTML = '<div class="manager-option-empty">Города не найдены</div>';
    dd.style.display = 'block';
    return;
  }
  dd.innerHTML = res.items.map(name =>
    `<div class="client-typeahead-item" data-city="${escapeHtml(name)}">${escapeHtml(name)}</div>`
  ).join('') + `<div class="client-typeahead-source">${
    res.source === 'dadata' ? 'Источник: Дадата' : 'Источник: встроенный справочник'
  }</div>`;
  dd.style.display = 'block';
}

function selectCity(name) {
  const input = document.getElementById('orgCity');
  if (input) input.value = name;
  hideCitySuggestions();
}

// Список городов привязан к стране — при её смене пересчитываем подсказки.
function onCountryChange() {
  hideCitySuggestions();
  const input = document.getElementById('orgCity');
  if (input && input.value.trim().length >= 2) runCitySuggestions();
}

/* ===== Автозаполнение реквизитов по ИНН ===== */

function setInnStatus(text, kind) {
  const el = document.getElementById('clientInnStatus');
  if (!el) return;
  if (!text) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.style.background = kind === 'error' ? '#fee2e2' : (kind === 'ok' ? '#d1fae5' : '#f9fafb');
  el.style.color = kind === 'error' ? '#991b1b' : (kind === 'ok' ? '#065f46' : '#6b7280');
  el.textContent = text;
}

// Заполнение названия, адреса, ИНН, ОГРН, города и страны по ИНН/ОГРН.
async function fillClientByInn() {
  const innInput = document.getElementById('orgInn');
  if (!innInput) return;

  const inn = innInput.value.replace(/\D/g, '');
  if (!/^(\d{10}|\d{12}|\d{13}|\d{15})$/.test(inn)) {
    setInnStatus('Укажите ИНН (10 цифр) или ОГРН (13 или 15 цифр)', 'error');
    return;
  }

  const status = await dadataStatus();
  if (!status.configured) {
    setInnStatus(DADATA_NOT_CONFIGURED, 'error');
    return;
  }

  setInnStatus('Ищу организацию…');
  const res = await fetchPartyByInn(inn);
  if (!res.ok) {
    setInnStatus(res.notConfigured ? DADATA_NOT_CONFIGURED : 'Не удалось получить данные: ' + res.error, 'error');
    return;
  }
  const p = res.party;
  if (!p) {
    setInnStatus('Организация с таким ИНН/ОГРН не найдена', 'error');
    return;
  }

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el && value) el.value = value;
  };
  set('orgName', p.name);
  set('orgAddress', p.address);
  set('orgInn', p.inn);
  set('orgOgrn', p.ogrn);
  if (p.city) set('orgCity', p.city);
  if (p.country && countryExists(p.country)) document.getElementById('orgCountry').value = p.country;

  // Телефоны и почту не перетираем: если их уже вводили вручную — оставляем.
  const phonesEl = document.getElementById('orgPhones');
  if (p.phones.length && phonesEl && !phonesEl.value.trim()) phonesEl.value = p.phones.join(', ');
  const emailsEl = document.getElementById('orgEmails');
  if (p.emails.length && emailsEl && !emailsEl.value.trim()) emailsEl.value = p.emails.join(', ');

  hideCitySuggestions();

  const bits = [];
  if (p.fullName) bits.push(p.fullName);
  if (p.management) bits.push('Руководитель: ' + p.management);
  if (p.status) bits.push('Статус в ЕГРЮЛ: ' + p.status);
  setInnStatus('Реквизиты заполнены.' + (bits.length ? ' ' + bits.join(' · ') : ''), 'ok');
}

/* ===== Совместимость со старыми записями =====
   Блок «Основной контакт» удалён из формы как неиспользуемый, а ИНН и ОГРН
   теперь хранятся раздельно. Приводим ранее сохранённые карточки к новой
   структуре один раз — при загрузке и после синхронизации с сервером. */

const LEGACY_CONTACT_FIELDS = [
  'contactName', 'contactPosition', 'contactPhoneWork', 'contactPhoneMobile', 'contactEmail'
];

function migrateLegacyClientData() {
  let changed = false;

  clients.forEach(c => {
    LEGACY_CONTACT_FIELDS.forEach(f => {
      if (Object.prototype.hasOwnProperty.call(c, f)) {
        delete c[f];
        changed = true;
      }
    });

    if (!c.orgCountry) {
      c.orgCountry = DEFAULT_COUNTRY;
      changed = true;
    } else if (!countryExists(c.orgCountry)) {
      // На случай, если страна была сохранена названием, а не кодом.
      const byName = COUNTRIES.find(x => x.name.toLowerCase() === String(c.orgCountry).trim().toLowerCase());
      if (byName) {
        c.orgCountry = byName.code;
        changed = true;
      }
    }

    // Склеенные реквизиты вида «7712345678 / 1234567890123» разбираем:
    // ИНН остаётся в своём поле, ОГРН уходит в отдельное.
    if (!c.orgOgrn && typeof c.orgInn === 'string' && /[/,;]/.test(c.orgInn)) {
      const parts = c.orgInn.split(/[/,;]/).map(s => s.trim()).filter(Boolean);
      const ogrnPart = parts.find(p => /^(\d{13}|\d{15})$/.test(p.replace(/\D/g, '')));
      if (ogrnPart) {
        const innPart = parts.find(p => p !== ogrnPart) || '';
        c.orgInn = innPart.replace(/\D/g, '');
        c.orgOgrn = ogrnPart.replace(/\D/g, '');
        changed = true;
      }
    }
  });

  if (changed) saveClients(clients);
  return changed;
}

// Клик по подсказке города (общий делегированный обработчик в js/app.js
// передаёт сюда выбор элемента списка).
document.addEventListener('click', (e) => {
  if (!e.target || !e.target.closest) return;
  const item = e.target.closest('#orgCityDropdown .client-typeahead-item');
  if (item && item.dataset.city) selectCity(item.dataset.city);
});
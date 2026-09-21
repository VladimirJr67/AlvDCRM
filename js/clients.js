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

// Права на редактирование самой карточки компании: владелец (создатель)
// плюс администратор. Остальные — только чтение.
function canWriteToClient(client) {
  if (!currentUser) return false;
  if (isAdmin()) return true;
  return !!client && client.createdBy === currentUser.id;
}

// Синоним: раньше по коду использовалось canEditClient, теперь единая
// точка входа — canWriteToClient.
function canEditClient(client) {
  return canWriteToClient(client);
}

// Контактные лица — полная зона менеджера: добавление, правка и удаление
// доступны любому пользователю. Ограничения менеджера касаются только
// удаления самого клиента и импорта/шаблона/экспорта.
function canManageContacts() {
  return !!currentUser;
}

function canAddContact() {
  return canManageContacts();
}

// Комментарий может править его автор или администратор.
function canEditComment(entry) {
  if (!currentUser || !entry) return false;
  if (isAdmin()) return true;
  return entry.authorId ? entry.authorId === currentUser.id : entry.manager === currentUser.login;
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

// Поиск по всем полям карточки клиента, включая ID старой базы:
// по нему клиента находят в первую очередь при переходе с прежней системы.
function searchClient(c, q) {
  if (!q) return true;
  const fields = [
    c.orgName, c.orgCity, c.orgDirection, c.orgAddress,
    c.orgPhones, c.orgEmails, c.orgWebsite, c.orgInn, c.orgOgrn,
    c.oldBaseId
  ];
  return fields.some(f => String(f == null ? '' : f).toLowerCase().includes(q));
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
      <td><strong>${escapeHtml(c.orgName)}</strong>${clientReminderDotHtml(c.id)}</td>
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
  // Добавлять контактные лица может только владелец клиента или администратор;
  // правка и удаление — как раньше (см. canManageContacts).
  const canAdd = canWriteToClient(client);
  const canManage = canManageContacts();
  const editable = canWriteToClient(client);
  // Индекс мог устареть, если контактное лицо удалили.
  if (selectedContactIdx !== null && !contacts[selectedContactIdx]) selectedContactIdx = null;
  if (countEl) countEl.textContent = contacts.length ? `(${contacts.length})` : '';
  if (addBtn) addBtn.disabled = !canAdd;
  updateClientNotesCount(client);
  if (typeof updateClientMatricesCount === 'function') updateClientMatricesCount(client.id);

  if (contacts.length === 0) {
    panel.innerHTML = `<div class="empty-state"><p>${canAdd ? 'Нет контактных лиц.<br>Нажмите «+ Добавить», чтобы создать первое' : 'Нет контактных лиц'}</p></div>
      ${renderHistoryBlock(client, editable)}`;
    return;
  }

  // Список — окно фиксированной высоты: при большом числе контактов
  // появляется вертикальная прокрутка (см. .contact-list.table-body).
  panel.innerHTML = `
    <div class="contact-list table-body">
      <table>
        <thead><tr>
          <th>ФИО</th><th>Должность</th><th>Рабочий тел.</th><th>Сотовый</th><th>Мессенджеры</th><th>Email</th>${canManage ? '<th class="col-actions">Действия</th>' : ''}
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
            ${canManage ? `<td class="col-actions">
              <button class="btn-icon-btn" onclick="event.stopPropagation(); editClientContact(${id}, ${idx})" title="Редактировать">Изменить</button>
              <button class="btn-icon-btn" onclick="event.stopPropagation(); deleteContact(${id}, ${idx})" title="Удалить">Удалить</button>
            </td>` : ''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${renderHistoryBlock(client, editable)}`;
}

// Счётчик комментариев на кнопке «Особые отметки».
function updateClientNotesCount(client) {
  const el = document.getElementById('notesCount');
  if (!el) return;
  const count = client ? (client.history || []).length : 0;
  el.textContent = count ? `(${count})` : '';
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

// Метки комментария. «Для себя» — личная пометка, «Для отчёта» — попадает
// в отчётность администратора. Канонические коды — forSelf / forReport;
// старые значения self / report из прежних баз приводятся к ним.
const COMMENT_TAGS = [
  { key: 'forSelf', label: 'Для себя', color: '#6b7280' },
  { key: 'forReport', label: 'Для отчёта', color: '#1d4ed8' }
];

const COMMENT_TAG_ALIASES = {
  self: 'forSelf', forself: 'forSelf', for_self: 'forSelf',
  report: 'forReport', forreport: 'forReport', for_report: 'forReport'
};

function normalizeCommentTag(key) {
  const raw = String(key == null ? '' : key).trim();
  if (!raw) return '';
  return COMMENT_TAG_ALIASES[raw.toLowerCase()] || raw;
}

function commentTagsList(tags) {
  const list = Array.isArray(tags) ? tags : [];
  return list.map(normalizeCommentTag).filter(k => COMMENT_TAGS.some(t => t.key === k));
}

function commentTagsHtml(tags) {
  const list = commentTagsList(tags);
  if (!list.length) return '';
  return list.map(key => {
    const t = COMMENT_TAGS.find(x => x.key === key);
    if (!t) return '';
    return `<span class="comment-tag" style="background:${t.color}1f;color:${t.color};">${escapeHtml(t.label)}</span>`;
  }).join(' ');
}

function commentTagLabels(tags) {
  const list = commentTagsList(tags);
  return list.map(key => {
    const t = COMMENT_TAGS.find(x => x.key === key);
    return t ? t.label : key;
  }).join(', ');
}

// Одна запись истории — используется в блоке контактов, окне всей истории
// и в «Особых отметках». opts: { clientId, idx, canEdit } — чтобы автор
// или администратор могли поправить комментарий прямо здесь.
function historyEntryHtml(h, opts) {
  const o = opts || {};
  const editBtn = o.canEdit
    ? `<button type="button" class="btn-icon-btn" onclick="openHistoryModal(${o.clientId}, ${o.idx})" title="Редактировать комментарий">Изменить</button>`
    : '';
  return `
    <div class="history-entry">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;color:#9ca3af;">${formatDate(h.date)}${h.editedAt ? ' · изменено' : ''}</span>
        <span class="badge">${escapeHtml(h.type)}</span>
        <span style="flex:1 1 auto;"></span>
        ${editBtn}
      </div>
      <div class="history-comment">${escapeHtml(h.comment)}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;">
        ${escapeHtml(h.manager || '')}${h.contactPerson ? ' · ' + escapeHtml(h.contactPerson) : ''}
      </div>
      ${activityStatusHtml(h)}
      ${h.tags && h.tags.length ? `<div class="comment-tags">${commentTagsHtml(h.tags)}</div>` : ''}
    </div>
  `;
}

// Блок «История взаимодействий» под списком контактных лиц.
// Если контактное лицо выбрано — показываем только его комментарии.
// Комментарии может добавлять любой пользователь, поэтому кнопка «+ Добавить»
// показывается всем, у кого есть доступ к карточке.
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
          ${editable ? `<button class="btn btn-sm" onclick="openHistoryModal(${client.id})">+ Добавить</button>` : ''}
        </div>
      </div>
      ${filterHint}
      ${history.length === 0
        ? `<p style="color:#9ca3af;font-size:12px;padding:10px 0">${person ? 'У этого контактного лица нет комментариев' : 'Нет записей'}</p>`
        : `<div class="history-scroll">${history.map(h => historyEntryHtml(h, {
            clientId: client.id,
            idx: (client.history || []).indexOf(h),
            canEdit: canEditComment(h)
          })).join('')}</div>`}
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
              <th style="width:160px">Контактное лицо</th><th style="width:110px">Менеджер</th><th>Комментарий</th><th style="width:50px;text-align:right;">Правка</th>
            </tr></thead>
            <tbody>
              ${all.map(h => {
                const idx = (client.history || []).indexOf(h);
                return `<tr style="cursor:default;">
                  <td>${formatDate(h.date)}${h.editedAt ? ' · изменено' : ''}</td>
                  <td><span class="badge">${escapeHtml(h.type)}</span></td>
                  <td>${escapeHtml(h.contactPerson || '—')}</td>
                  <td>${escapeHtml(h.manager || '—')}</td>
                  <td><div class="history-comment">${escapeHtml(h.comment)}</div></td>
                  <td style="text-align:right;">
                    ${canEditComment(h)
                      ? `<button class="btn-icon-btn" onclick="editCommentFromHistory(${client.id}, ${idx})" title="Редактировать комментарий">Изменить</button>`
                      : ''}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`}
  `;
  const modal = document.getElementById('allHistoryModal');
  if (modal) modal.classList.add('active');
}

// Правка комментария из окна «Вся история»: закрываем список и открываем
// форму редактирования — иначе она оказалась бы под этим окном.
function editCommentFromHistory(clientId, idx) {
  closeModal('allHistoryModal');
  openHistoryModal(clientId, idx);
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
  const canWrite = canWriteToClient(client);
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
              ${clientReminderBadgeHtml(client.id)}
            </div>
          </div>
          ${canWrite ? `
          <div class="cc-actions">
            <button class="btn btn-sm btn-secondary" onclick="openTaskModalWithClient(${client.id})">+ Задача</button>
            <button class="btn btn-sm btn-secondary" onclick="openCardReminderModal(${client.id})">+ Напоминание</button>
            <button class="btn btn-sm btn-secondary" onclick="openClientNotes(${client.id})">Особые отметки</button>
          </div>` : ''}
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
            ${client.oldBaseId ? field('ID старой базы', escapeHtml(client.oldBaseId), true) : ''}
            ${field('Сайт', site ? `<a href="${site}" target="_blank" rel="noopener">${escapeHtml(client.orgWebsite)}</a>` : '')}
          </div>
        </div>
      </div>

      ${(isAdmin() || (!canWrite && isManagerRole(currentUser))) ? `
      <div class="cc-block">
        <div class="cc-block-head"><h3>Ответственный менеджер</h3></div>
        <div class="cc-block-body">
          ${pendingTransferHtml(client)}
          <div class="card-transfer">
            ${isAdmin()
              ? `<select id="cardOwnerSelect" title="Менеджер, которому передаём клиента">${clientOwnerOptions(client.createdBy)}</select>
                 <input type="text" id="cardTransferComment" placeholder="Комментарий менеджеру (необязательно)">
                 <button type="button" class="btn btn-sm btn-secondary" onclick="requestClientTransferFromCard()">Отправить запрос</button>
                 <button type="button" class="btn btn-sm" onclick="applyClientTransfer()">Передать сразу</button>`
              : `<button type="button" class="btn btn-sm" onclick="openTransferRequestModal(${client.id})">Запрос на перенос</button>`}
          </div>
          <div class="field-hint">
            Сейчас: <strong>${escapeHtml(managerName)}</strong>.
            ${isAdmin()
              ? '«Передать сразу» меняет ответственного без подтверждения, «Отправить запрос» — ждёт решения менеджера.'
              : 'Отправьте запрос — клиент перейдёт к выбранному менеджеру только после того, как он подтвердит.'}
          </div>
        </div>
      </div>` : ''}

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
            ${canWrite ? `<button class="btn btn-sm" onclick="openHistoryModal(${client.id})">+ Добавить</button>` : ''}
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

  // Клиент из старой базы: чекбокс раскрывает поле с прежним ID.
  const oldBaseCb = document.getElementById('orgOldBase');
  const oldBaseIdEl = document.getElementById('oldBaseId');
  const oldBaseId = client?.oldBaseId || '';
  if (oldBaseCb) oldBaseCb.checked = !!oldBaseId;
  if (oldBaseIdEl) oldBaseIdEl.value = oldBaseId;
  toggleOldBaseField();

  // Ответственный менеджер: заполняет только администратор (перенос клиента).
  const ownerSelect = document.getElementById('clientOwner');
  if (ownerSelect) {
    ownerSelect.innerHTML = users.map(u =>
      `<option value="${u.id}">${escapeHtml(u.name || u.login)} (${escapeHtml(userPositionLabel(u))})</option>`
    ).join('');
    const ownerId = client ? client.createdBy : (currentUser ? currentUser.id : null);
    ownerSelect.value = ownerId || '';
  }
  const transferComment = document.getElementById('clientTransferComment');
  if (transferComment) transferComment.value = '';
  toggleClientOwnerRow();

  hideCitySuggestions();
  setInnStatus('');
  document.getElementById('clientModal').classList.add('active');
}

// Поле «ID старой базы» показывается только при отмеченном чекбоксе.
function toggleOldBaseField() {
  const cb = document.getElementById('orgOldBase');
  const row = document.getElementById('oldBaseRow');
  if (!cb || !row) return;
  row.style.display = cb.checked ? '' : 'none';
  if (!cb.checked) {
    const el = document.getElementById('oldBaseId');
    if (el) el.value = '';
  }
}

// Блок переноса клиента другому менеджеру — только для администратора.
function toggleClientOwnerRow() {
  const row = document.getElementById('clientOwnerRow');
  const commentRow = document.getElementById('clientTransferCommentRow');
  const visible = isAdmin();
  if (row) row.style.display = visible ? '' : 'none';
  if (commentRow) commentRow.style.display = visible ? '' : 'none';
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

  // ID старой базы — только если отмечен чекбокс «Клиент из старой базы».
  const oldBaseCb = document.getElementById('orgOldBase');
  const oldBaseIdEl = document.getElementById('oldBaseId');
  data.oldBaseId = (oldBaseCb && oldBaseCb.checked && oldBaseIdEl)
    ? oldBaseIdEl.value.trim()
    : '';

  // Администратор может сразу закрепить клиента за менеджером (перенос).
  const ownerSelect = document.getElementById('clientOwner');
  const transferCommentEl = document.getElementById('clientTransferComment');
  const transferComment = transferCommentEl ? transferCommentEl.value.trim() : '';
  const ownerId = (isAdmin() && ownerSelect && ownerSelect.value)
    ? parseInt(ownerSelect.value, 10)
    : null;

  if (id) {
    const idx = clients.findIndex(c => c.id === parseInt(id));
    if (idx !== -1) {
      if (!canEditClient(clients[idx])) {
        alert('Редактировать компанию может только пользователь, который её создал.');
        return;
      }
      const previousOwner = clients[idx].createdBy;
      data.id = clients[idx].id;
      data.contacts = clients[idx].contacts || [];
      data.history = clients[idx].history || [];
      data.createdBy = ownerId || previousOwner;
      clients[idx] = data;

      // Перенос другому менеджеру — уведомляем нового ответственного.
      if (ownerId && ownerId !== previousOwner) {
        notifyClientTransfer(ownerId, 1, transferComment);
      }
    }
  } else {
    const maxId = clients.reduce((m, c) => Math.max(m, c.id || 0), 0);
    data.id = maxId + 1;
    data.contacts = [];
    data.history = [];
    data.createdBy = ownerId || (currentUser ? currentUser.id : null);
    clients.push(data);

    if (isAdmin() && ownerId && currentUser && ownerId !== currentUser.id) {
      // Администратор закрепил нового клиента за менеджером.
      notifyClientTransfer(ownerId, 1, transferComment);
    } else if (currentUser && !isAdmin()) {
      // Менеджер создал клиента сам — подтверждаем ему создание.
      notifyUser(currentUser.id, 'Клиент добавлен',
        'Вы добавили клиента «' + data.orgName + '» в свою базу.', null);
    }
  }

  saveClients(clients);
  hideCitySuggestions();
  closeModal('clientModal');
  renderClientsTable();
  if (selectedClientId) renderClientContacts(selectedClientId);
  // Форму открывали из карточки — возвращаем пользователя в неё с новыми данными.
  returnToClientCard();
}

// Уведомление менеджеру о закреплении клиентов (импорт или перенос).
function notifyClientTransfer(userId, count, comment) {
  if (!userId) return;
  let text = 'На вас перенесли клиента в кол-ве ' + count;
  if (comment) text += '. ' + comment;
  notifyUser(userId, 'Клиенты закреплены за вами', text, null);
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
  if (!canAddContact()) { alert('Сначала войдите в систему'); return; }
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
  if (!canManageContacts()) {
    alert('Сначала войдите в систему.');
    return;
  }
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

  // Контактное лицо меняет данные клиента — только владелец или администратор.
  if (!canWriteToClient(client)) { alert('Недостаточно прав для изменения этого клиента.'); return; }
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
  if (!client || !canManageContacts()) {
    alert('Сначала войдите в систему.');
    return;
  }
  client.contacts.splice(idx, 1);
  saveClients(clients);
  renderClientContacts(clientId);
}

// Теги, отмеченные в форме комментария.
function readCommentTags(selfId, reportId) {
  const tags = [];
  const selfEl = document.getElementById(selfId);
  const reportEl = document.getElementById(reportId);
  if (selfEl && selfEl.checked) tags.push('forSelf');
  if (reportEl && reportEl.checked) tags.push('forReport');
  return tags;
}

function setCommentTagInputs(selfId, reportId, tags) {
  const list = commentTagsList(tags);
  const selfEl = document.getElementById(selfId);
  const reportEl = document.getElementById(reportId);
  if (selfEl) selfEl.checked = list.indexOf('forSelf') > -1;
  if (reportEl) reportEl.checked = list.indexOf('forReport') > -1;
}

// Открытие формы комментария. editIdx != null — правим существующую запись
// (доступно автору и администратору).
function openHistoryModal(clientId, editIdx) {
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
  // Сброс состояния форм заказа и заказа матриц, список коллег для встречи.
  resetOrderForm();
  const colleagueSel = document.getElementById('historyColleague');
  if (colleagueSel) colleagueSel.innerHTML = historyColleagueOptions();
  const nextActivityEl = document.getElementById('historyNextActivity');
  if (nextActivityEl) nextActivityEl.value = '';

  const editing = (editIdx !== undefined && editIdx !== null && editIdx !== '');
  const title = document.querySelector('#historyModal h2');
  const editIdxEl = document.getElementById('historyEditIdx');
  const commentEl = document.getElementById('historyComment');
  const submitBtn = document.querySelector('#historyModal button[type="submit"]');

  if (editing) {
    const entry = client ? (client.history || [])[parseInt(editIdx, 10)] : null;
    // Править можно только свой комментарий (или любой — администратору).
    if (entry && !canEditComment(entry)) {
      alert('Править комментарий может его автор или администратор.');
      return;
    }
    if (entry) {
      if (editIdxEl) editIdxEl.value = editIdx;
      if (typeSelect) typeSelect.value = entry.type || typeSelect.value;
      if (commentEl) commentEl.value = entry.comment || '';
      const personSel = document.getElementById('historyContactPerson');
      if (personSel) personSel.value = entry.contactPerson || '';
      setCommentTagInputs('historyTagSelf', 'historyTagReport', entry.tags);
      // Следующая активность и коллега по встрече — из сохранённой записи.
      if (nextActivityEl) nextActivityEl.value = entry.nextActivityAt || '';
      if (colleagueSel && entry.colleagueId) colleagueSel.value = String(entry.colleagueId);
      if (entry.order) {
        document.getElementById('orderKg').value = entry.order.kg === null || entry.order.kg === undefined ? '' : entry.order.kg;
        document.getElementById('orderCost').value = entry.order.cost === null || entry.order.cost === undefined ? '' : entry.order.cost;
        renderOrderConditions(entry.order.condition);
        const specEl = document.getElementById('orderSpecification');
        if (specEl) specEl.value = entry.order.specification || '';
      }
      if (title) title.textContent = 'Редактирование комментария';
      if (submitBtn) submitBtn.textContent = 'Сохранить';
    }
  } else {
    if (editIdxEl) editIdxEl.value = '';
    if (commentEl) commentEl.value = '';
    setCommentTagInputs('historyTagSelf', 'historyTagReport', []);
    if (title) title.textContent = 'Добавить взаимодействие';
    if (submitBtn) submitBtn.textContent = 'Добавить';
  }

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
// «Заказ матриц» — отдельная ветка со своими полями, поэтому исключён.
function isOrderType(type) {
  return /заказ/i.test(String(type || '')) && !isMatrixType(type);
}

// «Заказ матриц»: окно с шифрами, покрытием и комментарием.
function isMatrixType(type) {
  return /матриц/i.test(String(type || ''));
}

function isMeetingType(type) {
  return /встреч/i.test(String(type || ''));
}

/* ===== Закрытие активности и авто-задачи =====
   Активность закрывается только вместе со следующей датой активности: она же
   становится сроком задачи в привязанном столбце. Единственное исключение —
   тип «Нерентабелен»: он закрывает активность без следующего шага. */

const NO_NEXT_DATE_ACTIVITY = /нерентаб/i;

function isNoNextDateActivity(type) {
  return NO_NEXT_DATE_ACTIVITY.test(String(type || ''));
}

// Проверка правила. Возвращает { ok: true, nextAt } либо { ok: false, error }.
function checkNextActivity(type, value) {
  if (isNoNextDateActivity(type)) return { ok: true, nextAt: null };
  const v = String(value == null ? '' : value).trim();
  if (!v) {
    return {
      ok: false,
      error: 'Укажите следующую дату активности — без неё активность не закрывается.\n' +
             'Исключение: тип «Нерентабелен».'
    };
  }
  return { ok: true, nextAt: v };
}

// Дата-время активности в читаемом виде.
function formatActivityMoment(value) {
  const v = String(value || '').trim();
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

// Шифры из окна «Заказ матриц»: по одному в строке или через запятую.
function readMatrixCiphers() {
  const el = document.getElementById('matrixCiphers');
  if (!el) return [];
  return String(el.value || '')
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Служебные поля записи активности. closedAt заполняется, когда следующий шаг
// назначен или активность закрыта как нерентабельная; иначе запись остаётся
// «не закрытой» и это видно в карточке.
function applyActivityFields(entry, type, nextAt, columnId) {
  entry.activityType = type;
  entry.nextActivityAt = nextAt || null;
  entry.closedAt = (nextAt || isNoNextDateActivity(type)) ? new Date().toISOString() : null;
  entry.columnId = columnId || null;
  return entry;
}

// Текст задачи, созданной по активности.
function activityTaskDescription(entry, client, extra) {
  const parts = [];
  parts.push(entry.comment || '');
  if (extra) parts.push(extra);
  if (entry.contactPerson) parts.push('Контактное лицо: ' + entry.contactPerson);
  if (client) parts.push('Клиент: ' + (client.orgName || '—'));
  if (entry.nextActivityAt) parts.push('Следующая активность: ' + formatActivityMoment(entry.nextActivityAt));
  parts.push('Комментарий оставил(а): ' + ((currentUser && (currentUser.name || currentUser.login)) || '—'));
  return parts.filter(Boolean).join('\n');
}

// Создать задачи по активности: основную в привязанном столбце и, для встречи
// с коллегой, отдельную задачу коллеге с уведомлением.
function createTasksForActivity(opts) {
  const result = { task: null, colleagueTask: null, columnId: null };
  const columnId = activityColumnId(opts.type);
  if (!columnId) return result;          // активность не привязана — только комментарий
  result.columnId = columnId;

  const base = {
    activityType: opts.type,
    clientId: opts.clientId != null ? opts.clientId : null,
    contactId: opts.contactId != null ? opts.contactId : null,
    deadline: opts.nextAt || '',
    description: opts.description || '',
    colleagueId: opts.colleagueId != null ? opts.colleagueId : null
  };

  result.task = createActivityTask(Object.assign({}, base, {
    title: activityTaskTitle(opts.type, opts.clientName, opts.titleExtra)
  }));

  const meId = currentUser ? currentUser.id : null;
  if (result.task && isMeetingType(opts.type) && opts.colleagueId && opts.colleagueId !== meId) {
    result.colleagueTask = createActivityTask(Object.assign({}, base, {
      title: activityTaskTitle(opts.type, opts.clientName, opts.titleExtra),
      ownerId: opts.colleagueId,
      colleagueId: meId,
      description: (opts.description || '') + '\nВстречу назначил(а): ' +
        ((currentUser && (currentUser.name || currentUser.login)) || '—')
    }));
    if (result.colleagueTask) {
      const col = taskColumns.find(c => c.id === columnId);
      notifyUser(
        opts.colleagueId,
        'Встреча: ' + (opts.clientName || 'клиент'),
        'Вы участник встречи. Задача добавлена в столбец «' + ((col && col.name) || 'Встреча') + '».',
        result.colleagueTask.id
      );
    }
  }
  return result;
}

// Строка состояния активности в списке комментариев. Статус «закрыта» больше
// не показываем — он только дублировал факт назначенной даты и путал; оставляем
// полезное: следующую активность и привязанную задачу.
function activityStatusHtml(entry) {
  if (!entry) return '';
  const next = entry.nextActivityAt ? formatActivityMoment(entry.nextActivityAt) : '';
  const taskId = entry.taskId;
  if (!next && !taskId) return '';
  const nextLine = next
    ? `<span style="color:#1d4ed8;">следующая активность: ${escapeHtml(next)}</span>`
    : '';
  const taskLine = taskId
    ? `<span style="margin-left:6px;color:#6b7280;">задача №${taskId}</span>`
    : '';
  return `<div style="font-size:11px;margin-top:5px;">${nextLine}${taskLine}</div>`;
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
  const spec = document.getElementById('orderSpecification');
  if (kg) kg.value = '';
  if (cost) cost.value = '';
  if (price) price.value = '';
  if (spec) spec.value = '';
  renderOrderConditions('');
  // Поля заказа матриц сбрасываются вместе с заказом.
  const ciphers = document.getElementById('matrixCiphers');
  if (ciphers) ciphers.value = '';
  const coating = document.getElementById('matrixCoating');
  if (coating) coating.value = '';
}

// Показываем нужный блок формы при выборе типа активности:
// «Заказ матриц» — шифры и покрытие, «Размещение заказа» — параметры заказа,
// «Встреча» — выбор коллеги.
function onHistoryTypeChange() {
  const typeEl = document.getElementById('historyType');
  const type = typeEl ? typeEl.value : '';

  const orderSection = document.getElementById('orderFormSection');
  const isOrder = isOrderType(type);
  if (orderSection) orderSection.style.display = isOrder ? 'block' : 'none';
  if (isOrder) recalcOrderCost();

  const matrixSection = document.getElementById('matrixFormSection');
  const isMatrix = isMatrixType(type);
  if (matrixSection) matrixSection.style.display = isMatrix ? 'block' : 'none';
  if (isMatrix) renderMatrixCoatings();

  const colleagueRow = document.getElementById('historyColleagueRow');
  if (colleagueRow) colleagueRow.style.display = isMeetingType(type) ? '' : 'none';

  const hint = document.getElementById('historyNextActivityHint');
  if (hint) {
    hint.textContent = isNoNextDateActivity(type)
      ? 'Тип «Нерентабелен»: активность закрывается без следующей даты.'
      : 'Без следующей даты активность не закрывается — она же становится сроком задачи.';
  }
}

// Покрытия для заказа матриц — тот же справочник, что у заказов.
function renderMatrixCoatings() {
  const select = document.getElementById('matrixCoating');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">—</option>' +
    ORDER_CONDITIONS.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  select.value = current;
}

// Список коллег для встречи: менеджеры и руководители, кроме себя.
function historyColleagueOptions() {
  const meId = currentUser ? currentUser.id : null;
  return users
    .filter(u => isManagerRole(u) && u.id !== meId)
    .map(u => `<option value="${u.id}">${escapeHtml(u.name || u.login)} (${escapeHtml(userPositionLabel(u))})</option>`)
    .join('');
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
  // Чужого клиента менеджер не редактирует: только владелец или администратор.
  if (!canWriteToClient(client)) { alert('Недостаточно прав для изменения этого клиента.'); return; }
  // Правку существующей записи разрешаем автору и администратору (ниже).
  if (!client.history) client.history = [];

  const type = document.getElementById('historyType').value;
  let comment = document.getElementById('historyComment').value.trim();
  let orderData = null;
  let matrixData = null;

  // 1. Правило: активность закрывается только вместе со следующей датой.
  //    Исключение — «Нерентабелен».
  const nextEl = document.getElementById('historyNextActivity');
  const nextCheck = checkNextActivity(type, nextEl ? nextEl.value : '');
  if (!nextCheck.ok) { alert(nextCheck.error); return; }

  // 2. «Заказ матриц»: шифры, покрытие и комментарий.
  if (isMatrixType(type)) {
    const ciphers = readMatrixCiphers();
    if (!ciphers.length) { alert('Укажите хотя бы один шифр матрицы'); return; }
    const coatingEl = document.getElementById('matrixCoating');
    const coating = coatingEl ? coatingEl.value.trim() : '';
    matrixData = { ciphers: ciphers, coating: coating };
    if (!comment) {
      comment = 'Заказ матриц: ' + ciphers.join(', ') + (coating ? ' (' + coating + ')' : '');
    }
  }

  // 3. «Размещение заказа» (старая система): собираем параметры, формируем
  //    текст комментария и создаём запись в модуле «Заказы». Стоимость за кг
  //    считаем из суммы и веса. Комментарий остаётся в комментариях.
  if (isOrderType(type)) {
    const conditionEl = document.getElementById('orderCondition');
    const kgRaw = document.getElementById('orderKg').value;
    const costRaw = document.getElementById('orderCost').value;
    const specEl = document.getElementById('orderSpecification');

    const kg = kgRaw === '' ? null : Number(kgRaw);
    const cost = costRaw === '' ? null : Number(costRaw);
    const condition = conditionEl ? conditionEl.value.trim() : '';
    const specification = specEl ? specEl.value.trim() : '';
    const avgPrice = orderPricePerKg(kg, cost);

    orderData = { kg, condition, avgPrice, cost, specification };

    const parts = [
      'Кол-во кг — ' + (kg === null ? '—' : fmtKg(kg)),
      'Состояние поставки — ' + (condition || '—'),
      'Общая стоимость — ' + (cost === null ? '—' : fmtMoney(cost)),
      'Стоимость за кг — ' + (avgPrice === null ? '—' : fmtMoney(avgPrice))
    ];
    if (specification) parts.push('СП — ' + specification);
    const autoComment = type + ': ' + parts.join(', ');
    comment = comment || autoComment;
  }

  if (!comment) { alert('Заполните комментарий'); return; }

  const tags = readCommentTags('historyTagSelf', 'historyTagReport');
  // Комментарий к заказу матриц уходит в отчёт — отметка ставится сама.
  if (matrixData && tags.indexOf('forReport') === -1) tags.push('forReport');

  const colleagueEl = document.getElementById('historyColleague');
  const colleagueId = (isMeetingType(type) && colleagueEl && colleagueEl.value)
    ? parseInt(colleagueEl.value, 10)
    : null;

  const editIdxEl = document.getElementById('historyEditIdx');
  const editIdx = editIdxEl ? editIdxEl.value : '';

  // Столбец, привязанный к активности (может быть не привязана — тогда задачи
  // не будет, останется только комментарий).
  const boundColumnId = activityColumnId(type);

  // Правка ранее оставленного комментария.
  if (editIdx !== '') {
    const entry = client.history[parseInt(editIdx, 10)];
    if (!entry) return;
    if (!canEditComment(entry)) {
      alert('Править комментарий может его автор или администратор.');
      return;
    }
    entry.type = type;
    entry.comment = comment;
    entry.tags = tags;
    entry.editedAt = new Date().toISOString();
    if (orderData) entry.order = orderData;
    applyActivityFields(entry, type, nextCheck.nextAt, boundColumnId || entry.columnId || null);

    // Если по активности уже создана задача — обновляем её срок и описание,
    // чтобы правка комментария не расходилась с задачей.
    const linked = entry.taskId ? tasks.find(t => t.id === entry.taskId) : null;
    if (linked) {
      linked.deadline = nextCheck.nextAt || '';
      linked.description = activityTaskDescription(entry, client, matrixExtraText(matrixData));
      saveTasks();
    }

    if (matrixData) saveMatrixOrders(client, matrixData.ciphers, matrixData.coating, comment);

    saveClients(clients);
    closeModal('historyModal');
    if (e.target && e.target.reset) e.target.reset();
    resetOrderForm();
    refreshClientViews(clientId);
    return;
  }

  const entry = {
    date: new Date().toISOString(),
    type: type,
    contactPerson: document.getElementById('historyContactPerson').value,
    manager: currentUser ? currentUser.login : '',
    authorId: currentUser ? currentUser.id : null,
    comment: comment,
    tags: tags,
    order: orderData
  };
  applyActivityFields(entry, type, nextCheck.nextAt, boundColumnId);

  // Заказ матриц: по записи на каждый шифр — они и есть «матрицы».
  if (matrixData) {
    saveMatrixOrders(client, matrixData.ciphers, matrixData.coating, comment);
  }

  client.history.push(entry);

  // Задачи по активности: в привязанный столбец; для встречи — ещё и коллеге.
  const created = createTasksForActivity({
    type: type,
    clientId: client.id,
    clientName: client.orgName,
    nextAt: nextCheck.nextAt,
    colleagueId: colleagueId,
    titleExtra: matrixData ? matrixData.ciphers.join(', ') : '',
    description: activityTaskDescription(entry, client, matrixExtraText(matrixData))
  });
  if (created.task) entry.taskId = created.task.id;

  saveClients(clients);

  if (orderData) {
    addOrder({
      clientId: client.id,
      clientName: client.orgName,
      kg: orderData.kg,
      condition: orderData.condition,
      avgPrice: orderData.avgPrice,
      cost: orderData.cost,
      specification: orderData.specification || '',
      date: new Date().toISOString(),
      createdBy: currentUser ? currentUser.id : null,
      comment: comment
    });
    // Номер СП мог появиться — сразу подтягиваем готовность по нему.
    if (typeof refreshReadinessForVisibleOrders === 'function') refreshReadinessForVisibleOrders();
  }

  closeModal('historyModal');
  if (e.target && e.target.reset) e.target.reset();
  resetOrderForm();
  refreshClientViews(clientId);
}

// Дополнительная строка описания задачи для заказа матриц.
function matrixExtraText(matrixData) {
  if (!matrixData) return '';
  const parts = ['Шифры: ' + matrixData.ciphers.join(', ')];
  if (matrixData.coating) parts.push('Покрытие: ' + matrixData.coating);
  return parts.join('\n');
}

// Записи заказов матриц: по одной на шифр, статус — «Поступила».
function saveMatrixOrders(client, ciphers, coating, comment) {
  ciphers.forEach(cipher => {
    addMatrix({
      cipher: cipher,
      coating: coating || '',
      status: MATRIX_STATUSES[0],
      clientId: client ? client.id : null,
      clientName: client ? client.orgName : '',
      comment: comment || '',
      createdBy: currentUser ? currentUser.id : null
    });
  });
}

// Список менеджеров для передачи клиента. Показываем роли «Менеджер
// по продажам», а если текущий ответственный — администратор,
// добавляем его, чтобы значение в списке не терялось.
function clientOwnerOptions(currentOwnerId) {
  const managers = users.filter(u => isManagerRole(u));
  const current = currentOwnerId ? findUserById(currentOwnerId) : null;
  const list = managers.slice();
  if (current && managers.indexOf(current) === -1) list.unshift(current);

  return list.map(u =>
    `<option value="${u.id}"${u.id === currentOwnerId ? ' selected' : ''}>` +
    `${escapeHtml(u.name || u.login)} (${escapeHtml(userPositionLabel(u))})</option>`
  ).join('');
}

// Передача клиента другому менеджеру прямо из карточки (только администратор).
// Менеджеры пользуются запросом: см. requestClientTransferFromCard().
function applyClientTransfer() {
  const id = cardClientId || selectedClientId;
  const client = clients.find(c => c.id === id);
  if (!client) return;
  if (!isAdmin()) { alert('Передавать клиентов сразу может только администратор. Отправьте запрос.'); return; }

  const select = document.getElementById('cardOwnerSelect');
  const commentEl = document.getElementById('cardTransferComment');
  const newOwnerId = select ? parseInt(select.value, 10) : null;
  const comment = commentEl ? commentEl.value.trim() : '';

  // Менеджер не изменился — просто обновляем карточку.
  if (!newOwnerId || newOwnerId === client.createdBy) {
    if (commentEl) commentEl.value = '';
    renderClientCard(client.id);
    return;
  }

  client.createdBy = newOwnerId;
  client.responsibleManagerId = newOwnerId;
  saveClients(clients);
  notifyClientTransfer(newOwnerId, 1, comment);

  // Открытые запросы по этому клиенту закрываем: передача уже состоялась.
  const pending = pendingTransferForClient(client.id);
  if (pending && typeof cancelTransferRequest === 'function') cancelTransferRequest(pending.id);

  if (commentEl) commentEl.value = '';
  renderClientsTable();
  renderClientContacts(client.id);
  renderClientCard(client.id);
  if (typeof updateTransfersMenuBadge === 'function') updateTransfersMenuBadge();
}

// Запрос на перенос клиента из карточки (путь администратора: свой селект
// менеджера и комментарий). У менеджеров перенос идёт через модалку
// transferRequestModal (js/transfers.js).
function requestClientTransferFromCard() {
  const id = cardClientId || selectedClientId;
  const client = clients.find(c => c.id === id);
  if (!client) return;

  const select = document.getElementById('cardOwnerSelect');
  const commentEl = document.getElementById('cardTransferComment');
  const targetId = select ? select.value : '';
  const comment = commentEl ? commentEl.value.trim() : '';

  if (!targetId) { alert('Выберите менеджера, которому передаём клиента'); return; }

  const res = createClientTransferRequest(client.id, targetId, comment);
  if (!res.ok) { alert(res.error); return; }

  if (commentEl) commentEl.value = '';
  alert('Запрос отправлен: ' + transferManagerName(parseInt(targetId, 10)) +
    ' получит уведомление и примет решение.');
  renderClientCard(client.id);
  if (typeof updateTransfersMenuBadge === 'function') updateTransfersMenuBadge();
}

// Плашка с решением по запросу — см. js/transfers.js (pendingTransferHtml).

function cancelTransferFromCard(requestId) {
  const res = cancelTransferRequest(requestId);
  if (!res.ok) { alert(res.error); return; }
  const id = cardClientId || selectedClientId;
  if (id) renderClientCard(id);
}

// Перерисовать блоки клиента после изменения комментариев.
function refreshClientViews(clientId) {
  renderClientContacts(clientId);
  renderClientNotes(clientId);
  if (document.getElementById('clientCardModal') &&
      document.getElementById('clientCardModal').classList.contains('active')) {
    renderClientCard(cardClientId || clientId);
  }
}

/* ===== Особые отметки =====
   Комментарии по клиенту целиком, без привязки к конкретному контактному
   лицу: список с автором и датой, добавление доступно всем, отметки-теги
   «Для себя» / «Для отчёта», правка — автору и администратору. */

function openClientNotes(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) { alert('Сначала выберите клиента'); return; }
  document.getElementById('notesClientId').value = clientId;
  document.getElementById('notesModalTitle').textContent = 'Особые отметки — ' + (client.orgName || '');
  resetNotesForm();
  renderClientNotes(clientId);
  // Отметки есть — открываем список, отметок нет — сразу форму добавления.
  setNotesMode(notesModeFor(client));
  document.getElementById('clientNotesModal').classList.add('active');
}

// Режим окна отметок: 'list' — список с кнопкой добавления,
// 'add' — форма добавления/правки.
function setNotesMode(mode) {
  const isAdd = mode === 'add';
  const form = document.getElementById('noteForm');
  const addBtn = document.getElementById('noteAddBtn');
  const list = document.getElementById('notesList');
  const cancelBtn = document.getElementById('noteCancelBtn');
  if (form) form.style.display = isAdd ? '' : 'none';
  if (addBtn) addBtn.style.display = isAdd ? 'none' : '';
  if (list) list.style.display = isAdd ? 'none' : '';
  if (cancelBtn) cancelBtn.style.display = isAdd ? '' : 'none';
}

function notesModeFor(client) {
  return (client && (client.history || []).length) ? 'list' : 'add';
}

// Кнопка «+ Добавить отметку» внутри списка.
function showNotesAddForm() {
  resetNotesForm();
  setNotesMode('add');
  const text = document.getElementById('noteText');
  if (text && text.focus) text.focus();
}

// Отмена добавления/правки: возвращаемся к списку.
function cancelNoteEdit() {
  const clientId = parseInt(document.getElementById('notesClientId').value, 10);
  const client = clients.find(c => c.id === clientId);
  resetNotesForm();
  setNotesMode(notesModeFor(client));
}

function resetNotesForm() {
  const text = document.getElementById('noteText');
  if (text) text.value = '';
  const editIdx = document.getElementById('noteEditIdx');
  if (editIdx) editIdx.value = '';

  const typeSel = document.getElementById('noteType');
  if (typeSel) {
    const types = (interactionTypes && interactionTypes.length) ? interactionTypes : ['Информация'];
    const current = typeSel.value;
    typeSel.innerHTML = types.map(t => `<option>${escapeHtml(t)}</option>`).join('');
    typeSel.value = types.indexOf(current) > -1 ? current : types[0];
  }

  setCommentTagInputs('noteTagSelf', 'noteTagReport', []);
  const nextEl = document.getElementById('noteNextActivity');
  if (nextEl) nextEl.value = '';
  const saveBtn = document.getElementById('noteSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Добавить отметку';
  const cancelBtn = document.getElementById('noteCancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function renderClientNotes(clientId) {
  const client = clients.find(c => c.id === clientId);
  const list = document.getElementById('notesList');
  if (!client || !list) return;

  const notes = [...(client.history || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const modalCount = document.getElementById('notesModalCount');
  if (modalCount) modalCount.textContent = notes.length ? `(${notes.length})` : '';
  updateClientNotesCount(client);

  if (!notes.length) {
    list.innerHTML = '<div class="empty-state" style="padding:30px 16px;"><p>Отметок пока нет</p></div>';
    return;
  }

  list.innerHTML = notes.map(entry => {
    const idx = (client.history || []).indexOf(entry);
    return `
      <div class="note-item">
        <div class="note-item-head">
          <span class="note-author">${escapeHtml(entry.manager || '—')}</span>
          <span class="note-date">${formatDate(entry.date)}${entry.editedAt ? ' · изменено' : ''}</span>
          <span class="badge">${escapeHtml(entry.type || '')}</span>
          ${canEditComment(entry)
            ? `<button class="btn-icon-btn" onclick="startEditNote(${clientId}, ${idx})" title="Редактировать отметку">Изменить</button>`
            : ''}
        </div>
        <div class="note-text">${escapeHtml(entry.comment || '')}</div>
        ${activityStatusHtml(entry)}
        ${entry.tags && entry.tags.length ? `<div class="comment-tags">${commentTagsHtml(entry.tags)}</div>` : ''}
      </div>`;
  }).join('');
}

function startEditNote(clientId, idx) {
  const client = clients.find(c => c.id === clientId);
  if (!client || !client.history || !client.history[idx]) return;
  const entry = client.history[idx];
  if (!canEditComment(entry)) {
    alert('Править отметку может её автор или администратор.');
    return;
  }

  document.getElementById('noteEditIdx').value = idx;
  document.getElementById('noteText').value = entry.comment || '';
  const typeSel = document.getElementById('noteType');
  if (typeSel && entry.type) typeSel.value = entry.type;
  setCommentTagInputs('noteTagSelf', 'noteTagReport', entry.tags);
  const nextEl = document.getElementById('noteNextActivity');
  if (nextEl) nextEl.value = entry.nextActivityAt || '';

  const saveBtn = document.getElementById('noteSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Сохранить изменения';
  // Показываем форму: из списка отметок она скрыта.
  setNotesMode('add');
  const text = document.getElementById('noteText');
  if (text && text.focus) text.focus();
}

function saveClientNote() {
  const clientId = parseInt(document.getElementById('notesClientId').value, 10);
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  if (!canWriteToClient(client)) { alert('Недостаточно прав для изменения этого клиента.'); return; }
  if (!client.history) client.history = [];

  const textEl = document.getElementById('noteText');
  const text = textEl ? textEl.value.trim() : '';
  if (!text) { alert('Введите текст отметки'); return; }

  const typeSel = document.getElementById('noteType');
  const type = (typeSel && typeSel.value) ? typeSel.value : 'Информация';
  const tags = readCommentTags('noteTagSelf', 'noteTagReport');
  const editIdxEl = document.getElementById('noteEditIdx');
  const editIdx = editIdxEl ? editIdxEl.value : '';

  // Отметка — такая же активность, поэтому правило то же: закрывается только
  // вместе со следующей датой. Исключение — «Нерентабелен».
  const nextEl = document.getElementById('noteNextActivity');
  const nextCheck = checkNextActivity(type, nextEl ? nextEl.value : '');
  if (!nextCheck.ok) { alert(nextCheck.error); return; }

  const boundColumnId = activityColumnId(type);

  if (editIdx !== '') {
    const entry = client.history[parseInt(editIdx, 10)];
    if (!entry) return;
    if (!canEditComment(entry)) {
      alert('Править отметку может её автор или администратор.');
      return;
    }
    entry.comment = text;
    entry.type = type;
    entry.tags = tags;
    entry.editedAt = new Date().toISOString();
    applyActivityFields(entry, type, nextCheck.nextAt, boundColumnId || entry.columnId || null);
    const linked = entry.taskId ? tasks.find(t => t.id === entry.taskId) : null;
    if (linked) {
      linked.deadline = nextCheck.nextAt || '';
      saveTasks();
    }
  } else {
    const entry = {
      date: new Date().toISOString(),
      type: type,
      contactPerson: '',
      manager: currentUser ? currentUser.login : '',
      authorId: currentUser ? currentUser.id : null,
      comment: text,
      tags: tags,
      order: null
    };
    applyActivityFields(entry, type, nextCheck.nextAt, boundColumnId);
    client.history.push(entry);

    // Задача по активности — в привязанный столбец (если привязка есть).
    const created = createTasksForActivity({
      type: type,
      clientId: client.id,
      clientName: client.orgName,
      nextAt: nextCheck.nextAt,
      description: activityTaskDescription(entry, client, '')
    });
    if (created.task) entry.taskId = created.task.id;
  }

  saveClients(clients);
  resetNotesForm();
  renderClientNotes(clientId);
  setNotesMode(notesModeFor(client));
  renderClientContacts(clientId);
  if (document.getElementById('clientCardModal') &&
      document.getElementById('clientCardModal').classList.contains('active')) {
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
  // Удаление клиента — только администратор.
  if (!isAdmin()) {
    alert('Удалять клиентов может только администратор.');
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

// Задача из карточки клиента: модалка открывается ПОВЕРХ карточки,
// а поле «Клиент (компания)» внутри скрыто — клиент уже известен.
function openTaskModalWithClient(clientId) {
  openTaskModal(null, clientId);
}

// Напоминание из карточки клиента: тип сразу «Для клиента»,
// поле выбора клиента скрыто.
function openCardReminderModal(clientId) {
  openReminderModal(null, clientId);
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

/* ===== Импорт клиентов из Excel/CSV =====
   Колонки ищутся по названиям, а не по порядку, поэтому шаблон можно
   дополнять и переставлять столбцы. Файл читается тем же разбором,
   что и справочник контактов (js/contacts.js). */

const CLIENT_IMPORT_COLUMNS = [
  'Организация', 'Страна', 'Город', 'Тип организации', 'Статус', 'Адрес',
  'Телефоны', 'Email', 'Сайт', 'ИНН', 'ОГРН',
  'Логин менеджера', 'ID старой базы',
  'Контактное лицо', 'Должность', 'Телефон контакта', 'Email контакта'
];

// Синонимы заголовков: в чужих файлах колонки часто названы иначе.
const CLIENT_IMPORT_ALIASES = {
  'Организация': ['организация', 'название', 'название организации', 'компания', 'наименование', 'клиент'],
  'Страна': ['страна'],
  'Город': ['город'],
  'Тип организации': ['тип организации', 'тип', 'направление'],
  'Статус': ['статус'],
  'Адрес': ['адрес', 'адрес организации'],
  'Телефоны': ['телефоны', 'телефон', 'тел'],
  'Email': ['email', 'почта', 'электронная почта'],
  'Сайт': ['сайт', 'сайт организации', 'website'],
  'ИНН': ['инн'],
  'ОГРН': ['огрн'],
  'Логин менеджера': ['логин менеджера', 'менеджер', 'ответственный', 'логин ответственного', 'manager'],
  'ID старой базы': ['id старой базы', 'id', 'ид', 'номер в старой базе', 'id в старой базе', 'старый id'],
  'Контактное лицо': ['контактное лицо', 'фио', 'контакт', 'основной контакт'],
  'Должность': ['должность'],
  'Телефон контакта': ['телефон контакта', 'сотовый', 'мобильный', 'телефон контактного лица'],
  'Email контакта': ['email контакта', 'почта контакта']
};

const CLIENT_STATUS_ALIASES = {
  cooperation: ['сотрудничество', 'работаем', 'cooperation'],
  in_progress: ['в работе', 'в процессе', 'in_progress'],
  not_working: ['не прорабатывать', 'не работаем', 'not_working']
};

function normalizeImportHeader(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseClientStatus(value) {
  const v = String(value || '').trim().toLowerCase();
  // По ТЗ статус по умолчанию при импорте — «В работе».
  if (!v) return 'in_progress';
  const found = Object.keys(CLIENT_STATUS_ALIASES).find(k => CLIENT_STATUS_ALIASES[k].indexOf(v) > -1);
  return found || 'in_progress';
}

function resolveCountryCode(value) {
  const v = String(value || '').trim();
  if (!v) return DEFAULT_COUNTRY;
  if (countryExists(v.toUpperCase())) return v.toUpperCase();
  const byName = COUNTRIES.find(c => c.name.toLowerCase() === v.toLowerCase());
  return byName ? byName.code : DEFAULT_COUNTRY;
}

// Соответствие «колонка шаблона → индекс в файле».
function resolveClientImportColumns(headerRow) {
  const headers = (headerRow || []).map(normalizeImportHeader);
  const map = {};
  CLIENT_IMPORT_COLUMNS.forEach(col => {
    const aliases = CLIENT_IMPORT_ALIASES[col] || [normalizeImportHeader(col)];
    const idx = headers.findIndex(h => h && aliases.indexOf(h) > -1);
    if (idx > -1) map[col] = idx;
  });
  return map;
}

function buildClientsFromRows(rows) {
  if (!rows.length) return { list: [], skipped: 0, duplicates: 0, unknownManagers: 0, owners: {} };

  const map = resolveClientImportColumns(rows[0]);
  if (map['Организация'] === undefined) {
    throw new Error('в файле не найдена колонка «Организация» — скачайте шаблон кнопкой «Шаблон»');
  }

  const list = [];
  let maxId = clients.reduce((m, c) => Math.max(m, c.id || 0), 0);
  let skipped = 0;
  let duplicates = 0;
  let unknownManagers = 0;
  // Сколько клиентов уходит каждому менеджеру — для уведомления «в кол-ве N».
  const owners = {};

  // Уже заведённые ID старой базы — по ним повторный импорт не создаёт дубли.
  const knownOldIds = {};
  clients.forEach(c => {
    if (c.oldBaseId) knownOldIds[String(c.oldBaseId).trim().toLowerCase()] = true;
  });

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cell = (col) => {
      const idx = map[col];
      if (idx === undefined) return '';
      const raw = row[idx];
      return (raw === undefined || raw === null) ? '' : cleanCell(raw);
    };

    const orgName = cell('Организация');
    if (!orgName) { skipped++; continue; }

    const oldBaseId = cell('ID старой базы');
    if (oldBaseId && knownOldIds[oldBaseId.toLowerCase()]) { duplicates++; continue; }
    if (oldBaseId) knownOldIds[oldBaseId.toLowerCase()] = true;

    // Логин менеджера: клиент сразу закрепляется за ним.
    const managerLogin = cell('Логин менеджера');
    let ownerId = currentUser ? currentUser.id : null;
    if (managerLogin) {
      const manager = findUserByLogin(managerLogin);
      if (manager) ownerId = manager.id;
      else unknownManagers++; // клиент останется без ответственного, админ назначит вручную
    }

    const contactName = cell('Контактное лицо');
    const contacts = contactName ? [{
      name: contactName,
      position: cell('Должность'),
      phoneWork: '',
      phoneMobile: cell('Телефон контакта'),
      email: cell('Email контакта'),
      messengers: []
    }] : [];

    if (managerLogin && ownerId) owners[ownerId] = (owners[ownerId] || 0) + 1;

    list.push({
      id: ++maxId,
      orgName: orgName,
      orgCountry: resolveCountryCode(cell('Страна')),
      orgCity: cell('Город'),
      orgDirection: cell('Тип организации'),
      orgAddress: cell('Адрес'),
      orgPhones: cell('Телефоны'),
      orgStatus: parseClientStatus(cell('Статус')),
      orgEmails: cell('Email'),
      orgWebsite: cell('Сайт'),
      orgInn: cell('ИНН'),
      orgOgrn: cell('ОГРН'),
      oldBaseId: oldBaseId,
      contacts: contacts,
      history: [],
      createdBy: ownerId
    });
  }

  return {
    list: list,
    skipped: skipped,
    duplicates: duplicates,
    unknownManagers: unknownManagers,
    owners: owners
  };
}

async function importClientsFromExcel(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;

  if (!isAdmin()) { alert('Импорт клиентов доступен администратору.'); return; }

  try {
    const rows = await parseSpreadsheetFile(file);
    const result = buildClientsFromRows(rows);

    if (!result.list.length) {
      showClientsImportResult('В файле нет ни одной новой строки с названием организации. Проверьте шаблон.', true);
      return;
    }

    // Значения из файла пополняют общие справочники.
    result.list.forEach(c => {
      if (c.orgDirection) dictAdd('orgTypes', c.orgDirection);
      (c.contacts || []).forEach(ct => { if (ct.position) dictAdd('positions', ct.position); });
    });

    clients = clients.concat(result.list);
    saveClients(clients);
    renderClientsTable();

    // Каждому менеджеру — одно уведомление с количеством закреплённых клиентов
    // и комментарием администратора.
    const commentEl = document.getElementById('importManagerComment');
    const comment = commentEl ? commentEl.value.trim() : '';
    const meId = currentUser ? currentUser.id : null;
    Object.keys(result.owners).forEach(uid => {
      const ownerId = parseInt(uid, 10);
      if (ownerId === meId) return;
      notifyClientTransfer(ownerId, result.owners[uid], comment);
    });
    if (commentEl) commentEl.value = '';

    const parts = ['Импортировано клиентов: ' + result.list.length];
    if (result.duplicates) parts.push('уже были в базе (по ID старой базы): ' + result.duplicates);
    if (result.skipped) parts.push('пропущено строк без названия: ' + result.skipped);
    if (result.unknownManagers) parts.push('строк с неизвестным логином менеджера: ' + result.unknownManagers + ' — клиенты добавлены без ответственного');
    showClientsImportResult(parts.join('. '), false);
  } catch (err) {
    showClientsImportResult('Ошибка при импорте: ' + err.message, true);
  }
}

// Шаблон с нужными колонками и примером заполнения.
function downloadClientsTemplate() {
  if (typeof XLSX === 'undefined') {
    alert('Библиотека экспорта Excel не загружена.');
    return;
  }
  const example = {
    'Организация': 'ООО «Пример»',
    'Страна': 'Россия',
    'Город': 'Москва',
    'Тип организации': 'Оптовая торговля',
    'Статус': 'В работе',
    'Адрес': 'г. Москва, ул. Примерная, д. 1',
    'Телефоны': '+7 495 000-00-00',
    'Email': 'info@example.ru',
    'Сайт': 'example.ru',
    'ИНН': '7707083893',
    'ОГРН': '1027700132195',
    'Логин менеджера': 'manager',
    'ID старой базы': '10457',
    'Контактное лицо': 'Иванов Иван Иванович',
    'Должность': 'Директор',
    'Телефон контакта': '+7 916 000-00-00',
    'Email контакта': 'ivanov@example.ru'
  };
  const ws = XLSX.utils.json_to_sheet([example], { header: CLIENT_IMPORT_COLUMNS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Клиенты');
  XLSX.writeFile(wb, 'Шаблон_импорта_клиентов.xlsx');
}

function showClientsImportResult(text, isError) {
  const el = document.getElementById('clientsImportResult');
  if (!el) return;
  el.style.display = 'block';
  el.className = 'import-result ' + (isError ? 'error' : 'ok');
  el.textContent = text;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, 9000);
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
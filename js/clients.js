let clients = [];
let selectedClientId = null;
let historyFilter = 'all';
let cardClientId = null;

// Фильтр списка клиентов: 'mine' (только мои) | 'all' (все) | id менеджера.
let clientManagerFilter = 'mine';
let clientSearchTimer = null;

// Статусы клиента: значение → подпись и цвет квадратного индикатора.
const CLIENT_STATUSES = {
  cooperation: { label: 'Сотрудничество', color: '#10b981' },   // зелёный
  in_progress: { label: 'В работе', color: '#f59e0b' },          // оранжевый
  not_working: { label: 'Не прорабатывать', color: '#ef4444' }   // красный
};

function clientStatusInfo(c) {
  const s = c && c.status ? CLIENT_STATUSES[c.status] : null;
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
    c.orgPhones, c.orgEmails, c.orgWebsite, c.orgInn,
    c.contactName
  ];
  return fields.some(f => (f || '').toLowerCase().includes(q));
}

// Debounce поиска в реальном времени (350 мс).
function scheduleClientsSearch() {
  clearTimeout(clientSearchTimer);
  clientSearchTimer = setTimeout(renderClientsTable, 350);
}

function setClientManagerFilter(value) {
  clientManagerFilter = value;
  renderClientsTable();
  if (selectedClientId) renderClientContacts(selectedClientId);
}

// Опции выпадающего фильтра «по менеджеру»: только мои / все / конкретный.
// В списке менеджеров — только ФИО (без префикса «Менеджер:»).
function clientManagerFilterOptions() {
  const cur = clientManagerFilter;
  const sel = (v) => String(cur) === String(v) ? ' selected' : '';
  let html = `<option value="mine"${sel('mine')}>Только мои компании</option>`;
  html += `<option value="all"${sel('all')}>Все компании</option>`;
  users.forEach(u => {
    html += `<option value="${u.id}"${sel(u.id)}>${escapeHtml(u.name || u.login)}</option>`;
  });
  return html;
}

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
    <th>Организация</th><th>Статус</th><th>Направление</th><th>Город</th><th>Телефон</th><th>Почта</th><th>Менеджер</th><th>Сайт</th>
  </tr></thead><tbody>`;
  filtered.forEach(c => {
    const phones = (c.orgPhones || '').split(',').map(p => p.trim()).filter(Boolean);
    const emails = (c.orgEmails || '').split(',').map(e => e.trim()).filter(Boolean);
    const site = normalizeSite(c.orgWebsite);
    const st = clientStatusInfo(c);
    const managerName = clientManagerName(c);
    html += `<tr onclick="selectClient(${c.id})" ondblclick="openClientCard(${c.id})" class="${selectedClientId === c.id ? 'selected' : ''}">
      <td><strong>${escapeHtml(c.orgName)}</strong></td>
      <td><span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:12px;height:12px;background:${st.color};border-radius:2px;display:inline-block;flex-shrink:0;"></span>${escapeHtml(st.label)}</span></td>
      <td>${escapeHtml(c.orgDirection || '—')}</td>
      <td>${escapeHtml(c.orgCity || '—')}</td>
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
      'Направление': c.orgDirection || '—',
      'Город': c.orgCity || '—',
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
  if (countEl) countEl.textContent = contacts.length ? `(${contacts.length})` : '';
  if (addBtn) addBtn.disabled = !editable;

  if (contacts.length === 0) {
    panel.innerHTML = `<div class="empty-state"><p>${editable ? 'Нет контактных лиц.<br>Нажмите «+ Добавить», чтобы создать первое' : 'Нет контактных лиц'}</p></div>
      ${renderHistoryBlock(client, editable)}`;
    return;
  }

  panel.innerHTML = `
    <div class="contact-list table-body">
      <table>
        <thead><tr>
          <th>ФИО</th><th>Должность</th><th>Рабочий тел.</th><th>Сотовый</th><th>Email</th>${editable ? '<th class="col-actions">Действия</th>' : ''}
        </tr></thead>
        <tbody>
          ${contacts.map((ct, idx) => `<tr>
            <td><strong>${escapeHtml(ct.name || '—')}</strong></td>
            <td>${escapeHtml(ct.position || '—')}</td>
            <td>${escapeHtml(ct.phoneWork || '—')}</td>
            <td>${escapeHtml(ct.phoneMobile || '—')}</td>
            <td>${escapeHtml(ct.email || '—')}</td>
            ${editable ? `<td class="col-actions">
              <button class="btn-icon-btn" onclick="editClientContact(${id}, ${idx})" title="Редактировать">✏️</button>
              <button class="btn-icon-btn" onclick="deleteContact(${id}, ${idx})" title="Удалить">🗑️</button>
            </td>` : ''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${renderHistoryBlock(client, editable)}`;
}

// Блок «История взаимодействий» под списком контактных лиц.
// Комментарии выводятся от новых к старым, длинные истории прокручиваются.
function renderHistoryBlock(client, editable) {
  const history = [...(client.history || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  return `
    <div class="client-history-section">
      <div class="section-header">
        <h3>История взаимодействий (${history.length})</h3>
        ${editable !== false ? `<button class="btn btn-sm" onclick="openHistoryModal(${client.id})">+ Добавить</button>` : ''}
      </div>
      ${history.length === 0 ? '<p style="color:#9ca3af;font-size:12px;padding:10px 0">Нет записей</p>' : `
        <div class="history-scroll">
          ${history.map(h => `
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
          `).join('')}
        </div>
      `}
    </div>
  `;
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

  const filteredHistory = historyFilter === 'all' ? history : history.filter(h => h.contactPerson === historyFilter);
  const sortedHistory = [...filteredHistory].sort((a, b) => new Date(b.date) - new Date(a.date));

  let html = `
    <div class="detail-header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <h2>${escapeHtml(client.orgName)}</h2>
          <div class="meta">ID: ${client.id} | ${escapeHtml(client.orgCity || '—')} | ${escapeHtml(client.orgDirection || '—')}</div>
          <div style="margin-top:8px;">
            <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#4b5563;">
              <span style="width:14px;height:14px;background:${st.color};border-radius:2px;display:inline-block;"></span>
              ${escapeHtml(st.label)}
            </span>
            <span style="margin-left:14px;font-size:12px;color:#6b7280;">Менеджер: <strong>${escapeHtml(managerName)}</strong></span>
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-secondary" onclick="openTaskModalWithClient(${client.id})">+ Задача</button>
          <button class="btn btn-sm btn-secondary" onclick="openReminderModal(null, ${client.id})">+ Напоминание</button>
        </div>
      </div>
    </div>
    <div class="detail-section">
      <div class="section-header"><h3>Информация об организации</h3>
        ${editable ? `<button class="btn btn-sm btn-secondary" onclick="openClientModal(clients.find(c=>c.id===${client.id}))">Редактировать</button>` : ''}
      </div>
      <div class="info-grid">
        <div class="info-item"><label>Адрес</label><value>${escapeHtml(client.orgAddress || '—')}</value></div>
        <div class="info-item"><label>Направление</label><value>${escapeHtml(client.orgDirection || '—')}</value></div>
        <div class="info-item"><label>Телефоны</label><value>${phones.length ? phones.map(escapeHtml).join(', ') : '—'}</value></div>
        <div class="info-item"><label>Электронная почта</label><value>${emails.length ? emails.map(e => `<a href="mailto:${escapeHtml(e)}" title="Написать на ${escapeHtml(e)}">${escapeHtml(e)}</a>`).join(', ') : '—'}</value></div>
        <div class="info-item"><label>Сайт</label><value>${site ? `<a href="${site}" target="_blank" rel="noopener">${escapeHtml(client.orgWebsite)}</a>` : '—'}</value></div>
        <div class="info-item"><label>ИНН/ОГРН</label><value>${escapeHtml(client.orgInn || '—')}</value></div>
      </div>
    </div>
    <div class="detail-section">
      <div class="section-header">
        <h3>История взаимодействий (${sortedHistory.length})</h3>
        ${editable ? `<button class="btn btn-sm" onclick="openHistoryModal(${client.id})">+ Добавить</button>` : ''}
      </div>
      <div class="filter-bar">
        <label style="font-size:12px;color:#6b7280">Фильтр:</label>
        <select onchange="changeHistoryFilter(this.value)">
          <option value="all" ${historyFilter === 'all' ? 'selected' : ''}>Все контакты</option>
          ${historyContacts(client).map(ct => `<option value="${escapeHtml(ct)}" ${historyFilter === ct ? 'selected' : ''}>${escapeHtml(ct)}</option>`).join('')}
        </select>
      </div>
      ${sortedHistory.length === 0 ? '<p style="color:#9ca3af;font-size:12px;padding:10px 0">Нет записей</p>' : `
      <div class="scrollable-table history-table">
        <div class="table-header"><table><thead><tr><th style="width:120px">Дата</th><th style="width:130px">Тип</th><th style="width:150px">Контакт</th><th style="width:120px">Менеджер</th><th>Комментарий</th></tr></thead></table></div>
        <div class="table-body"><table><tbody>
          ${sortedHistory.map(h => `<tr>
            <td>${formatDate(h.date)}</td>
            <td><span class="badge">${escapeHtml(h.type)}</span></td>
            <td>${escapeHtml(h.contactPerson || '—')}</td>
            <td>${escapeHtml(h.manager || '—')}</td>
            <td><div class="history-comment">${escapeHtml(h.comment)}</div></td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>`}
    </div>`;
  content.innerHTML = html;
}

function historyContacts(client) {
  return [...new Set((client.history || []).map(h => h.contactPerson).filter(Boolean))];
}

function changeHistoryFilter(value) { historyFilter = value; renderClientCard(cardClientId || selectedClientId); }

function openClientModal(client = null) {
  document.getElementById('clientModalTitle').textContent = client ? 'Редактировать клиента' : 'Новый клиент';
  document.getElementById('clientId').value = client?.id || '';
  document.getElementById('orgName').value = client?.orgName || '';
  document.getElementById('orgCity').value = client?.orgCity || '';
  document.getElementById('orgDirection').value = client?.orgDirection || '';
  document.getElementById('orgAddress').value = client?.orgAddress || '';
  document.getElementById('orgPhones').value = client?.orgPhones || '';
  document.getElementById('orgStatus').value = client?.status || 'cooperation';
  document.getElementById('orgEmails').value = client?.orgEmails || '';
  document.getElementById('orgWebsite').value = client?.orgWebsite || '';
  document.getElementById('orgInn').value = client?.orgInn || '';
  document.getElementById('contactName').value = client?.contactName || '';
  document.getElementById('contactPosition').value = client?.contactPosition || '';
  document.getElementById('contactPhoneWork').value = client?.contactPhoneWork || '';
  document.getElementById('contactPhoneMobile').value = client?.contactPhoneMobile || '';
  document.getElementById('contactEmail').value = client?.contactEmail || '';
  document.getElementById('clientModal').classList.add('active');
}

function saveClient(e) {
  e.preventDefault();
  const id = document.getElementById('clientId').value;
  const data = {
    orgName: document.getElementById('orgName').value.trim(),
    orgCity: document.getElementById('orgCity').value.trim(),
    orgDirection: document.getElementById('orgDirection').value.trim(),
    orgAddress: document.getElementById('orgAddress').value.trim(),
    orgPhones: document.getElementById('orgPhones').value.trim(),
    orgStatus: document.getElementById('orgStatus').value || 'cooperation',
    orgEmails: document.getElementById('orgEmails').value.trim(),
    orgWebsite: document.getElementById('orgWebsite').value.trim(),
    orgInn: document.getElementById('orgInn').value.trim(),
    contactName: document.getElementById('contactName').value.trim(),
    contactPosition: document.getElementById('contactPosition').value.trim(),
    contactPhoneWork: document.getElementById('contactPhoneWork').value.trim(),
    contactPhoneMobile: document.getElementById('contactPhoneMobile').value.trim(),
    contactEmail: document.getElementById('contactEmail').value.trim(),
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
  closeModal('clientModal');
  renderClientsTable();
  if (selectedClientId) renderClientContacts(selectedClientId);
  if (document.getElementById('clientCardModal')?.classList.contains('active')) renderClientCard(cardClientId);
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
    email: document.getElementById('newContactEmail').value.trim()
  };
  
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

/* ===== Форма «Размещение заказа» в комментарии ===== */

let orderCostManual = false; // стоимость вводится вручную (авторасчёт выключен)

function resetOrderForm() {
  const kg = document.getElementById('orderKg');
  const condition = document.getElementById('orderCondition');
  const price = document.getElementById('orderAvgPrice');
  const cost = document.getElementById('orderCost');
  const auto = document.getElementById('orderAutoCalc');
  if (kg) kg.value = '';
  if (condition) condition.value = '';
  if (price) price.value = '';
  if (cost) { cost.value = ''; cost.disabled = true; }
  if (auto) auto.checked = true;
  orderCostManual = false;
}

// Показываем/скрываем блок параметров заказа при выборе типа.
function onHistoryTypeChange() {
  const section = document.getElementById('orderFormSection');
  const isOrder = document.getElementById('historyType').value === 'Размещение заказа';
  if (section) section.style.display = isOrder ? 'block' : 'none';
}

// Автопересчёт стоимости: Кол-во кг × Средняя цена.
function recalcOrderCost() {
  if (orderCostManual) return;
  const kg = parseFloat(document.getElementById('orderKg').value);
  const price = parseFloat(document.getElementById('orderAvgPrice').value);
  const costEl = document.getElementById('orderCost');
  costEl.value = (kg && price) ? Math.round((kg * price) * 100) / 100 : '';
}

function onOrderAutoCalcToggle() {
  orderCostManual = !document.getElementById('orderAutoCalc').checked;
  const costEl = document.getElementById('orderCost');
  costEl.disabled = orderCostManual;
  if (!orderCostManual) recalcOrderCost();
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

  // «Размещение заказа»: собираем параметры, формируем текст комментария
  // и создаём запись в модуле «Заказы».
  if (type === 'Размещение заказа') {
    const kgRaw = document.getElementById('orderKg').value;
    const condition = document.getElementById('orderCondition').value.trim();
    const priceRaw = document.getElementById('orderAvgPrice').value;
    const costRaw = document.getElementById('orderCost').value;

    const kg = kgRaw === '' ? null : Number(kgRaw);
    const avgPrice = priceRaw === '' ? null : Number(priceRaw);
    const cost = costRaw === '' ? null : Number(costRaw);

    orderData = { kg, condition, avgPrice, cost };

    const parts = [
      'Кол-во кг — ' + (kg === null ? '—' : fmtKg(kg)),
      'Состояние — ' + (condition || '—'),
      'Средняя цена — ' + (avgPrice === null ? '—' : fmtMoney(avgPrice)),
      'Стоимость заказа — ' + (cost === null ? '—' : fmtMoney(cost))
    ];
    const autoComment = 'Размещение заказа: ' + parts.join(', ');
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
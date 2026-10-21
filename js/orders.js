/* ============================================================
   js/orders.js — раздел «Заказы/Матрицы», вкладка «Заказы».

   Раздел состоит из двух вкладок: «Заказы» (этот файл, старая система) и
   «Матрицы» (js/matrices.js). Внутри вкладки — фильтры, анализ продаж за
   период и таблица.

   Запись заказа появляется автоматически, когда в комментарии к клиенту
   выбирается тип «Размещение заказа» и заполняются параметры (кол-во кг,
   состояние поставки, общая стоимость, стоимость за кг).

   Права: менеджер видит только свои заказы, администратор — все или заказы
   конкретного пользователя; у нового аккаунта вкладка пуста. Экспорт в Excel
   доступен только администратору. Фильтры: по клиенту, по покрытию и по
   периоду (анализ продаж).
   ============================================================ */

let orders = [];

const ORDERS_KEY = 'alvid_crm_orders';

// Ключ сопоставления заказа со срезом готовности: номер СП без пробелов
// в верхнем регистре. Точки и дефисы сохраняются («СП2125.1», «Б/С-2»).
function normalizeSpecificationKey(value) {
  return String(value == null ? '' : value).replace(/\s+/g, '').toUpperCase();
}

function orderSpecificationKey(order) {
  if (!order) return '';
  return normalizeSpecificationKey(order.specificationKey || order.specification);
}

// Состояние фильтров раздела.
let ordersClientFilter = '';        // id клиента или ''
let ordersCoverageFilter = '';      // состояние поставки (покрытие) или ''
let ordersUserFilter = 'all';       // для администратора: 'all' или id пользователя
let ordersDateFrom = null;
let ordersDateTo = null;

function loadOrders() {
  const saved = localStorage.getItem(ORDERS_KEY);
  orders = saved ? JSON.parse(saved) : [];
  if (!Array.isArray(orders)) orders = [];
}

function saveOrders() {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  queueServerSave();
}

// Форматирование денежных сумм: 12 345,50
function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(n);
}

// Форматирование веса: 1 200 (без дробной части, если она нулевая)
function fmtKg(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(n);
}

// Создание записи заказа (вызывается из saveHistory в js/clients.js).
function addOrder(data) {
  const maxId = orders.reduce((m, o) => Math.max(m, o.id || 0), 0);
  const order = {
    id: maxId + 1,
    clientId: data.clientId || null,
    clientName: (data.clientName || '').trim(),
    kg: data.kg !== undefined && data.kg !== null && data.kg !== '' ? Number(data.kg) : null,
    condition: (data.condition || '').trim(),
    avgPrice: data.avgPrice !== undefined && data.avgPrice !== null && data.avgPrice !== '' ? Number(data.avgPrice) : null,
    cost: data.cost !== undefined && data.cost !== null && data.cost !== '' ? Number(data.cost) : null,
    date: data.date || new Date().toISOString(),
    createdBy: data.createdBy !== undefined ? data.createdBy : (currentUser ? currentUser.id : null),
    comment: (data.comment || '').trim(),
    // Номер спецификации (СП) — по нему заказ сопоставляется со срезом готовности.
    specification: (data.specification || '').trim(),
    specificationKey: normalizeSpecificationKey(data.specification)
  };
  orders.push(order);
  saveOrders();
  return order;
}

// Проставить или изменить номер СП у существующего заказа (админ или автор).
function setOrderSpecification(orderId, value) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return { ok: false, error: 'Заказ не найден' };
  if (!isAdmin() && (!currentUser || order.createdBy !== currentUser.id)) {
    return { ok: false, error: 'Менять номер СП чужого заказа может только администратор' };
  }
  order.specification = String(value == null ? '' : value).trim();
  order.specificationKey = normalizeSpecificationKey(order.specification);
  saveOrders();
  if (typeof refreshReadinessForVisibleOrders === 'function') refreshReadinessForVisibleOrders();
  return { ok: true, specification: order.specification, key: order.specificationKey };
}

// Правка номера СП прямо в таблице заказов.
function editOrderSpecification(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  const current = order.specification || '';
  const value = prompt('Номер спецификации (СП) для заказа:', current);
  if (value === null) return;
  const res = setOrderSpecification(orderId, value);
  if (!res.ok) { alert(res.error); return; }
  renderOrdersTab();
}

/* ===== Права и фильтры ===== */

// Менеджер видит только свои заказы; администратор — все
// или заказы выбранного пользователя.
function visibleOrders() {
  if (!currentUser) return [];
  if (isAdmin()) {
    if (ordersUserFilter !== 'all') {
      const uid = parseInt(ordersUserFilter, 10);
      return orders.filter(o => o.createdBy === uid);
    }
    return orders;
  }
  return orders.filter(o => o.createdBy === currentUser.id);
}

// Период анализа продаж: сравниваем дату (YYYY-MM-DD).
function orderInPeriod(order) {
  if (!ordersDateFrom && !ordersDateTo) return true;
  const day = String(order.date || '').slice(0, 10);
  if (!day) return true;
  if (ordersDateFrom && day < ordersDateFrom) return false;
  if (ordersDateTo && day > ordersDateTo) return false;
  return true;
}

function filteredOrders() {
  return visibleOrders()
    .filter(orderInPeriod)
    .filter(o => !ordersClientFilter || String(o.clientId) === String(ordersClientFilter))
    .filter(o => !ordersCoverageFilter || (o.condition || '') === ordersCoverageFilter);
}

function setOrdersFilter(kind, value) {
  if (kind === 'client') ordersClientFilter = value || '';
  else if (kind === 'coverage') ordersCoverageFilter = value || '';
  else if (kind === 'user') ordersUserFilter = value || 'all';
  else if (kind === 'from') ordersDateFrom = value || null;
  else if (kind === 'to') ordersDateTo = value || null;
  renderOrders();
}

function setOrdersPeriodToday() {
  const today = new Date().toISOString().split('T')[0];
  ordersDateFrom = today;
  ordersDateTo = today;
  renderOrders();
}

// «Месяц»: показать заказы за текущий календарный месяц.
function ordersMonthBounds() {
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  return {
    from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  };
}

function setOrdersPeriodMonth() {
  const range = ordersMonthBounds();
  ordersDateFrom = range.from;
  ordersDateTo = range.to;
  renderOrders();
}

function ordersMonthFilterActive() {
  const range = ordersMonthBounds();
  return ordersDateFrom === range.from && ordersDateTo === range.to;
}

function resetOrdersFilters() {
  ordersClientFilter = '';
  ordersCoverageFilter = '';
  ordersUserFilter = 'all';
  ordersDateFrom = null;
  ordersDateTo = null;
  renderOrders();
}

// Покрытия: справочные состояния плюс те, что встречаются в заказах,
// чтобы старые записи с нестандартным состоянием тоже фильтровались.
function orderCoverageOptions() {
  const list = ORDER_CONDITIONS.slice();
  visibleOrders().forEach(o => {
    const c = (o.condition || '').trim();
    if (c && list.indexOf(c) === -1) list.push(c);
  });
  return list;
}

// Клиенты, по которым есть видимые заказы.
function orderClientOptions() {
  const map = {};
  visibleOrders().forEach(o => {
    if (o.clientId) map[o.clientId] = o.clientName || ('Клиент #' + o.clientId);
  });
  return Object.keys(map)
    .map(id => ({ id: id, name: map[id] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/* ===== Поиск клиента с автокомплитом (фильтр вкладки «Заказы») ===== */

function orderClientFilterPickerHtml() {
  const selected = ordersClientFilter
    ? clients.find(c => String(c.id) === String(ordersClientFilter))
    : null;
  return `
    <label>Клиент
      <span class="client-typeahead-group" style="display:inline-block;">
        <input type="text" id="orderClientFilterInput" autocomplete="off" placeholder="Все клиенты"
               style="width:200px;box-sizing:border-box;" value="${escapeHtml(selected ? (selected.orgName || '') : '')}"
               oninput="onOrderClientFilterInput(this.value)" onfocus="onOrderClientFilterInput(this.value)">
        <div class="client-typeahead-dropdown" id="orderClientFilterDropdown"></div>
      </span>
    </label>`;
}

function onOrderClientFilterInput(query) {
  const dd = document.getElementById('orderClientFilterDropdown');
  if (!dd) return;
  const q = String(query || '').trim().toLowerCase();
  const list = clients
    .filter(c => !q || String(c.orgName || '').toLowerCase().includes(q))
    .slice(0, 30);
  dd.innerHTML = list.length
    ? list.map(c => `<div class="client-typeahead-item" data-id="${c.id}" data-name="${escapeHtml(c.orgName || '')}">${escapeHtml(c.orgName || ('Клиент #' + c.id))}</div>`).join('')
    : '<div class="client-typeahead-item" style="color:#9ca3af;cursor:default;">Ничего не найдено</div>';
  dd.style.display = 'block';
}

function selectOrdersClientFilter(id, name) {
  const dd = document.getElementById('orderClientFilterDropdown');
  if (dd) dd.style.display = 'none';
  ordersClientFilter = id != null ? String(id) : '';
  renderOrders();
}

/* ===== Редактирование заказа (П.26) ===== */

// Менеджер правит только свои заказы; администратор, руководитель и
// разработчик — любые.
function canEditOrder(order) {
  if (!currentUser || !order) return false;
  return isAdmin() || isLead() || order.createdBy === currentUser.id;
}

let selectedOrderEditClientId = null;

function orderConditionOptionsHtml(selected) {
  const list = ORDER_CONDITIONS.slice();
  const s = String(selected || '').trim();
  if (s && list.indexOf(s) === -1) list.push(s);
  return list.map(v => `<option value="${escapeHtml(v)}"${v === s ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

function openOrderEditModal(orderId) {
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  if (!canEditOrder(o)) {
    alert('Редактировать чужой заказ может только администратор или руководитель.');
    return;
  }
  document.getElementById('orderEditId').value = o.id;
  selectedOrderEditClientId = o.clientId || null;
  document.getElementById('orderEditClientSearch').value = o.clientName || '';
  document.getElementById('orderEditKg').value = o.kg === null || o.kg === undefined ? '' : o.kg;
  document.getElementById('orderEditCondition').innerHTML = orderConditionOptionsHtml(o.condition);
  document.getElementById('orderEditCost').value = o.cost === null || o.cost === undefined ? '' : o.cost;
  document.getElementById('orderEditSpecification').value = o.specification || '';
  updateOrderEditPrice();
  const title = document.getElementById('orderEditModalTitle');
  if (title) title.textContent = 'Редактировать заказ №' + o.id;
  document.getElementById('orderEditModal').classList.add('active');
}

// Стоимость за кг пересчитывается на лету: общая стоимость / кол-во кг.
function updateOrderEditPrice() {
  const kg = document.getElementById('orderEditKg').value;
  const cost = document.getElementById('orderEditCost').value;
  const el = document.getElementById('orderEditPricePerKg');
  if (!el) return;
  const perKg = orderPricePerKg(kg, cost);
  el.textContent = perKg === null ? '—' : fmtMoney(perKg);
}

function onOrderEditClientInput(query) {
  const dd = document.getElementById('orderEditClientDropdown');
  if (!dd) return;
  const q = String(query || '').trim().toLowerCase();
  const list = clients
    .filter(c => !q || String(c.orgName || '').toLowerCase().includes(q))
    .slice(0, 30);
  dd.innerHTML = list.length
    ? list.map(c => `<div class="client-typeahead-item" data-id="${c.id}" data-name="${escapeHtml(c.orgName || '')}">${escapeHtml(c.orgName || ('Клиент #' + c.id))}</div>`).join('')
    : '<div class="client-typeahead-item" style="color:#9ca3af;cursor:default;">Ничего не найдено</div>';
  dd.style.display = 'block';
}

function selectOrderEditClient(id, name) {
  selectedOrderEditClientId = id != null ? id : null;
  const dd = document.getElementById('orderEditClientDropdown');
  if (dd) dd.style.display = 'none';
  const input = document.getElementById('orderEditClientSearch');
  if (input) input.value = name || '';
}

function saveOrderFromModal(e) {
  if (e && e.preventDefault) e.preventDefault();
  const id = parseInt(document.getElementById('orderEditId').value, 10);
  const o = orders.find(x => x.id === id);
  if (!o) { alert('Заказ не найден'); return; }
  if (!canEditOrder(o)) {
    alert('Редактировать чужой заказ может только администратор или руководитель.');
    return;
  }

  const kgRaw = String(document.getElementById('orderEditKg').value || '').trim();
  const costRaw = String(document.getElementById('orderEditCost').value || '').trim();
  const kg = kgRaw === '' ? null : Number(kgRaw);
  const cost = costRaw === '' ? null : Number(costRaw);
  if (kg !== null && !isFinite(kg)) { alert('Укажите корректное кол-во кг'); return; }
  if (cost !== null && !isFinite(cost)) { alert('Укажите корректную стоимость'); return; }

  const nameRaw = String(document.getElementById('orderEditClientSearch').value || '').trim();
  const client = selectedOrderEditClientId
    ? clients.find(c => c.id === selectedOrderEditClientId)
    : null;

  o.clientId = client ? client.id : null;
  o.clientName = client ? (client.orgName || '') : nameRaw;
  o.kg = kg;
  o.cost = cost;
  o.avgPrice = orderPricePerKg(kg, cost);
  o.condition = document.getElementById('orderEditCondition').value;
  o.specification = String(document.getElementById('orderEditSpecification').value || '').trim();
  o.specificationKey = normalizeSpecificationKey(o.specification);

  saveOrders();
  closeModal('orderEditModal');
  renderOrders();
  if (typeof refreshReadinessForVisibleOrders === 'function') refreshReadinessForVisibleOrders();
}

/* ===== Раздел «Заказы» ===== */

/* ===== Раздел «Заказы/Матрицы» =====
   Внутри два независимых списка: «Заказы» (старая система) и «Матрицы»
   (js/matrices.js). У каждой вкладки свои фильтры, и права у обеих одинаковые:
   менеджер видит только свои записи, администратор — все или записи
   выбранного пользователя. У нового аккаунта раздел пуст. */

let ordersTab = 'orders';   // 'orders' | 'matrices'

function renderOrders() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  main.innerHTML = `
    <div class="orders-page">
      <div class="orders-head">
        <h1>Заказы/Матрицы</h1>
      </div>
      <div class="section-tabs">
        <button class="btn ${ordersTab === 'orders' ? '' : 'btn-secondary'}" onclick="setOrdersTab('orders')">Заказы</button>
        <button class="btn ${ordersTab === 'matrices' ? '' : 'btn-secondary'}" onclick="setOrdersTab('matrices')">Матрицы</button>
      </div>
      <div id="ordersTabBody"></div>
    </div>
  `;

  if (ordersTab === 'matrices' && typeof renderMatricesTab === 'function') renderMatricesTab();
  else renderOrdersTab();
}

function setOrdersTab(tab) {
  ordersTab = (tab === 'matrices') ? 'matrices' : 'orders';
  renderOrders();
}

/* ===== Вкладка «Заказы» ===== */

function renderOrdersTab() {
  const host = document.getElementById('ordersTabBody');
  if (!host) return;

  const list = filteredOrders();
  const sorted = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
  // Считаем по доступным пользователю заказам, а не по общей базе:
  // у нового аккаунта база не пуста, но его собственных заказов нет.
  const myOrders = visibleOrders();

  const totalKg = list.reduce((s, o) => s + (Number(o.kg) || 0), 0);
  const totalSum = list.reduce((s, o) => s + (Number(o.cost) || 0), 0);
  const periodSet = !!(ordersDateFrom || ordersDateTo);
  const filtersSet = periodSet || !!ordersClientFilter || !!ordersCoverageFilter || ordersUserFilter !== 'all';

  const coverageOpts = orderCoverageOptions().map(c =>
    `<option value="${escapeHtml(c)}"${ordersCoverageFilter === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
  const userOpts = users.map(u =>
    `<option value="${u.id}"${String(ordersUserFilter) === String(u.id) ? ' selected' : ''}>${escapeHtml(u.name || u.login)}</option>`).join('');

  host.innerHTML = `
      <div class="orders-filters">
        ${isAdmin() ? `
          <label>Пользователь
            <select onchange="setOrdersFilter('user', this.value)">
              <option value="all"${ordersUserFilter === 'all' ? ' selected' : ''}>Все пользователи</option>
              ${userOpts}
            </select>
          </label>` : ''}
        ${orderClientFilterPickerHtml()}
        <label>Покрытие
          <select onchange="setOrdersFilter('coverage', this.value)">
            <option value="">Все покрытия</option>
            ${coverageOpts}
          </select>
        </label>
        <label>Период с
          <input type="date" value="${escapeHtml(ordersDateFrom || '')}" onchange="setOrdersFilter('from', this.value)">
        </label>
        <label>по
          <input type="date" value="${escapeHtml(ordersDateTo || '')}" onchange="setOrdersFilter('to', this.value)">
        </label>
        <button class="btn btn-sm btn-secondary" onclick="setOrdersPeriodToday()">Сегодня</button>
        <button class="btn btn-sm ${ordersMonthFilterActive() ? '' : 'btn-secondary'}" onclick="setOrdersPeriodMonth()" title="Показать заказы за текущий месяц">Месяц</button>
        ${filtersSet ? '<button class="btn btn-sm btn-secondary" onclick="resetOrdersFilters()">Сбросить</button>' : ''}
        ${isAdmin() ? '<button class="btn btn-sm" onclick="exportOrdersExcel()">Экспорт заказов в Excel</button>' : ''}
      </div>

      <h3 class="orders-analysis-title">Анализ продаж${periodSet ? ' за период' : ''}</h3>
      <div class="readiness-snapshot">
        ${typeof readinessAvailable === 'function' && readinessAvailable()
          ? `Готовность: ${escapeHtml(readinessAsOfText())} · спецификаций в срезе: ${readinessStatus.count}`
          : 'Готовность: срез не загружен — администратор загружает утренний файл в разделе «Администрирование → Готовность»'}
      </div>
      <div class="orders-stats">
        <div class="stat-card"><div class="stat-value" style="color:#1a3a5c">${list.length}</div><div class="stat-label">Всего заказов</div></div>
        <div class="stat-card"><div class="stat-value" style="color:#3b82f6">${fmtKg(totalKg)}</div><div class="stat-label">Суммарный вес, кг</div></div>
        <div class="stat-card"><div class="stat-value" style="color:#10b981">${fmtMoney(totalSum)}</div><div class="stat-label">Общая сумма</div></div>
      </div>

      ${sorted.length === 0 ? `
        <div class="empty-state" style="padding:60px 20px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
          <p>${myOrders.length === 0 ? 'Заказов пока нет.' : 'По выбранным фильтрам заказов нет.'}</p>
          ${myOrders.length === 0 ? `<p style="font-size:12px;color:#9ca3af;margin-top:6px;">
            Добавьте комментарий клиенту с типом «Размещение заказа» — заказ появится здесь автоматически.
          </p>` : ''}
        </div>
      ` : `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;">
          <div class="table-body" style="max-height:calc(100vh - 430px);">
            <table class="admin-table">
              <thead><tr>
                <th>Дата заказа</th><th>Клиент</th><th>Кол-во кг</th><th>Состояние</th>${isAdmin() ? '<th>Менеджер</th>' : ''}<th>Стоимость за кг</th><th>Стоимость заказа</th><th>СП</th><th>Готовность</th><th style="text-align:right;">Действия</th>
              </tr></thead>
              <tbody>
                ${sorted.map(o => {
                  const clientLink = o.clientId
                    ? `<a href="#" onclick="event.preventDefault();goToClient(${o.clientId});">${escapeHtml(o.clientName || '—')}</a>`
                    : escapeHtml(o.clientName || '—');
                  const owner = o.createdBy ? findUserById(o.createdBy) : null;
                  const canDelete = isAdmin() || (currentUser && o.createdBy === currentUser.id);
                  const canEditSpec = isAdmin() || (currentUser && o.createdBy === currentUser.id);
                  return `<tr style="cursor:default;">
                    <td>${formatDateAdmin2(o.date)}</td>
                    <td>${clientLink}</td>
                    <td>${fmtKg(o.kg)}</td>
                    <td>${escapeHtml(o.condition || '—')}</td>
                    ${isAdmin() ? `<td>${escapeHtml(owner ? (owner.name || owner.login) : '—')}</td>` : ''}
                    <td>${fmtMoney(o.avgPrice)}</td>
                    <td><strong>${fmtMoney(o.cost)}</strong></td>
                    <td>${orderSpecificationCellHtml(o, canEditSpec)}</td>
                    <td>${orderReadinessCellHtml(o)}</td>
                    <td style="text-align:right;white-space:nowrap;">
                      ${canEditOrder(o) ? `<button class="btn-icon-btn" onclick="openOrderEditModal(${o.id})" title="Редактировать заказ">Изменить</button>` : ''}
                      ${canDelete ? `<button class="btn-icon-btn" onclick="deleteOrder(${o.id})" title="Удалить заказ">Удалить</button>` : ''}
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `}
  `;

  // Готовность подтягивается отдельным запросом: только по СП видимых заказов.
  if (typeof refreshReadinessForVisibleOrders === 'function') refreshReadinessForVisibleOrders();
}

function formatDateAdmin2(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function deleteOrder(id) {
  const order = orders.find(o => o.id === id);
  if (!order) return;
  // Удалять заказ может администратор или его автор.
  if (!isAdmin() && (!currentUser || order.createdBy !== currentUser.id)) {
    alert('Удалять чужие заказы может администратор.');
    return;
  }
  if (!confirm('Удалить заказ?')) return;
  orders = orders.filter(o => o.id !== id);
  saveOrders();
  renderOrders();
}

// Экспорт в Excel — только администратор; выгружается текущая выборка
// с учётом фильтров и периода.
function exportOrdersExcel() {
  if (!isAdmin()) { alert('Экспорт заказов доступен администратору.'); return; }
  if (typeof XLSX === 'undefined') {
    alert('Библиотека экспорта Excel не загружена.');
    return;
  }
  const list = filteredOrders().sort((a, b) => new Date(b.date) - new Date(a.date));
  const rows = list.map(o => {
    const owner = o.createdBy ? findUserById(o.createdBy) : null;
    const readiness = typeof readinessForOrder === 'function' ? readinessForOrder(o) : null;
    return {
      'Дата заказа': formatDateAdmin2(o.date),
      'Клиент': o.clientName || '—',
      'Кол-во кг': o.kg !== null && o.kg !== undefined ? o.kg : '—',
      'Состояние': o.condition || '—',
      'Менеджер': owner ? (owner.name || owner.login) : '—',
      'Стоимость за кг': o.avgPrice !== null && o.avgPrice !== undefined ? o.avgPrice : '—',
      'Стоимость заказа': o.cost !== null && o.cost !== undefined ? o.cost : '—',
      'СП': o.specification || '—',
      'Готовность, %': readiness && readiness.readiness != null ? readiness.readiness : '—',
      'Обеспечено, кол-во (отпрессовано)': readiness && readiness.stockQty != null ? readiness.stockQty : '—',
      'План, кол-во': readiness && readiness.planQty != null ? readiness.planQty : '—',
      'Статус готовности': readiness ? readiness.status : 'нет данных',
      'Плановая дата готовности': readiness ? (readiness.planReadyDate || '—') : '—'
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Заказы');
  const today = new Date().toISOString().split('T')[0];
  const period = (ordersDateFrom || ordersDateTo) ? `_${ordersDateFrom || ''}_${ordersDateTo || ''}` : '';
  XLSX.writeFile(wb, `Заказы${period}_${today}.xlsx`);
}

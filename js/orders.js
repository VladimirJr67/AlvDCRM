/* ============================================================
   js/orders.js — модуль «Заказы».

   Запись появляется автоматически, когда в комментарии к клиенту выбирается
   тип «Размещение заказа» и заполняются параметры (кол-во кг, состояние
   поставки, общая стоимость, стоимость за кг).

   Права: менеджер видит только свои заказы, администратор — все или заказы
   конкретного пользователя. Экспорт в Excel доступен администратору.
   Фильтры: по клиенту, по покрытию и по периоду (анализ продаж).
   ============================================================ */

let orders = [];

const ORDERS_KEY = 'alvid_crm_orders';

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
    comment: (data.comment || '').trim()
  };
  orders.push(order);
  saveOrders();
  return order;
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

/* ===== Раздел «Заказы» ===== */

function renderOrders() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  const list = filteredOrders();
  const sorted = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
  // Считаем по доступным пользователю заказам, а не по общей базе:
  // у нового аккаунта база не пуста, но его собственных заказов нет.
  const myOrders = visibleOrders();

  const totalKg = list.reduce((s, o) => s + (Number(o.kg) || 0), 0);
  const totalSum = list.reduce((s, o) => s + (Number(o.cost) || 0), 0);
  const periodSet = !!(ordersDateFrom || ordersDateTo);
  const filtersSet = periodSet || !!ordersClientFilter || !!ordersCoverageFilter || ordersUserFilter !== 'all';

  const clientOpts = orderClientOptions().map(c =>
    `<option value="${c.id}"${String(ordersClientFilter) === String(c.id) ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  const coverageOpts = orderCoverageOptions().map(c =>
    `<option value="${escapeHtml(c)}"${ordersCoverageFilter === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
  const userOpts = users.map(u =>
    `<option value="${u.id}"${String(ordersUserFilter) === String(u.id) ? ' selected' : ''}>${escapeHtml(u.name || u.login)}</option>`).join('');

  main.innerHTML = `
    <div class="orders-page">
      <div class="orders-head">
        <h1>Заказы</h1>
        ${isAdmin() ? '<button class="btn" onclick="exportOrdersExcel()">Экспорт в Excel</button>' : ''}
      </div>

      <div class="orders-filters">
        ${isAdmin() ? `
          <label>Пользователь
            <select onchange="setOrdersFilter('user', this.value)">
              <option value="all"${ordersUserFilter === 'all' ? ' selected' : ''}>Все пользователи</option>
              ${userOpts}
            </select>
          </label>` : ''}
        <label>Клиент
          <select onchange="setOrdersFilter('client', this.value)">
            <option value="">Все клиенты</option>
            ${clientOpts}
          </select>
        </label>
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
        ${filtersSet ? '<button class="btn btn-sm btn-secondary" onclick="resetOrdersFilters()">Сбросить</button>' : ''}
      </div>

      <h3 class="orders-analysis-title">Анализ продаж${periodSet ? ' за период' : ''}</h3>
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
                <th>Дата заказа</th><th>Клиент</th><th>Кол-во кг</th><th>Состояние</th>${isAdmin() ? '<th>Менеджер</th>' : ''}<th>Стоимость за кг</th><th>Стоимость заказа</th><th style="text-align:right;">Действия</th>
              </tr></thead>
              <tbody>
                ${sorted.map(o => {
                  const clientLink = o.clientId
                    ? `<a href="#" onclick="event.preventDefault();goToClient(${o.clientId});">${escapeHtml(o.clientName || '—')}</a>`
                    : escapeHtml(o.clientName || '—');
                  const owner = o.createdBy ? findUserById(o.createdBy) : null;
                  const canDelete = isAdmin() || (currentUser && o.createdBy === currentUser.id);
                  return `<tr style="cursor:default;">
                    <td>${formatDateAdmin2(o.date)}</td>
                    <td>${clientLink}</td>
                    <td>${fmtKg(o.kg)}</td>
                    <td>${escapeHtml(o.condition || '—')}</td>
                    ${isAdmin() ? `<td>${escapeHtml(owner ? (owner.name || owner.login) : '—')}</td>` : ''}
                    <td>${fmtMoney(o.avgPrice)}</td>
                    <td><strong>${fmtMoney(o.cost)}</strong></td>
                    <td style="text-align:right;white-space:nowrap;">
                      ${canDelete ? `<button class="btn-icon-btn" onclick="deleteOrder(${o.id})" title="Удалить заказ">🗑</button>` : ''}
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `}
    </div>
  `;
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
    return {
      'Дата заказа': formatDateAdmin2(o.date),
      'Клиент': o.clientName || '—',
      'Кол-во кг': o.kg !== null && o.kg !== undefined ? o.kg : '—',
      'Состояние': o.condition || '—',
      'Менеджер': owner ? (owner.name || owner.login) : '—',
      'Стоимость за кг': o.avgPrice !== null && o.avgPrice !== undefined ? o.avgPrice : '—',
      'Стоимость заказа': o.cost !== null && o.cost !== undefined ? o.cost : '—'
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Заказы');
  const today = new Date().toISOString().split('T')[0];
  const period = (ordersDateFrom || ordersDateTo) ? `_${ordersDateFrom || ''}_${ordersDateTo || ''}` : '';
  XLSX.writeFile(wb, `Заказы${period}_${today}.xlsx`);
}

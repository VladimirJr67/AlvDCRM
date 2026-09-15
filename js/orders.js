/* ============================================================
   js/orders.js — модуль «Заказы».
   Запись появляется автоматически, когда в комментарии к клиенту
   выбирается тип «Размещение заказа» и заполняются параметры
   (кол-во кг, состояние, средняя цена, стоимость). Внизу — базовые
   агрегаты: количество заказов, суммарный вес, общая сумма, средний чек.
   ============================================================ */

let orders = [];

const ORDERS_KEY = 'alvid_crm_orders';

function loadOrders() {
  const saved = localStorage.getItem(ORDERS_KEY);
  orders = saved ? JSON.parse(saved) : [];
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

function deleteOrder(id) {
  if (!confirm('Удалить заказ?')) return;
  orders = orders.filter(o => o.id !== id);
  saveOrders();
  renderOrders();
}

function renderOrders() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  const sorted = [...orders].sort((a, b) => new Date(b.date) - new Date(a.date));
  const totalKg = orders.reduce((s, o) => s + (Number(o.kg) || 0), 0);
  const totalSum = orders.reduce((s, o) => s + (Number(o.cost) || 0), 0);
  const avgCheck = orders.length ? totalSum / orders.length : 0;

  main.innerHTML = `
    <div style="padding:25px;max-width:1100px;margin:0 auto;height:100%;box-sizing:border-box;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">Заказы</h1>
        <button class="btn" onclick="exportOrdersExcel()">⬇ Экспорт в Excel</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:25px;">
        <div class="stat-card"><div class="stat-value" style="color:#1a3a5c">${orders.length}</div><div class="stat-label">Всего заказов</div></div>
        <div class="stat-card"><div class="stat-value" style="color:#3b82f6">${fmtKg(totalKg)}</div><div class="stat-label">Суммарный вес, кг</div></div>
        <div class="stat-card"><div class="stat-value" style="color:#10b981">${fmtMoney(totalSum)}</div><div class="stat-label">Общая сумма</div></div>
        <div class="stat-card"><div class="stat-value" style="color:#f59e0b">${fmtMoney(avgCheck)}</div><div class="stat-label">Средний чек</div></div>
      </div>

      ${sorted.length === 0 ? `
        <div class="empty-state" style="padding:60px 20px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
          <p>Заказов пока нет.</p>
          <p style="font-size:12px;color:#9ca3af;margin-top:6px;">Добавьте комментарий клиенту с типом «Размещение заказа» — заказ появится здесь автоматически.</p>
        </div>
      ` : `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;">
          <div class="table-body" style="max-height:calc(100vh - 320px);">
            <table class="admin-table">
              <thead><tr>
                <th>Дата заказа</th><th>Клиент</th><th>Кол-во кг</th><th>Состояние</th><th>Средняя цена</th><th>Стоимость заказа</th><th style="text-align:right;">Действия</th>
              </tr></thead>
              <tbody>
                ${sorted.map(o => {
                  const clientLink = o.clientId
                    ? `<a href="#" onclick="event.preventDefault();goToClient(${o.clientId});">${escapeHtml(o.clientName || '—')}</a>`
                    : escapeHtml(o.clientName || '—');
                  return `<tr style="cursor:default;">
                    <td>${formatDateAdmin2(o.date)}</td>
                    <td>${clientLink}</td>
                    <td>${fmtKg(o.kg)}</td>
                    <td>${escapeHtml(o.condition || '—')}</td>
                    <td>${fmtMoney(o.avgPrice)}</td>
                    <td><strong>${fmtMoney(o.cost)}</strong></td>
                    <td style="text-align:right;white-space:nowrap;">
                      <button class="btn-icon-btn" onclick="deleteOrder(${o.id})" title="Удалить заказ">🗑</button>
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

// Экспорт всех заказов в Excel (XLSX).
function exportOrdersExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Библиотека экспорта Excel не загружена.');
    return;
  }
  const rows = orders.map(o => ({
    'Дата заказа': formatDateAdmin2(o.date),
    'Клиент': o.clientName || '—',
    'Кол-во кг': o.kg !== null && o.kg !== undefined ? o.kg : '—',
    'Состояние': o.condition || '—',
    'Средняя цена': o.avgPrice !== null && o.avgPrice !== undefined ? o.avgPrice : '—',
    'Стоимость заказа': o.cost !== null && o.cost !== undefined ? o.cost : '—'
  }));
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Заказы');
  const today = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `Заказы_${today}.xlsx`);
}

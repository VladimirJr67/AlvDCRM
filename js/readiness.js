/* ============================================================
   js/readiness.js — «Готовность» по спецификациям (СП).

   Администратор каждое утро загружает в CRM JSON-документ из инструмента
   «Готовность» (формат — Спецификация_формата_для_CRM.md, схема v1). Сервер
   хранит срез целиком и отдаёт его по запросу; браузер забирает только те СП,
   которые есть в его списке заказов, и рисует рядом с заказом колонку
   готовности, а по клику — карточку с позициями.

   Сопоставление — по specificationKey заказа (номер СП без пробелов в верхнем
   регистре). Новые заказы из готовности не создаются: срез только дополняет
   уже размещённые заказы, поэтому права менеджеров остаются прежними.
   ============================================================ */

let readinessStatus = null;      // состояние среза: дата, файл, счётчики
let readinessByKey = {};         // { КЛЮЧ: заказ из среза }
let readinessLookupKey = '';     // какие ключи уже запрошены — чтобы не дёргать сервер зря
let readinessLoading = false;

// Статусы из словаря спецификации. statusCode — для логики и цвета.
const READINESS_STATUS_INFO = {
  shipped: { label: 'Отгружено', color: '#10b981' },
  ready: { label: 'Готово к отгрузке', color: '#22c55e' },
  in_progress: { label: 'В работе', color: '#f59e0b' },
  not_started: { label: 'Не начато', color: '#9ca3af' },
  no_plan: { label: 'Без плана', color: '#6b7280' }
};

function readinessStatusInfo(code) {
  return READINESS_STATUS_INFO[code] || { label: '—', color: '#9ca3af' };
}

function readinessAvailable() {
  return !!(readinessStatus && readinessStatus.available);
}

// Запись среза по заказу (или null, если данных нет).
function readinessForOrder(order) {
  const key = (typeof orderSpecificationKey === 'function') ? orderSpecificationKey(order) : '';
  return key ? (readinessByKey[key] || null) : null;
}

function formatReadinessDate(value) {
  const s = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const parts = s.split('-');
  return parts[2] + '.' + parts[1] + '.' + parts[0];
}

// Готовность в процентах: null — плана нет, показываем «—», а не 0 %.
function readinessPercentText(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!isFinite(n)) return '—';
  return (Math.round(n * 10) / 10).toLocaleString('ru-RU') + ' %';
}

function readinessNumberText(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

// «данные на 18.09.2026 (не обновлялись 3 дня)» — срез старше суток помечаем.
function readinessAsOfText() {
  if (!readinessAvailable()) return 'срез готовности не загружен';
  const asOf = formatReadinessDate(readinessStatus.asOfDate);
  const age = readinessStatus.ageDays;
  if (age === null || age === undefined || age <= 0) return 'данные на ' + asOf;
  if (age === 1) return 'данные на ' + asOf + ' (вчерашние)';
  return 'данные на ' + asOf + ' (не обновлялись ' + age + ' дн.)';
}

function readinessStale() {
  return readinessAvailable() && readinessStatus.ageDays > 1;
}

// Полоска готовности: ширина по проценту, цвет по статусу.
function readinessBarHtml(percent, color) {
  if (percent === null || percent === undefined) return '';
  const width = Math.max(0, Math.min(100, Number(percent) || 0));
  return `<span class="readiness-bar"><i style="width:${width}%;background:${color};"></i></span>`;
}

/* ===== Ячейки в таблице заказов ===== */

// Колонка «СП»: сам номер и возможность его проставить.
function orderSpecificationCellHtml(order, canEdit) {
  const spec = (order && order.specification) || '';
  if (!spec) {
    return canEdit
      ? `<button type="button" class="link-btn" onclick="editOrderSpecification(${order.id})" title="Указать номер СП">указать СП</button>`
      : '<span style="color:#9ca3af;">—</span>';
  }
  const editBtn = canEdit
    ? ` <button type="button" class="btn-icon-btn" onclick="editOrderSpecification(${order.id})" title="Изменить номер СП" style="font-size:10px;">изм.</button>`
    : '';
  return `<strong>${escapeHtml(spec)}</strong>${editBtn}`;
}

// Колонка «Готовность»: полоска, процент, статус и дата среза.
function orderReadinessCellHtml(order) {
  const key = (typeof orderSpecificationKey === 'function') ? orderSpecificationKey(order) : '';
  if (!key) return '<span style="color:#9ca3af;font-size:11px;">нет СП</span>';

  if (!readinessAvailable()) {
    return '<span style="color:#9ca3af;font-size:11px;" title="Администратор ещё не загрузил утренний файл готовности">Нет данных готовности</span>';
  }

  const record = readinessByKey[key];
  if (!record) {
    return '<span style="color:#b45309;font-size:11px;" title="Номер СП есть в CRM, но записи по нему нет в срезе готовности">Нет данных готовности</span>';
  }

  const info = readinessStatusInfo(record.statusCode);
  const stale = readinessStale()
    ? `<span class="readiness-stale" title="${escapeHtml(readinessAsOfText())}">устарело</span>`
    : '';
  return `
    <button type="button" class="readiness-cell" onclick="openReadinessCard(${order.id})"
            title="${escapeHtml(record.status)} · ${escapeHtml(readinessAsOfText())}">
      <span class="readiness-top">
        ${readinessBarHtml(record.readiness, info.color)}
        <strong>${escapeHtml(readinessPercentText(record.readiness))}</strong>
      </span>
      <span class="readiness-sub">
        <span class="badge" style="background:${info.color}1f;color:${info.color};">${escapeHtml(record.status || info.label)}</span>
        ${stale}
      </span>
      <span class="readiness-date">${escapeHtml(readinessAsOfText())}</span>
    </button>`;
}

/* ===== Загрузка среза с сервера ===== */

// Запрашиваем только нужные СП: весь срез на 1100+ заказов в браузер не тянем.
async function loadReadinessLookup(keys) {
  if (typeof apiAvailable === 'function' && !apiAvailable()) return false;
  const list = Array.from(new Set((keys || []).filter(Boolean)));
  const signature = list.slice().sort().join('|');
  if (signature === readinessLookupKey) return false;

  try {
    const res = await fetch('/api/readiness/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: list })
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || !data.ok) return false;

    readinessStatus = data.status || null;
    readinessByKey = data.orders || {};
    readinessLookupKey = signature;
    return true;
  } catch (err) {
    return false;
  }
}

// Свежий статус среза (без заказов) — нужен разделу администрирования.
async function fetchReadinessStatus() {
  if (typeof apiAvailable === 'function' && !apiAvailable()) return null;
  try {
    const res = await fetch('/api/readiness', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ok) return null;
    readinessStatus = data.status || null;
    return readinessStatus;
  } catch (err) {
    return null;
  }
}

// Подтянуть готовность по всем видимым заказам и перерисовать раздел.
async function refreshReadinessForVisibleOrders(force) {
  if (readinessLoading) return false;
  if (typeof visibleOrders !== 'function') return false;

  const list = visibleOrders();
  const keys = list.map(o => (typeof orderSpecificationKey === 'function') ? orderSpecificationKey(o) : '').filter(Boolean);

  if (force) readinessLookupKey = '';
  if (!keys.length && !readinessStatus) {
    // Заказов без СП нет, но статус среза всё равно нужен для подписи.
    await fetchReadinessStatus();
    return false;
  }

  readinessLoading = true;
  try {
    const changed = await loadReadinessLookup(keys);
    if (!changed) return false;
    if (typeof currentSection === 'string' && currentSection === 'orders') {
      const activeModal = document.querySelector('.modal-overlay.active');
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT');
      if (!activeModal && !typing) renderOrdersTab();
    }
    return true;
  } finally {
    readinessLoading = false;
  }
}

// Сервер сообщил (SSE), что срез обновился: перечитываем и перерисовываем.
function onReadinessUpdated() {
  readinessLookupKey = '';
  readinessByKey = {};
  refreshReadinessForVisibleOrders(true);
  if (typeof currentSection === 'string' && currentSection === 'admin-readiness' &&
      typeof renderAdminReadiness === 'function') {
    renderAdminReadiness();
  }
}

/* ===== Карточка готовности по СП ===== */

function openReadinessCard(orderId) {
  const order = (typeof orders !== 'undefined' ? orders : []).find(o => o.id === orderId);
  if (!order) return;
  const body = document.getElementById('readinessCardBody');
  const title = document.getElementById('readinessCardTitle');
  if (!body) return;

  const key = orderSpecificationKey(order);
  const record = readinessByKey[key];

  if (title) title.textContent = 'Готовность: ' + (order.specification || key);

  if (!record) {
    body.innerHTML = `
      <div class="empty-state" style="padding:40px 20px;">
        <p>Нет данных готовности по СП ${escapeHtml(order.specification || key)}.</p>
        <p style="font-size:12px;color:#9ca3af;margin-top:6px;">
          ${readinessAvailable()
            ? 'В утреннем срезе этой спецификации нет — проверьте номер СП в 1С и в CRM.'
            : 'Администратор ещё не загрузил срез готовности за сегодня.'}
        </p>
      </div>`;
    document.getElementById('readinessModal').classList.add('active');
    return;
  }

  const info = readinessStatusInfo(record.statusCode);
  const overdue = record.overdueDays > 0
    ? `<span class="badge" style="background:#fee2e2;color:#b91c1c;">просрочено ${record.overdueDays} дн.</span>`
    : '';

  body.innerHTML = `
    <div class="readiness-card-head">
      <div>
        <div class="readiness-card-spec">${escapeHtml(record.specification || key)}</div>
        <div class="readiness-card-client">${escapeHtml(record.client || order.clientName || '—')}</div>
      </div>
      <div style="text-align:right;">
        <span class="badge" style="background:${info.color}1f;color:${info.color};">${escapeHtml(record.status || info.label)}</span>
        ${overdue}
      </div>
    </div>

    <div class="readiness-meta">
      Плановая дата готовности: <strong>${escapeHtml(formatReadinessDate(record.planReadyDate))}</strong>
      · Кол-во дней на работу: <strong>${record.workDays === null || record.workDays === undefined ? '—' : escapeHtml(String(record.workDays))}</strong>
      · Дата заказа: <strong>${escapeHtml(formatReadinessDate(record.orderDate))}</strong>
    </div>
    <div class="readiness-meta readiness-asof">${escapeHtml(readinessAsOfText())}${readinessStale() ? ' — данные устарели, попросите администратора загрузить свежий файл' : ''}</div>

    <div class="readiness-totals">
      <div class="readiness-total"><span>План, кол-во</span><strong>${escapeHtml(readinessNumberText(record.planQty))}</strong></div>
      <div class="readiness-total"><span>На складе</span><strong>${escapeHtml(readinessNumberText(record.stockQty))}</strong></div>
      <div class="readiness-total"><span>Отгружено</span><strong>${escapeHtml(readinessNumberText(record.shippedQty))}</strong></div>
      <div class="readiness-total"><span>Готовность</span><strong>${escapeHtml(readinessPercentText(record.readiness))}</strong></div>
    </div>

    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;margin-top:12px;">
      <table class="admin-table">
        <thead><tr>
          <th>Шифр</th><th>Длина</th><th>Покрытие</th><th>План</th><th>На складе</th><th>Отгружено</th><th>Готовность</th><th>Статус</th>
        </tr></thead>
        <tbody>
          ${(record.positions || []).map(p => {
            const pInfo = readinessStatusInfo(p.statusCode);
            return `<tr style="cursor:default;">
              <td><strong>${escapeHtml(p.cipher || '—')}</strong></td>
              <td>${escapeHtml(p.length || '—')}</td>
              <td>${escapeHtml(p.coating || '—')}</td>
              <td>${escapeHtml(readinessNumberText(p.planQty))}</td>
              <td>${escapeHtml(readinessNumberText(p.stockQty))}</td>
              <td>${escapeHtml(readinessNumberText(p.shippedQty))}</td>
              <td>${escapeHtml(readinessPercentText(p.readiness))}</td>
              <td><span class="badge" style="background:${pInfo.color}1f;color:${pInfo.color};">${escapeHtml(p.status || pInfo.label)}</span></td>
            </tr>`;
          }).join('') || '<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:20px;">Позиций нет</td></tr>'}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">Итого по СП, позиций: ${(record.positions || []).length}</td>
            <td><strong>${escapeHtml(readinessNumberText(record.planQty))}</strong></td>
            <td><strong>${escapeHtml(readinessNumberText(record.stockQty))}</strong></td>
            <td><strong>${escapeHtml(readinessNumberText(record.shippedQty))}</strong></td>
            <td colspan="2"><strong>${escapeHtml(readinessPercentText(record.readiness))}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  document.getElementById('readinessModal').classList.add('active');
}

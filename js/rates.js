/* ============================================================
   js/rates.js — курсы валют (USD / EUR) в сайдбаре.
   Источник: данные ЦБ РФ (https://www.cbr-xml-daily.ru/daily_json.js).
   Бесплатный открытый API с разрешённым CORS — работает и через
   http://localhost, и при открытии index.html напрямую (file://).
   Виджет обновляется автоматически без перезагрузки страницы;
   при сбое сети показывает последние сохранённые значения.
   ============================================================ */

const RATES_API = 'https://www.cbr-xml-daily.ru/daily_json.js';
const RATES_CACHE_KEY = 'alvid_crm_rates';
const RATES_POLL_MS = 60000; // обновление раз в минуту

let ratesTimer = null;

function loadCachedRates() {
  try {
    const raw = localStorage.getItem(RATES_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveRatesCache(data) {
  try { localStorage.setItem(RATES_CACHE_KEY, JSON.stringify(data)); } catch (e) {}
}

function formatRate(value) {
  if (value === null || value === undefined || isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value));
}

// Направление изменения курса относительно прошлого значения.
function changeSign(current, previous) {
  if (previous === null || previous === undefined) return 'flat';
  const diff = Number(current) - Number(previous);
  if (Math.abs(diff) < 0.0005) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

function renderRates(data) {
  if (!data || !data.Valute) return;

  const update = (valId, chgId, cur, sym) => {
    const valEl = document.getElementById(valId);
    if (!cur || !valEl) return;
    valEl.textContent = formatRate(cur.Value);
    valEl.title = `1 ${sym} = ${formatRate(cur.Value)} руб.`;

    const chgEl = document.getElementById(chgId);
    if (!chgEl) return;
    const sign = changeSign(cur.Value, cur.Previous);
    const diff = (Number(cur.Value) - Number(cur.Previous || cur.Value));
    chgEl.textContent = sign === 'flat' ? '·' : (sign === 'up' ? '▲' : '▼');
    chgEl.className = 'rate-chg ' + sign;
    chgEl.title = sign === 'flat' ? 'Без изменений'
      : `${(diff > 0 ? '+' : '') + diff.toFixed(2)} руб. к прошлому дню`;
  };

  update('rateUSD', 'rateUSDChg', data.Valute.USD, 'USD');
  update('rateEUR', 'rateEURChg', data.Valute.EUR, 'EUR');

  const box = document.getElementById('sidebarRates');
  if (box && data.Date) {
    try {
      const d = new Date(data.Date);
      box.title = 'Курсы ЦБ РФ · ' + d.toLocaleDateString('ru-RU');
    } catch (e) { /* не критично */ }
  }
}

async function fetchRates() {
  try {
    const res = await fetch(RATES_API, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    saveRatesCache(data);
    renderRates(data);
  } catch (err) {
    // Офлайн или сбой API — показываем последние кэшированные значения.
    const cached = loadCachedRates();
    if (cached) renderRates(cached);
  }
}

function startRatesPolling() {
  if (ratesTimer) return;
  fetchRates();
  ratesTimer = setInterval(fetchRates, RATES_POLL_MS);
}

function initRates() {
  // Сразу отображаем кэш (если есть), затем подтягиваем свежие данные.
  const cached = loadCachedRates();
  if (cached) renderRates(cached);
  startRatesPolling();
}

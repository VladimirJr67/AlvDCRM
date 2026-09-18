/* Смоук-тест: все модули клиента загружаются в порядке index.html. */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const pattern = new RegExp('<script src="(js/[^"]+)"', 'g');
const order = [...html.matchAll(pattern)].map(m => m[1]).filter(p => !/xlsx/.test(p));

const elements = {};
const el = id => (elements[id] = elements[id] || {
  id, value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
  classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
  setAttribute() {}, getAttribute() { return null; },
  appendChild() {}, focus() {}, addEventListener() {}, removeEventListener() {}, reset() {},
  querySelector() { return null; }, querySelectorAll() { return []; }
});

function FakeNotification() {}
FakeNotification.permission = 'default';
FakeNotification.requestPermission = () => Promise.resolve('granted');

const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: () => {}, confirm: () => true, prompt: () => null, Intl, URLSearchParams,
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  performance: { now: () => 0 },
  Notification: FakeNotification,
  TextDecoder, TextEncoder,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    getElementById: el, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, createElement: () => el('x'),
    body: el('body'), documentElement: el('html')
  },
  window: {
    addEventListener: () => {}, location: { protocol: 'http:', href: '', search: '' },
    isSecureContext: true,
    matchMedia: () => ({ matches: false, addEventListener() {} })
  },
  navigator: { sendBeacon: () => true, userAgent: 'test', serviceWorker: { register: () => Promise.resolve({}) } },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), headers: { getSetCookie: () => [] } }),
  EventSource: function () { this.close = () => {}; },
  Image: function () {}, FormData: function () {}, XLSX: {}, FileReader: function () {},
  AudioContext: function () {}
};

const context = vm.createContext(sandbox);
let errors = 0;
order.forEach(p => {
  try {
    vm.runInContext(fs.readFileSync(p, 'utf8'), context, { filename: p });
  } catch (e) {
    errors++;
    console.log('ОШИБКА загрузки ' + p + ': ' + e.message);
  }
});

console.log('модулей загружено: ' + order.length + ', ошибок: ' + errors);
const needed = ['renderTasks', 'renderTaskCalendarHtml', 'taskCalendarBandsWithCounts', 'pickTaskCalendarBand',
  'shiftTaskCalendar', 'setTaskCalendarMode', 'renderTracking', 'startTrackingUser', 'stopTrackingUser',
  'userTaskProgress', 'trackersForUser', 'toggleLinkWorkedOff', 'taskCanBeClosed', 'setTaskStatus',
  'animateBoardScroll', 'scrollTaskBoard', 'showReminderPopup', 'unlinkReminderFromClient',
  'renderChat', 'renderTransfers', 'renderOrders', 'renderMatricesTab', 'applyTheme', 'showNativeNotification',
  'readinessForOrder', 'orderReadinessCellHtml', 'orderSpecificationCellHtml', 'openReadinessCard',
  'refreshReadinessForVisibleOrders', 'normalizeSpecificationKey', 'renderAdminReadiness', 'uploadReadinessFile'];
const missing = needed.filter(f => typeof context[f] !== 'function');
console.log('ключевые функции: ' + (missing.length ? 'НЕТ — ' + missing.join(', ') : 'все на месте (' + needed.length + ')'));
process.exitCode = (errors || missing.length) ? 1 : 0;

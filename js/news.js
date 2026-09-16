/* ============================================================
   js/news.js — раздел «Новости»: лента объявлений для команды.

   — публиковать может только администратор (role === 'admin');
   — текст в rich-text: шрифт, стиль абзаца, цвет, списки, ссылки,
     картинки (файл вставляется в новость как data-URL);
   — лента: новые сверху, свёрнутый вид с кнопкой «Развернуть»;
   — непрочитанные считаются по полю readBy и показываются счётчиком
     у пункта меню «Новости»;
   — записи хранятся в db.json (коллекция news) и видны всем.
   ============================================================ */

let newsItems = [];
let expandedNewsIds = [];

const NEWS_KEY = 'alvid_crm_news';

function loadNews() {
  const saved = readJson(NEWS_KEY, []);
  newsItems = Array.isArray(saved) ? saved : [];
}

function saveNews() {
  localStorage.setItem(NEWS_KEY, JSON.stringify(newsItems));
  queueServerSave();
}

/* ===== Прочитанное и счётчик ===== */

function newsIsRead(item) {
  if (!currentUser || !item) return false;
  return Array.isArray(item.readBy) && item.readBy.indexOf(currentUser.id) > -1;
}

function unreadNewsCount() {
  if (!currentUser) return 0;
  return newsItems.filter(n => !newsIsRead(n)).length;
}

function updateNewsMenuBadge() {
  const badge = document.getElementById('newsMenuBadge');
  if (!badge) return;
  const count = unreadNewsCount();
  if (!count) {
    badge.innerHTML = '';
    return;
  }
  badge.innerHTML = `<span class="menu-badge-count menu-badge-new" title="Непрочитанных новостей: ${count}">${count}</span>`;
}

// Открытие раздела отмечает новости прочитанными. Метки «новое» в уже
// отрисованной ленте остаются — счётчик в меню просто обнуляется.
function markNewsRead() {
  if (!currentUser) return false;
  let changed = false;
  newsItems.forEach(item => {
    if (!Array.isArray(item.readBy)) item.readBy = [];
    if (item.readBy.indexOf(currentUser.id) === -1) {
      item.readBy.push(currentUser.id);
      changed = true;
    }
  });
  if (changed) saveNews();
  return changed;
}

/* ===== Текст новости ===== */

// Очистка разметки: убираем скрипты, фреймы, формы и inline-обработчики,
// чтобы новость не могла сломать или перехватить страницу. Сначала быстрый
// слой на регулярках, затем разбор через DOM (он ловит остатки).
function sanitizeNewsHtml(html) {
  let out = String(html || '');

  out = out.replace(/<\s*(script|iframe|object|embed|style|link|meta|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  out = out.replace(/<\s*(script|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '');
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');

  const tmp = document.createElement('div');
  tmp.innerHTML = out;
  tmp.querySelectorAll('script, iframe, object, embed, style, link, meta, form').forEach(el => el.remove());
  tmp.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes || []).forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || '');
      if (name.indexOf('on') === 0) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) el.removeAttribute(attr.name);
    });
  });
  return tmp.innerHTML || out;
}

// Текст без разметки — для свёрнутого вида ленты.
function newsPlainText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}

function newsTeaser(item, limit) {
  const text = newsPlainText(item && item.html);
  const max = limit || 240;
  return text.length > max ? text.slice(0, max).trim() + '…' : text;
}

function toggleNewsItem(id) {
  const i = expandedNewsIds.indexOf(id);
  if (i > -1) expandedNewsIds.splice(i, 1);
  else expandedNewsIds.push(id);
  renderNews();
}

/* ===== Лента ===== */

function renderNews() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  const admin = isAdmin();
  const sorted = [...newsItems].sort((a, b) =>
    new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const itemsHtml = sorted.map(item => {
    const expanded = expandedNewsIds.indexOf(item.id) > -1;
    const isNew = !newsIsRead(item);
    const author = item.createdBy ? findUserById(item.createdBy) : null;

    return `
      <article class="news-item${isNew ? ' unread' : ''}">
        <div class="news-item-head">
          <div class="news-item-title">
            ${isNew ? '<span class="news-new-dot" title="Непрочитанная новость"></span>' : ''}
            ${escapeHtml(item.title || '')}
          </div>
          ${admin ? `
            <div class="news-item-actions">
              <button class="btn-icon-btn" onclick="openNewsEditor(${item.id})" title="Редактировать">✏️</button>
              <button class="btn-icon-btn" onclick="deleteNewsItem(${item.id})" title="Удалить">🗑</button>
            </div>` : ''}
        </div>
        <div class="news-item-meta">
          ${formatDateTime(item.createdAt)}
          ${author ? ' · ' + escapeHtml(author.name || author.login) : ''}
          ${item.updatedAt ? ' · изменено ' + formatDateTime(item.updatedAt) : ''}
        </div>
        ${expanded
          ? `<div class="news-item-body">${item.html || ''}</div>
             <button type="button" class="link-btn" onclick="toggleNewsItem(${item.id})">Свернуть</button>`
          : `<div class="news-item-teaser">${escapeHtml(newsTeaser(item))}</div>
             <button type="button" class="link-btn" onclick="toggleNewsItem(${item.id})">Развернуть</button>`}
      </article>`;
  }).join('');

  main.innerHTML = `
    <div class="news-page">
      <div class="news-inner">
        ${admin ? '<div class="news-head"><button class="btn" onclick="openNewsEditor()">+ Новость</button></div>' : ''}

        ${sorted.length === 0 ? `
          <div class="news-empty">
            <h2>Пока новостей нет</h2>
            <p>${admin
              ? 'Нажмите «+ Новость», чтобы опубликовать объявление для команды.'
              : 'Здесь появятся объявления и новости от администратора.'}</p>
          </div>` : `<div class="news-list">${itemsHtml}</div>`}
      </div>
    </div>
  `;

  markNewsRead();
  updateNewsMenuBadge();
}

/* ===== Редактор (только администратор) ===== */

function openNewsEditor(id) {
  if (!isAdmin()) return;
  const item = id ? newsItems.find(n => n.id === id) : null;
  document.getElementById('newsEditorTitle').textContent = item ? 'Редактировать новость' : 'Новая новость';
  document.getElementById('newsId').value = item ? item.id : '';
  document.getElementById('newsTitle').value = item ? (item.title || '') : '';
  document.getElementById('newsBody').innerHTML = item ? (item.html || '') : '';
  document.getElementById('newsEditorModal').classList.add('active');
  const body = document.getElementById('newsBody');
  if (body && body.focus) body.focus();
}

// Команды редактора. Кнопки панели не забирают фокус у поля ввода
// (onmousedown с preventDefault), поэтому форматирование применяется
// к выделенному тексту.
function newsCmd(cmd, value) {
  const body = document.getElementById('newsBody');
  if (!body) return;
  if (body.focus) body.focus();

  if (cmd === 'createLink') {
    const url = prompt('Адрес ссылки:', 'https://');
    if (!url) return;
    document.execCommand('createLink', false, url);
    return;
  }
  document.execCommand(cmd, false, value || null);
}

// Картинка вставляется как data-URL: новость остаётся внутри базы,
// без внешних ссылок на изображения.
function newsInsertImage(event) {
  const input = event && event.target;
  const file = input && input.files && input.files[0];
  if (input) input.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const body = document.getElementById('newsBody');
    if (body && body.focus) body.focus();
    document.execCommand('insertImage', false, reader.result);
  };
  reader.readAsDataURL(file);
}

function saveNewsItem() {
  if (!isAdmin()) return;

  const id = document.getElementById('newsId').value;
  const title = document.getElementById('newsTitle').value.trim();
  const body = document.getElementById('newsBody');
  const html = sanitizeNewsHtml(body ? body.innerHTML : '');

  if (!title) { alert('Укажите тему новости'); return; }
  if (!newsPlainText(html)) { alert('Добавьте текст новости'); return; }

  if (id) {
    const idx = newsItems.findIndex(n => n.id === parseInt(id, 10));
    if (idx !== -1) {
      newsItems[idx] = { ...newsItems[idx], title: title, html: html, updatedAt: new Date().toISOString() };
    }
  } else {
    const maxId = newsItems.reduce((m, n) => Math.max(m, n.id || 0), 0);
    newsItems.push({
      id: maxId + 1,
      title: title,
      html: html,
      createdAt: new Date().toISOString(),
      createdBy: currentUser ? currentUser.id : null,
      // Свою новость автор уже прочитал.
      readBy: currentUser ? [currentUser.id] : []
    });
  }

  saveNews();
  closeModal('newsEditorModal');
  renderNews();
}

function deleteNewsItem(id) {
  if (!isAdmin()) return;
  const item = newsItems.find(n => n.id === id);
  if (!item) return;
  if (!confirm('Удалить новость «' + (item.title || '') + '»?')) return;
  newsItems = newsItems.filter(n => n.id !== id);
  saveNews();
  renderNews();
}

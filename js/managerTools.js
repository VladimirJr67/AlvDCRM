/* ============================================================
   js/managerTools.js — раздел «Инструменты менеджера».

   Пункт меню видят менеджеры по продажам, руководитель, а также админ и
   разработчик (чтобы проверить инструменты). Первый инструмент — «Список
   почт для рассылок»: простая таблица e-mail с именем/комментарием и датой
   добавления. Данные лежат в коллекции mailingEmails (db.json) и дублируются
   в localStorage — как остальные справочники приложения.
   ============================================================ */

const MAILING_EMAILS_KEY = 'alvid_crm_mailing_emails';

let mailingEmails = [];

function loadMailingEmails() {
  try {
    const saved = localStorage.getItem(MAILING_EMAILS_KEY);
    if (saved) mailingEmails = JSON.parse(saved);
  } catch (e) {
    mailingEmails = [];
  }
  if (!Array.isArray(mailingEmails)) mailingEmails = [];
  return mailingEmails;
}

function saveMailingEmails() {
  localStorage.setItem(MAILING_EMAILS_KEY, JSON.stringify(mailingEmails || []));
  if (typeof queueServerSave === 'function') queueServerSave();
}

// Доступ к инструментам: менеджер по продажам/руководитель, а также
// администратор и разработчик — для проверки.
function canUseManagerTools() {
  if (!currentUser) return false;
  return isManagerRole(currentUser) || isAdmin();
}

function nextMailingEmailId() {
  return (mailingEmails || []).reduce((m, e) => Math.max(m, e && e.id ? e.id : 0), 0) + 1;
}

function formatMailingDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/* ===== Раздел «Инструменты менеджера» ===== */

function renderManagerTools() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  if (!canUseManagerTools()) {
    main.innerHTML = `<div class="placeholder"><h2>Доступ запрещён</h2><p>Раздел доступен менеджеру по продажам</p></div>`;
    return;
  }

  main.innerHTML = `
    <div class="tools-page">
      <div class="tools-head">
        <h1>Инструменты менеджера</h1>
        <span class="tools-badge">в разработке</span>
      </div>

      <div class="tools-grid" id="managerToolsGrid">
        <div class="tools-card" onclick="goToSection('manager-emails')" style="cursor:pointer;">
          <div class="tools-card-icon">✉️</div>
          <h3>Список почт для рассылок</h3>
          <p>Адреса e-mail клиентов и контактов с комментарием и датой добавления.</p>
        </div>
      </div>
    </div>
  `;
}

/* ===== «Список почт для рассылок» ===== */

let mailingEmailsSearch = '';

function mailingEmailsList() {
  const q = String(mailingEmailsSearch || '').trim().toLowerCase();
  return [...(mailingEmails || [])]
    .filter(e => {
      if (!q) return true;
      return String(e.email || '').toLowerCase().includes(q) ||
        String(e.name || '').toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function setMailingEmailsSearch(value) {
  mailingEmailsSearch = value || '';
  renderManagerEmails();
}

function renderManagerEmails() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  if (!canUseManagerTools()) {
    main.innerHTML = `<div class="placeholder"><h2>Доступ запрещён</h2><p>Раздел доступен менеджеру по продажам</p></div>`;
    return;
  }

  const list = mailingEmailsList();

  main.innerHTML = `
    <div class="orders-page">
      <div class="orders-head">
        <h1>Список почт для рассылок</h1>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <input type="text" class="search-bar" placeholder="Поиск по почте или имени…"
                 value="${escapeHtml(mailingEmailsSearch)}" oninput="setMailingEmailsSearch(this.value)"
                 style="width:260px;max-width:100%;margin-bottom:0;">
          <button class="btn" onclick="openMailingEmailModal()">+ Добавить почту</button>
        </div>
      </div>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;">
        <table class="admin-table">
          <thead><tr>
            <th style="width:35%;">Email</th>
            <th style="width:35%;">Имя / комментарий</th>
            <th style="width:20%;">Дата добавления</th>
            <th style="width:10%;text-align:right;">Действия</th>
          </tr></thead>
          <tbody>
            ${list.length ? list.map(e => `
              <tr style="cursor:default;">
                <td style="padding-left:16px;"><strong>${escapeHtml(e.email || '—')}</strong></td>
                <td>${escapeHtml(e.name || '—')}</td>
                <td>${escapeHtml(formatMailingDate(e.createdAt))}</td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn-icon-btn" onclick="deleteMailingEmail(${e.id})" title="Удалить почту">Удалить</button>
                </td>
              </tr>`).join('') : `<tr><td colspan="4" style="text-align:center;color:#9ca3af;padding:40px;">Список пуст — добавьте первый адрес</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function openMailingEmailModal() {
  if (!canUseManagerTools()) { alert('Раздел доступен менеджеру по продажам.'); return; }
  const emailEl = document.getElementById('mailingEmailAddress');
  const nameEl = document.getElementById('mailingEmailName');
  if (emailEl) emailEl.value = '';
  if (nameEl) nameEl.value = '';
  const modal = document.getElementById('mailingEmailModal');
  if (modal) modal.classList.add('active');
  if (emailEl) emailEl.focus();
}

// Простая проверка адреса: что-то@что-то.домен без пробелов.
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}

function saveMailingEmail(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!canUseManagerTools()) { alert('Раздел доступен менеджеру по продажам.'); return { ok: false, error: 'Нет доступа' }; }
  const email = String((document.getElementById('mailingEmailAddress') || {}).value || '').trim();
  const name = String((document.getElementById('mailingEmailName') || {}).value || '').trim();

  if (!email) { alert('Укажите адрес электронной почты.'); return { ok: false, error: 'Нет адреса' }; }
  if (!isValidEmail(email)) { alert('Похоже, адрес указан с ошибкой: ' + email); return { ok: false, error: 'Неверный адрес' }; }
  if ((mailingEmails || []).some(x => String(x.email || '').toLowerCase() === email.toLowerCase())) {
    alert('Такой адрес уже есть в списке.');
    return { ok: false, error: 'Дубликат' };
  }

  const record = {
    id: nextMailingEmailId(),
    email: email,
    name: name,
    createdAt: new Date().toISOString(),
    createdBy: currentUser ? currentUser.id : null
  };
  mailingEmails.push(record);
  saveMailingEmails();
  closeModal('mailingEmailModal');
  renderManagerEmails();
  return { ok: true, email: record };
}

function deleteMailingEmail(id) {
  if (!canUseManagerTools()) { alert('Раздел доступен менеджеру по продажам.'); return { ok: false, error: 'Нет доступа' }; }
  const item = (mailingEmails || []).find(x => Number(x.id) === Number(id));
  if (!item) return { ok: false, error: 'Не найдено' };
  if (!confirm('Удалить адрес «' + (item.email || '') + '»?')) return { ok: false, error: 'Отменено' };
  mailingEmails = mailingEmails.filter(x => Number(x.id) !== Number(id));
  saveMailingEmails();
  renderManagerEmails();
  return { ok: true };
}

/* ============================================================
   js/app.js — каркас приложения: сессия, меню по ролям (RBAC),
   маршрутизация разделов, синхронизация с сервером.
   ============================================================ */

let currentSection = 'clients';
let pollingStarted = false;
let menuHandlerAttached = false;
let clientsTopHeight = null;

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

/* ===== Сборка меню по роли ===== */

const MENU_ICONS = {
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>',
  clients: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
  reminders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>',
  contacts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/><path d="M2 21v-2a4 4 0 013-3.87M8 3.13a4 4 0 010 7.75"/></svg>',
  notifications: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>'
};

function buildSidebar() {
  const menu = document.querySelector('.menu');
  if (!menu) return;
  const admin = isAdmin();

  const addItem = (section, label, opts = {}) => {
    const hasSub = !!(opts.submenu && opts.submenu.length);
    return `
      <div class="menu-item${hasSub ? ' has-submenu' : ''}${currentSection === section ? ' active' : ''}"
           data-section="${section}"${hasSub ? ` data-submenu="${section}Submenu"` : ''}>
        ${MENU_ICONS[section] || ''}
        <span>${label}</span>
        ${opts.badge ? `<div class="menu-badge" id="${opts.badge}"></div>` : ''}
        ${hasSub ? `<svg class="submenu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>` : ''}
      </div>
      ${hasSub ? `<div class="submenu" id="${section}Submenu">
        ${opts.submenu.map(s => `<div class="submenu-item${currentSection === s.section ? ' active' : ''}" data-subsection="${s.section}">${s.label}</div>`).join('')}
      </div>` : ''}
    `;
  };

  let html = '';
  html += addItem('orders', 'Заказы');
  html += addItem('clients', 'Клиенты');
  html += addItem('tasks', 'Задачи', { badge: 'tasksMenuBadge' });
  html += addItem('reminders', 'Напоминания');
  html += addItem('contacts', 'Контакты', { submenu: [
    { section: 'contacts-internal', label: 'Внутренние' },
    { section: 'contacts-mobile', label: 'Мобильные' }
  ] });
  html += addItem('notifications', 'Уведомления', { badge: 'notificationsMenuBadge' });
  if (admin) {
    html += addItem('admin', 'Администрирование', { submenu: [
      { section: 'admin-analysis', label: 'Анализ' },
      { section: 'admin-users', label: 'Пользователи' },
      { section: 'admin-assignments', label: 'Задачи' },
      { section: 'admin-interaction-types', label: 'Типы взаимодействий' }
    ] });
  }

  menu.innerHTML = html;
}

function attachMenuHandler() {
  if (menuHandlerAttached) return;
  menuHandlerAttached = true;

  document.querySelector('.menu').addEventListener('click', (e) => {
    const subItem = e.target.closest('.submenu-item');
    if (subItem) {
      const section = subItem.dataset.subsection;
      setActiveMenuState(section);
      renderSection(section);
      return;
    }
    const item = e.target.closest('.menu-item');
    if (!item) return;
    const section = item.dataset.section;
    const submenuId = item.dataset.submenu;

    if (submenuId) {
      // Клик по пункту с подменю — открыть подменю и перейти в
      // его первый (или последний выбранный) подраздел.
      setActiveMenuState(defaultSubsection(section));
      renderSection(defaultSubsection(section));
      return;
    }

    setActiveMenuState(section);
    renderSection(section);
  });
}

function defaultSubsection(parentSection) {
  if (parentSection === 'admin') return 'admin-analysis';
  if (parentSection === 'contacts') return currentContactsSubsection === 'mobile' ? 'contacts-mobile' : 'contacts-internal';
  return parentSection;
}

function setActiveMenuState(section) {
  currentSection = section;
  document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.submenu-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.submenu').forEach(s => s.classList.remove('show'));

  const parent = section.startsWith('contacts-') ? 'contacts'
    : section.startsWith('admin-') ? 'admin' : section;
  const parentEl = document.querySelector(`.menu-item[data-section="${parent}"]`);
  if (parentEl) {
    parentEl.classList.add('active');
    const submenuId = parentEl.dataset.submenu;
    if (submenuId) {
      const sm = document.getElementById(submenuId);
      if (sm) sm.classList.add('show');
    }
  }
  const subItem = document.querySelector(`.submenu-item[data-subsection="${section}"]`);
  if (subItem) subItem.classList.add('active');
}

function updateUserInfo() {
  const avatar = document.querySelector('.user-avatar');
  const nameEl = document.querySelector('.user-info-name');
  if (currentUser) {
    if (avatar) avatar.textContent = (currentUser.login[0] || 'A').toUpperCase();
    if (nameEl) nameEl.textContent = currentUser.login;
  }
}

/* ===== Вход / инициализация ===== */

async function enterApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  // Синхронизация с файловой БД на сервере (db.json)
  const serverOk = await apiInit();
  if (serverOk) resolveCurrentUserAfterHydrate();

  ensureRequiredTaskColumns();
  injectModals();
  attachMenuHandler();
  buildSidebar();
  updateUserInfo();
  updateTasksMenuBadge();
  updateNotificationBadge();

  initRates();

  showFileModeWarning();

  renderSection(currentSection);
  startPolling();
}

// Предупреждение при открытии как файла (file://): реальное время и общая
// база доступны только при работе через сервер. Не критично, можно скрыть.
function showFileModeWarning() {
  if (apiAvailable()) return;
  if (document.getElementById('fileModeBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'fileModeBanner';
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fef3c7;color:#92400e;padding:8px 16px;font-size:12px;text-align:center;border-bottom:1px solid #fde68a;line-height:1.5;';
  banner.innerHTML =
    'Синхронизация данных выключена: приложение открыто как файл (file://). ' +
    'Чтобы все пользователи видели изменения друг друга, запустите сервер ' +
    '<b>node server.js</b> (или <b>npm start</b>) и открывайте приложение по адресу <b>http://localhost:3000</b>.' +
    '<button onclick="this.parentNode.remove()" style="margin-left:12px;background:#fff;border:1px solid #fcd34d;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">Скрыть</button>';
  document.body.prepend(banner);
}

function injectModals() {
  if (document.getElementById('clientModal')) return;
  const modalsHTML = `
    <div class="modal-overlay" id="clientModal">
      <div class="modal">
        <h2 id="clientModalTitle">Новый клиент</h2>
        <form onsubmit="saveClient(event)">
          <input type="hidden" id="clientId">
          <div class="form-section">
            <h3>Организация</h3>
            <div class="form-row"><div class="form-group"><label>Название *</label><input type="text" id="orgName" required></div></div>
            <div class="form-row">
              <div class="form-group"><label>Город</label><input type="text" id="orgCity"></div>
              <div class="form-group"><label>Направление</label><input type="text" id="orgDirection"></div>
            </div>
            <div class="form-row"><div class="form-group"><label>Адрес</label><input type="text" id="orgAddress"></div></div>
            <div class="form-row">
              <div class="form-group"><label>Телефоны</label><input type="text" id="orgPhones"></div>
              <div class="form-group"><label>Статус</label>
                <select id="orgStatus">
                  <option value="cooperation">Сотрудничество</option>
                  <option value="in_progress">В работе</option>
                  <option value="not_working">Не прорабатывать</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Email</label><input type="text" id="orgEmails"></div>
              <div class="form-group"><label>ИНН/ОГРН</label><input type="text" id="orgInn"></div>
            </div>
            <div class="form-row"><div class="form-group"><label>Сайт</label><input type="text" id="orgWebsite" placeholder="example.ru"></div></div>
          </div>
          <div class="form-section">
            <h3>Основной контакт</h3>
            <div class="form-row">
              <div class="form-group"><label>ФИО</label><input type="text" id="contactName"></div>
              <div class="form-group"><label>Должность</label><input type="text" id="contactPosition"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Рабочий тел.</label><input type="text" id="contactPhoneWork"></div>
              <div class="form-group"><label>Сотовый</label><input type="text" id="contactPhoneMobile"></div>
            </div>
            <div class="form-row"><div class="form-group"><label>Email</label><input type="email" id="contactEmail"></div></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="closeModal('clientModal')">Отмена</button>
            <button type="submit" class="btn">Сохранить</button>
          </div>
        </form>
      </div>
    </div>

    <div class="modal-overlay" id="contactModal">
      <div class="modal">
        <h2 id="contactModalTitle">Добавить контактное лицо</h2>
        <form onsubmit="saveContact(event)">
          <input type="hidden" id="contactClientId">
          <input type="hidden" id="editContactIdx" value="">
          <div class="form-section">
            <div class="form-row">
              <div class="form-group"><label>ФИО *</label><input type="text" id="newContactName" required></div>
              <div class="form-group"><label>Должность</label><input type="text" id="newContactPosition"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Рабочий тел.</label><input type="text" id="newContactPhoneWork"></div>
              <div class="form-group"><label>Сотовый</label><input type="text" id="newContactPhoneMobile"></div>
            </div>
            <div class="form-row"><div class="form-group"><label>Email</label><input type="email" id="newContactEmail"></div></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="closeModal('contactModal')">Отмена</button>
            <button type="submit" class="btn">Сохранить</button>
          </div>
        </form>
      </div>
    </div>

    <div class="modal-overlay" id="historyModal">
      <div class="modal">
        <h2>Добавить взаимодействие</h2>
        <form onsubmit="saveHistory(event)">
          <input type="hidden" id="historyClientId">
          <div class="form-section">
            <div class="form-row">
              <div class="form-group"><label>Тип</label>
                <select id="historyType" onchange="onHistoryTypeChange()"></select>
              </div>
              <div class="form-group"><label>Контактное лицо</label><select id="historyContactPerson"></select></div>
            </div>
            <div class="form-row"><div class="form-group"><label>Комментарий *</label><textarea id="historyComment" rows="4" required></textarea></div></div>
            <div id="orderFormSection" style="display:none;">
              <div class="form-section" style="margin-top:10px;padding-top:12px;border-top:1px dashed #e5e7eb;">
                <h3>Параметры заказа</h3>
                <div class="form-row">
                  <div class="form-group"><label>Кол-во кг</label><input type="number" id="orderKg" min="0" step="0.01" oninput="recalcOrderCost()"></div>
                  <div class="form-group"><label>Состояние</label><input type="text" id="orderCondition" placeholder="ГОСТ, б/у и т.п."></div>
                </div>
                <div class="form-row">
                  <div class="form-group"><label>Средняя цена</label><input type="number" id="orderAvgPrice" min="0" step="0.01" oninput="recalcOrderCost()"></div>
                  <div class="form-group"><label>Стоимость заказа</label><input type="number" id="orderCost" min="0" step="0.01"></div>
                </div>
                <div class="form-row" style="margin-top:4px;">
                  <div class="form-group" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="orderAutoCalc" checked onchange="onOrderAutoCalcToggle()" style="width:16px;height:16px;">
                    <label for="orderAutoCalc" style="margin:0;font-size:12px;cursor:pointer;">Рассчитывать автоматически (кг × цена)</label>
                  </div>
                </div>
                <div style="font-size:11px;color:#9ca3af;">Стоимость считается автоматически: Кол-во кг × Средняя цена. Снимите галочку, чтобы ввести стоимость вручную.</div>
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="closeModal('historyModal')">Отмена</button>
            <button type="submit" class="btn">Добавить</button>
          </div>
        </form>
      </div>
    </div>

    <div class="modal-overlay" id="contactItemModal">
      <div class="modal">
        <h2 id="contactItemModalTitle">Добавить контакт</h2>
        <form onsubmit="saveContactItem(event)">
          <input type="hidden" id="contactItemId">
          <input type="hidden" id="contactItemType">
          <div class="form-section">
            <div class="form-row"><div class="form-group"><label>ФИО *</label><input type="text" id="newContactName" required></div></div>
            <div class="form-row">
              <div class="form-group"><label>Должность</label><input type="text" id="newContactPosition"></div>
              <div class="form-group"><label>Отдел</label><input type="text" id="newContactDept"></div>
            </div>
            <div class="form-row"><div class="form-group"><label>Номер *</label><input type="text" id="newContactNumber" required></div></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="closeModal('contactItemModal')">Отмена</button>
            <button type="submit" class="btn">Сохранить</button>
          </div>
        </form>
      </div>
    </div>

    <div class="modal-overlay" id="reminderModal">
      <div class="modal">
        <h2 id="reminderModalTitle">Новое напоминание</h2>
        <form onsubmit="saveReminder(event)">
          <input type="hidden" id="reminderId">
          <input type="hidden" id="reminderClientId">
          <div class="form-section">
            <div class="form-row"><div class="form-group"><label>Название *</label><input type="text" id="reminderTitle" required></div></div>
            <div class="form-row"><div class="form-group"><label>Описание</label><textarea id="reminderDescription" rows="3"></textarea></div></div>
            <div class="form-row">
              <div class="form-group"><label>Дата *</label><input type="date" id="reminderDate" required></div>
              <div class="form-group"><label>Время *</label><input type="time" id="reminderTime" required></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Цвет</label><select id="reminderColor"></select></div>
            </div>
            <div class="form-row">
              <div class="form-group client-typeahead-group">
                <label>Клиент (компания)</label>
                <input type="text" id="reminderClientSearch" placeholder="Начните вводить название компании..." autocomplete="off"
                       style="width:100%;padding:7px 9px;border:1px solid #d0d5dd;border-radius:5px;font-size:12px;">
                <div class="client-typeahead-dropdown" id="reminderClientDropdown"></div>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Назначить</label>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                  <input type="checkbox" id="reminderAssignMe" style="width:16px;height:16px;">
                  <label for="reminderAssignMe" style="margin:0;font-size:13px;cursor:pointer;">Я (${currentUser ? escapeHtml(currentUser.login) : ''})</label>
                </div>
                <select id="reminderAssignees" multiple style="min-height:100px;"></select>
                <div style="font-size:11px;color:#9ca3af;margin-top:4px;">Ctrl+клик для нескольких</div>
              </div>
            </div>
            <div id="reminderClientLink" style="display:none;font-size:13px;color:#6b7280;padding:8px;background:#f9fafb;border-radius:6px;margin-top:8px;"></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="closeModal('reminderModal')">Отмена</button>
            <button type="submit" class="btn">Сохранить</button>
          </div>
        </form>
      </div>
    </div>

    <div class="modal-overlay" id="taskModal">
      <div class="modal" style="width:650px;">
        <h2 id="taskModalTitle">Новая задача</h2>
        <form onsubmit="saveTask(event)">
          <input type="hidden" id="taskId">
          <input type="hidden" id="taskClientId">
          <div class="form-section">
            <div class="form-row"><div class="form-group"><label>Название *</label><input type="text" id="taskTitle" required></div></div>
            <div class="form-row"><div class="form-group"><label>Описание</label><textarea id="taskDescription" rows="3"></textarea></div></div>
            <div class="form-row">
              <div class="form-group"><label>Дедлайн</label><input type="datetime-local" id="taskDeadline"></div>
              <div class="form-group"><label>Приоритет</label><select id="taskPriority"></select></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Тип задачи (колонка)</label><select id="taskColumn"></select></div>
            </div>
            <div class="form-row">
              <div class="form-group client-typeahead-group">
                <label>Клиент (компания)</label>
                <input type="text" id="taskClientSearch" placeholder="Начните вводить название компании..." autocomplete="off"
                       style="width:100%;padding:7px 9px;border:1px solid #d0d5dd;border-radius:5px;font-size:12px;">
                <div class="client-typeahead-dropdown" id="taskClientDropdown"></div>
              </div>
              <div class="form-group" id="taskContactRow" style="display:none;">
                <label>Контактное лицо</label>
                <select id="taskContactSelect" style="width:100%;padding:7px 9px;border:1px solid #d0d5dd;border-radius:5px;font-size:12px;"></select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Назначить (исполнители в канбане)</label>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                  <input type="checkbox" id="taskAssignMe" style="width:16px;height:16px;">
                  <label for="taskAssignMe" style="margin:0;font-size:13px;cursor:pointer;">Я (${currentUser ? escapeHtml(currentUser.login) : ''})</label>
                </div>
                <select id="taskAssignees" multiple style="min-height:100px;"></select>
                <div style="font-size:11px;color:#9ca3af;margin-top:4px;">Ctrl+клик для нескольких</div>
              </div>
            </div>
            <div id="taskClientLink" style="display:none;font-size:13px;color:#6b7280;padding:8px;background:#f9fafb;border-radius:6px;margin-top:8px;"></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="closeModal('taskModal')">Отмена</button>
            <button type="submit" class="btn">Сохранить</button>
          </div>
        </form>
      </div>
    </div>

    <div class="modal-overlay" id="clientCardModal" onclick="if(event.target===this)closeModal('clientCardModal')">
      <div class="modal" style="width:760px;max-width:94vw;">
        <div style="display:flex;justify-content:flex-end;margin-bottom:6px;">
          <button type="button" class="btn btn-sm btn-secondary" onclick="closeModal('clientCardModal')">✕ Закрыть</button>
        </div>
        <div id="clientCardContent"></div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalsHTML);
}

/* ===== Маршрутизация ===== */

function renderSection(section) {
  currentSection = section;
  const main = document.getElementById('mainContent');
  if (!main) return;

  if (section === 'clients') {
    main.innerHTML = `
      <div class="clients-split" id="clientsSplit">
        <div class="clients-top" id="clientsTop">
          <div class="clients-top-header">
            <div class="main-header">
              <h1>Клиенты</h1>
              <div style="display:flex;gap:6px;">
                <button class="btn btn-sm btn-secondary" onclick="exportClientsExcel()" title="Выгрузить текущий список клиентов в Excel">Экспорт</button>
                <button class="btn btn-sm btn-danger" onclick="deleteSelectedClient()">Удалить</button>
                <button class="btn" onclick="openClientModal()">+ Добавить</button>
              </div>
            </div>
            <div class="clients-filter-row">
              <select id="clientManagerFilter" class="clients-filter-select" onchange="setClientManagerFilter(this.value)" title="Фильтр по менеджеру">
                ${clientManagerFilterOptions()}
              </select>
              <input type="text" class="search-bar" id="searchInput" placeholder="Поиск по названию, сайту, почте, телефону, адресу, ИНН/ОГРН..." oninput="scheduleClientsSearch()" style="margin-bottom:0;flex:1;">
            </div>
          </div>
          <div class="clients-top-content" id="tableWrap"></div>
        </div>
        <div class="clients-resizer" id="clientsResizer"></div>
        <div class="clients-bottom" id="clientsBottom">
          <div class="clients-bottom-header">
            <div style="display:flex;align-items:center;">
              <h2>Контактные лица</h2>
              <span class="count" id="contactsCount"></span>
            </div>
            <button class="btn btn-sm" id="contactsAddBtn" onclick="openContactModal(selectedClientId)">+ Добавить</button>
          </div>
          <div class="clients-bottom-content" id="contactPanel">
            <div class="placeholder"><h2>Выберите клиента</h2><p>Кликните на строку в таблице</p></div>
          </div>
        </div>
      </div>`;
    renderClientsTable();
    renderClientContacts(selectedClientId);
    initClientsResizer();
  } else if (section === 'contacts' || section === 'contacts-internal' || section === 'contacts-mobile') {
    if (section === 'contacts-internal') currentContactsSubsection = 'internal';
    if (section === 'contacts-mobile') currentContactsSubsection = 'mobile';
    renderContacts();
  } else if (section === 'reminders') {
    renderReminders();
  } else if (section === 'orders') {
    renderOrders();
  } else if (section === 'tasks') {
    renderTasks();
  } else if (section === 'notifications') {
    renderNotifications();
  } else if (section.startsWith('admin')) {
    if (!isAdmin()) {
      main.innerHTML = `<div class="placeholder"><h2>Доступ запрещён</h2><p>У вас нет прав на этот раздел</p></div>`;
      return;
    }
    renderAdminSection(section);
  } else {
    main.innerHTML = `<div class="placeholder" style="width:100%"><h2>${section === 'orders' ? 'Заказы' : 'Раздел'}</h2><p>Скоро здесь что-то появится</p></div>`;
  }
}

// Выбранная компания в модалке задачи (id). Заполняется из typeahead-поиска.
let selectedTaskClientId = null;

// Инициализация поля «Клиент (компания)» в модалке задачи:
// если задача уже привязана — показываем название компании.
function initTaskClientSearch() {
  const input = document.getElementById('taskClientSearch');
  if (!input) return;
  const cid = document.getElementById('taskClientId').value;
  const client = cid ? clients.find(c => c.id === parseInt(cid)) : null;
  selectedTaskClientId = client ? client.id : null;
  input.value = client ? client.orgName : '';
}

// Поиск по компаниям (typeahead) в модалке задачи.
function onTaskClientSearch() {
  const input = document.getElementById('taskClientSearch');
  const dropdown = document.getElementById('taskClientDropdown');
  const q = (input.value || '').trim().toLowerCase();

  // Очистили текст — сбрасываем привязку к компании.
  if (!q) {
    selectedTaskClientId = null;
    document.getElementById('taskClientId').value = '';
    document.getElementById('taskClientLink').style.display = 'none';
    document.getElementById('taskContactRow').style.display = 'none';
    dropdown.style.display = 'none';
    return;
  }

  const matches = clients.filter(c => (c.orgName || '').toLowerCase().includes(q)).slice(0, 20);
  if (matches.length === 0) {
    dropdown.style.display = 'none';
    return;
  }
  dropdown.innerHTML = matches.map(c => `
    <div class="client-typeahead-item" data-id="${c.id}" data-name="${escapeHtml(c.orgName)}">${escapeHtml(c.orgName)}</div>
  `).join('');
  dropdown.style.display = 'block';
}

// Клик по выпадающему списку: выбираем компанию и обновляем связанные поля.
function selectTaskClient(id, name) {
  selectedTaskClientId = id;
  document.getElementById('taskClientId').value = id;
  document.getElementById('taskClientSearch').value = name;
  document.getElementById('taskClientDropdown').style.display = 'none';
  onTaskClientChange();
}

function onTaskClientChange() {
  const clientId = selectedTaskClientId;
  const contactRow = document.getElementById('taskContactRow');
  const contactSelect = document.getElementById('taskContactSelect');
  const clientLink = document.getElementById('taskClientLink');

  document.getElementById('taskClientId').value = clientId || '';

  if (!clientId) {
    contactRow.style.display = 'none';
    clientLink.style.display = 'none';
    return;
  }

  const client = clients.find(c => c.id === clientId);
  if (!client) return;

  clientLink.style.display = 'block';
  clientLink.innerHTML = ` 🏢 <strong>${escapeHtml(client.orgName)}</strong> <button type="button" onclick="unlinkTaskFromClient()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;margin-left:6px;">✕ убрать</button>`;

  if (client.contacts && client.contacts.length > 0) {
    contactRow.style.display = 'block';
    contactSelect.innerHTML = '<option value="">— Не выбрано —</option>' +
      client.contacts.map(ct => `<option value="${ct.id}">${escapeHtml(ct.name)}${ct.position ? ' (' + escapeHtml(ct.position) + ')' : ''}</option>`).join('');
  } else {
    contactRow.style.display = 'none';
  }
}

// Выбранная компания в модалке напоминания (id).
let selectedReminderClientId = null;

// Инициализация поля «Клиент (компания)» в модалке напоминания.
function initReminderClientSearch() {
  const input = document.getElementById('reminderClientSearch');
  if (!input) return;
  const cid = document.getElementById('reminderClientId').value;
  const client = cid ? clients.find(c => c.id === parseInt(cid)) : null;
  selectedReminderClientId = client ? client.id : null;
  input.value = client ? client.orgName : '';
}

// Поиск по компаниям (typeahead) в модалке напоминания.
function onReminderClientSearch() {
  const input = document.getElementById('reminderClientSearch');
  const dropdown = document.getElementById('reminderClientDropdown');
  const q = (input.value || '').trim().toLowerCase();

  if (!q) {
    selectedReminderClientId = null;
    document.getElementById('reminderClientId').value = '';
    const link = document.getElementById('reminderClientLink');
    if (link) link.style.display = 'none';
    dropdown.style.display = 'none';
    return;
  }

  const matches = clients.filter(c => (c.orgName || '').toLowerCase().includes(q)).slice(0, 20);
  if (matches.length === 0) {
    dropdown.style.display = 'none';
    return;
  }
  dropdown.innerHTML = matches.map(c => `
    <div class="client-typeahead-item" data-id="${c.id}" data-name="${escapeHtml(c.orgName)}">${escapeHtml(c.orgName)}</div>
  `).join('');
  dropdown.style.display = 'block';
}

// Клик по выпадающему списку напоминания.
function selectReminderClient(id, name) {
  selectedReminderClientId = id;
  document.getElementById('reminderClientId').value = id;
  document.getElementById('reminderClientSearch').value = name;
  document.getElementById('reminderClientDropdown').style.display = 'none';
  updateReminderClientLink();
}

// Обновить видимую привязку компании (ссылку-блок) в модалке напоминания.
function updateReminderClientLink() {
  const link = document.getElementById('reminderClientLink');
  if (!link) return;
  const cid = selectedReminderClientId;
  if (!cid) {
    link.style.display = 'none';
    link.innerHTML = '';
    return;
  }
  const client = clients.find(c => c.id === cid);
  if (!client) {
    link.style.display = 'none';
    return;
  }
  link.style.display = 'block';
  link.innerHTML = `🏢 <strong>${escapeHtml(client.orgName)}</strong> <button type="button" onclick="unlinkReminderFromClient()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;margin-left:6px;">✕ убрать</button>`;
}

// Глобальный делегированный клик по выпадающим спискам typeahead (компании).
document.addEventListener('click', (e) => {
  const item = e.target.closest('.client-typeahead-item');
  if (!item) return;
  const id = parseInt(item.dataset.id, 10);
  const name = item.dataset.name;
  const container = item.closest('.client-typeahead-group');
  if (!container) return;
  const searchInput = container.querySelector('input');
  if (searchInput && searchInput.id === 'taskClientSearch') {
    selectTaskClient(id, name);
  } else if (searchInput && searchInput.id === 'reminderClientSearch') {
    selectReminderClient(id, name);
  }
});

// Закрытие выпадающего списка при клике вне него.
document.addEventListener('click', (e) => {
  if (e.target.closest('.client-typeahead-group')) return;
  document.querySelectorAll('.client-typeahead-dropdown').forEach(d => d.style.display = 'none');
});

function initClientsResizer() {
  const resizer = document.getElementById('clientsResizer');
  const top = document.getElementById('clientsTop');
  const split = document.getElementById('clientsSplit');
  if (!resizer || !top || !split) return;

  if (clientsTopHeight) {
    top.style.height = clientsTopHeight + 'px';
    top.style.flex = 'none';
  }

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = top.offsetHeight;
    const maxHeight = split.offsetHeight - 150;

    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';

    const onMove = (ev) => {
      const h = Math.min(maxHeight, Math.max(120, startHeight + (ev.clientY - startY)));
      top.style.height = h + 'px';
      top.style.flex = 'none';
      clientsTopHeight = h;
    };
    const onUp = () => {
      resizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ===== Периодическая синхронизация (реальное время) ===== */

function startPolling() {
  if (pollingStarted) return;
  pollingStarted = true;
  setInterval(async () => {
    if (!currentUser) return;
    const changed = await apiPoll();
    if (!changed) return;
    resolveCurrentUserAfterHydrate();
    buildSidebar();   // перестроить меню (могла измениться роль/права)
    updateUserInfo();
    updateTasksMenuBadge();
    updateNotificationBadge();
    renderSection(currentSection);
  }, 5000);
}

/* ===== Загрузка приложения ===== */

document.addEventListener('DOMContentLoaded', () => {
  const data = loadData();
  clients = data.clients;
  contacts = data.contacts;
  loadUsers();
  loadInteractionTypes();
  loadTasks();
  loadReminders();
  loadNotifications();
  loadOrders();

  if (restoreSession()) {
    enterApp();
  }
});

/* ============================================================
   js/news.js — раздел «Новости».

   Пока это только каркас раздела: ленты новостей ещё нет, но пункт
   меню и отрисовка готовы, чтобы добавлять объявления для команды.
   Когда появится модель данных, достаточно:
     1) завести коллекцию news в db.json (server.js + js/api.js по
        образцу interactionTypes);
     2) заменить заглушку в renderNews() на список записей.
   ============================================================ */

// Новостей пока нет — раздел существует как заготовка под будущую ленту.
let newsItems = [];

function renderNews() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  main.innerHTML = `
    <div class="news-page">
      <div class="news-head">
        <h1>📰 Новости</h1>
        <span class="news-badge">раздел в разработке</span>
      </div>

      ${newsItems.length === 0 ? `
        <div class="news-empty">
          <div class="news-empty-icon">📰</div>
          <h2>Лента новостей и объявлений для команды</h2>
          <p>
            Раздел уже в меню, но пока пуст. Здесь будут общие объявления:
            изменения в работе, новости по клиентам и заказам, важные напоминания
            для всех менеджеров.
          </p>
        </div>
      ` : `
        <div class="news-list">
          ${newsItems.map(item => `
            <article class="news-item">
              <div class="news-item-date">${escapeHtml(item.date || '')}</div>
              <h3>${escapeHtml(item.title || '')}</h3>
              <p>${escapeHtml(item.text || '')}</p>
            </article>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

/* ============================================================
   js/dadata.js — интеграция с внешним сервисом подсказок (Дадата).

   Все запросы идут через собственный сервер (server.js), а не напрямую
   в Дадату: так API-ключ не попадает в браузер и в исходники страницы.
   Если ключ не задан, интеграция честно сообщает об этом, а подсказки
   городов продолжают работать по локальному справочнику (js/geo.js).
   ============================================================ */

const DADATA_STATE = { checked: false, configured: false, source: null, error: '' };

// Статус интеграции. Кэшируется, force=true — перечитать с сервера.
async function dadataStatus(force) {
  if (DADATA_STATE.checked && !force) return DADATA_STATE;
  DADATA_STATE.checked = true;
  try {
    const res = await fetch('/api/integrations/status', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    DADATA_STATE.configured = !!(j && j.dadata && j.dadata.configured);
    DADATA_STATE.source = (j && j.dadata && j.dadata.source) || null;
    DADATA_STATE.error = '';
  } catch (err) {
    DADATA_STATE.configured = false;
    DADATA_STATE.source = null;
    DADATA_STATE.error = 'нет связи с сервером';
  }
  return DADATA_STATE;
}

const DADATA_NOT_CONFIGURED =
  'Автозаполнение по ИНН не настроено: добавьте ключ DaData ' +
  'в разделе «Администрирование → Интеграции».';

// Реквизиты организации по ИНН/ОГРН.
// Возвращает { ok: true, party } либо { ok: false, error, notConfigured }.
async function fetchPartyByInn(inn) {
  try {
    const res = await fetch('/api/suggest/party?inn=' + encodeURIComponent(inn), { cache: 'no-store' });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) {
      const code = j && j.code;
      return {
        ok: false,
        error: (j && j.error) || ('HTTP ' + res.status),
        notConfigured: code === 'NO_TOKEN'
      };
    }
    return { ok: true, party: j.party };
  } catch (err) {
    return { ok: false, error: 'Нет связи с сервером приложения' };
  }
}

// Подсказки городов. Основной источник — Дадата, запасной — локальный
// справочник; результаты объединяются, чтобы подсказки были даже при сбое.
async function citySuggestions(query, countryCode, limit) {
  const max = limit || 10;
  const local = matchLocalCities(query, countryCode, max);
  const status = await dadataStatus();
  if (!status.configured) return { items: local, source: 'local' };

  try {
    const res = await fetch(
      '/api/suggest/city?q=' + encodeURIComponent(query) +
      '&country=' + encodeURIComponent(countryCode || ''),
      { cache: 'no-store' }
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const cities = (j && j.cities) || [];
    if (!cities.length) return { items: local, source: 'local' };

    const extra = local.filter(c => !cities.some(x => x.toLowerCase() === c.toLowerCase()));
    return { items: cities.concat(extra).slice(0, max), source: 'dadata' };
  } catch (err) {
    return { items: local, source: 'local' };
  }
}

// Разметка выпадающего списка стран (для формы клиента).
function countryOptionsHtml(selected) {
  const sel = (selected && countryExists(selected)) ? selected : DEFAULT_COUNTRY;
  return COUNTRIES.map(c =>
    `<option value="${c.code}"${c.code === sel ? ' selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');
}

/**
 * anuncios.js - Modulo Anuncios: Meta Ads anuncio por anuncio.
 *
 * Toma la tabla months[].ads que arma scripts/build-ads-data.py (una fila por anuncio del mes, en
 * columnas para que el archivo no pese el doble) y la pinta con el mes que este elegido en Gasto
 * publicitario: los dos modulos comparten el mes, asi que cambiarlo en uno repinta el otro.
 *
 * El "resultado" de un anuncio no es el mismo en toda la cuenta: una pieza de Ventas resuelve compras,
 * una de Mensajes conversaciones o visitas al perfil, y una de Reconocimiento ThruPlays. Por eso la
 * columna dice de que resultado habla cada fila y el Top 3 lleva una tarjeta por tipo de campana, en vez
 * de un ranking unico que compararia compras con reproducciones de video.
 */
(function () {
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const ANNUAL = 'Anual';
  const GROUPS = ['Ventas', 'Mensajes', 'Reconocimiento'];
  const GROUP_NOTE = { Ventas: 'compras en la tienda online', Mensajes: 'conversaciones y visitas al perfil', Reconocimiento: 'reproducciones completas' };
  const SUMS = ['spend', 'impressions', 'reach', 'clicks', 'landingViews', 'addToCart', 'checkouts',
                'purchases', 'revenue', 'conversations', 'profileVisits', 'thruplays'];
  const DENSITY_KEY = 'tlm_ads_density';
  const state = { data: null, cols: null, month: null, group: 'all', compact: false, full: false };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const isNum = value => value != null && value !== '' && Number.isFinite(Number(value));
  const symbol = () => { const value = state.data?.platform?.symbol || 'S/.'; return value === 'S/' ? 'S/.' : value; };
  const count = value => isNum(value) ? Math.round(Number(value)).toLocaleString('es-PE') : '—';
  const money = (value, digits = 2) => isNum(value)
    ? `${symbol()} ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
    : '—';
  // Un costo por ThruPlay son centavos: con dos decimales toda la columna queda en "S/. 0.00".
  const cost = value => !isNum(value) ? '—' : money(value, Number(value) < 0.1 ? 3 : 2);
  const roas = value => isNum(value) ? `${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x` : '—';
  const nothing = '<span class="no-data">—</span>';

  function readPref(key, fallback) {
    try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  function savePref(key, value) {
    try { window.localStorage.setItem(key, String(value)); } catch { /* sin localStorage no se recuerda, y ya */ }
  }

  // ── Datos ──────────────────────────────────────────────────────────────────
  // La fila de months[].ads llega como arreglo: el orden lo manda adColumns, en la raiz del archivo.
  function toAd(row) {
    const ad = {};
    state.cols.forEach((name, index) => { ad[name] = row[index]; });
    ad.key = `${ad.name}|${ad.campaign}`;
    ad.costPerResult = ad.results > 0 ? ad.spend / ad.results : null;
    ad.cpm = ad.impressions > 0 ? ad.spend / ad.impressions * 1000 : null;
    ad.roas = ad.spend > 0 && ad.revenue > 0 ? ad.revenue / ad.spend : null;
    return ad;
  }
  const monthsWithAds = () => (state.data?.months || []).filter(month => (month.ads || []).length);
  const monthByName = name => (state.data?.months || []).find(month => month.name === name);

  function adsOf(name) {
    if (name === ANNUAL) {
      // En el acumulado un anuncio puede haber corrido en varios meses: se suman sus cifras y sus dias.
      const total = new Map();
      monthsWithAds().forEach(month => month.ads.map(toAd).forEach(ad => {
        const found = total.get(ad.key);
        if (!found) { total.set(ad.key, { ...ad }); return; }
        SUMS.forEach(key => { found[key] += ad[key]; });
        found.results += ad.results;
        found.days += ad.days;
        if (!found.url) found.url = ad.url;
      }));
      return [...total.values()].map(ad => ({ ...ad,
        costPerResult: ad.results > 0 ? ad.spend / ad.results : null,
        cpm: ad.impressions > 0 ? ad.spend / ad.impressions * 1000 : null,
        roas: ad.spend > 0 && ad.revenue > 0 ? ad.revenue / ad.spend : null }));
    }
    return (monthByName(name)?.ads || []).map(toAd);
  }

  // El mes anterior con anuncios, que no siempre es el de al lado: febrero de 2026 estuvo vacio mucho tiempo.
  function previousOf(name) {
    if (name === ANNUAL) return null;
    const index = MONTHS.indexOf(name);
    for (let i = index - 1; i >= 0; i -= 1) {
      const month = monthByName(MONTHS[i]);
      if ((month?.ads || []).length) return month;
    }
    return null;
  }

  // ── Pintado ────────────────────────────────────────────────────────────────
  function renderTabs() {
    const host = document.getElementById('ads-month-tabs');
    if (!host) return;
    const tab = (name, available) => {
      const selected = name === state.month;
      return `<button type="button" class="month-tab ${selected ? 'active' : ''}" data-month="${esc(name)}" aria-pressed="${selected}"${available ? '' : ' disabled title="Sin anuncios en la hoja de este mes"'}>${esc(name)}</button>`;
    };
    host.innerHTML = MONTHS.map(name => tab(name, Boolean((monthByName(name)?.ads || []).length))).join('')
      + tab(ANNUAL, Boolean(monthsWithAds().length));
  }

  function nameLink(ad) {
    const name = esc(ad.name);
    return /^https:\/\//.test(ad.url || '') ? `<a href="${esc(ad.url)}" target="_blank" rel="noopener">${name} <span aria-hidden="true">↗</span></a>` : name;
  }

  function renderTop(ads) {
    const host = document.getElementById('ads-top');
    if (!host) return;
    const head = '<div class="ad-top-head">Mejor anuncio de cada tipo de campaña</div>';
    const cards = GROUPS.map(group => {
      const best = ads.filter(ad => ad.group === group && ad.results > 0)
        .sort((a, b) => (b.results - a.results) || ((a.costPerResult ?? Infinity) - (b.costPerResult ?? Infinity)))[0];
      if (!best) return `<div class="ad-top-card empty"><div class="ad-top-group">${esc(group)}</div><p class="ad-top-none">Ningún anuncio registró ${esc(GROUP_NOTE[group])} en el periodo.</p></div>`;
      return `<div class="ad-top-card">
        <div class="ad-top-group">${esc(group)}</div>
        <div class="ad-top-name" title="${esc(best.name)}">${nameLink(best)}</div>
        <div class="ad-top-value">${count(best.results)}<small>${esc(best.resultType || 'resultados')}</small></div>
        <div class="ad-top-meta">${cost(best.costPerResult)} por resultado · ${money(best.spend)} de inversión</div>
      </div>`;
    }).join('');
    host.innerHTML = `${head}<div class="ad-top-list">${cards}</div>`;
  }

  function renderFilter(ads) {
    const select = document.getElementById('ads-group');
    if (!select) return;
    const present = GROUPS.filter(group => ads.some(ad => ad.group === group));
    if (state.group !== 'all' && !present.includes(state.group)) state.group = 'all';
    select.innerHTML = ['<option value="all">Todos los tipos</option>']
      .concat(present.map(group => `<option value="${esc(group)}"${group === state.group ? ' selected' : ''}>${esc(group)}</option>`))
      .join('');
  }

  function variation(now, before) {
    if (!isNum(before) || Number(before) === 0) return nothing;
    const change = (Number(now) - Number(before)) / Number(before);
    const sign = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '●';
    return `<span class="kpi-delta ${sign}">${arrow} ${Math.abs(change * 100).toFixed(1)}%</span>`;
  }

  function render() {
    if (!state.data || !state.cols) return;
    const name = state.month;
    const month = monthByName(name);
    const ads = adsOf(name);
    const previous = previousOf(name);
    const before = new Map((previous?.ads || []).map(toAd).map(ad => [ad.key, ad]));

    renderTabs();
    renderTop(ads);
    renderFilter(ads);

    const title = document.getElementById('ads-period-title');
    const sub = document.getElementById('ads-period-sub');
    if (title) title.textContent = name === ANNUAL
      ? `Anuncios del año · ${monthsWithAds().length} meses con datos`
      : `Anuncios · ${month?.period || name}`;
    if (sub) sub.textContent = previous
      ? `Comparación de resultados contra ${previous.name}.`
      : 'Sin mes anterior con anuncios para comparar.';

    const order = new Map(GROUPS.map((group, index) => [group, index]));
    const sorted = [...ads].sort((a, b) =>
      ((order.get(a.group) ?? 9) - (order.get(b.group) ?? 9)) || (b.results - a.results) || (b.spend - a.spend));
    const leaders = new Set();
    sorted.forEach(ad => { if (ad.results > 0 && !leaders.has(ad.group)) { leaders.add(ad.group); ad.leader = true; } });
    const rows = state.group === 'all' ? sorted : sorted.filter(ad => ad.group === state.group);

    const tableTitle = document.getElementById('ads-table-title');
    const tableSub = document.getElementById('ads-table-sub');
    const prevHead = document.getElementById('ads-prev-head');
    if (tableTitle) tableTitle.textContent = `Anuncios | ${name === ANNUAL ? 'Año 2026' : `${name} 2026`}`;
    if (tableSub) tableSub.textContent = `${rows.length} ${rows.length === 1 ? 'anuncio' : 'anuncios'} ordenados por resultados dentro de cada tipo. La estrella marca al líder de su tipo.`;
    if (prevHead) prevHead.textContent = previous ? `Resultados ${previous.name}` : 'Mes anterior';

    const body = document.getElementById('ads-board-body');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td class="table-empty" colspan="17">No hay anuncios de este tipo en el periodo.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(ad => {
      const previousAd = before.get(ad.key);
      return `<tr>
        <td><span class="group-pill">${esc(ad.group || '—')}</span></td>
        <td class="ad-name-col" title="${esc(ad.name)}">${ad.leader ? '<b class="leader-star" title="Líder de su tipo">★</b> ' : ''}${nameLink(ad)}</td>
        <td class="ad-set-col">${esc(ad.campaign)}<small>${esc(ad.adSet || '—')}</small></td>
        <td>${ad.resultType ? `<span class="type-pill">${esc(ad.resultType)}</span>` : nothing}</td>
        <td class="num"><b>${ad.results > 0 ? count(ad.results) : nothing}</b></td>
        <td class="num">${previousAd && previousAd.results > 0 ? count(previousAd.results) : nothing}</td>
        <td class="num">${previous ? variation(ad.results, previousAd?.results) : nothing}</td>
        <td class="num">${cost(ad.costPerResult)}</td>
        <td class="num">${money(ad.spend)}</td>
        <td class="num">${ad.purchases > 0 ? count(ad.purchases) : nothing}</td>
        <td class="num">${ad.revenue > 0 ? money(ad.revenue) : nothing}</td>
        <td class="num">${roas(ad.roas)}</td>
        <td class="num">${count(ad.impressions)}</td>
        <td class="num">${count(ad.reach)}</td>
        <td class="num">${money(ad.cpm)}</td>
        <td class="num">${count(ad.clicks)}</td>
        <td class="num">${count(ad.days)}</td>
      </tr>`;
    }).join('');
  }

  // ── Herramientas de la tabla ───────────────────────────────────────────────
  function applyDensity() {
    const scroll = document.getElementById('ads-table-scroll');
    const button = document.getElementById('ads-density-btn');
    scroll?.classList.toggle('compact', state.compact);
    button?.setAttribute('aria-pressed', String(state.compact));
  }
  function applyFullscreen() {
    const section = document.getElementById('view-ads');
    const button = document.getElementById('ads-expand-btn');
    section?.classList.toggle('table-full', state.full);
    document.body.classList.toggle('ads-table-full', state.full);
    button?.setAttribute('aria-pressed', String(state.full));
    if (button) button.textContent = state.full ? '⤡ Salir de pantalla completa' : '⤢ Pantalla completa';
  }

  function wire() {
    document.getElementById('ads-month-tabs')?.addEventListener('click', event => {
      const tab = event.target.closest('.month-tab:not(:disabled)');
      if (!tab) return;
      state.month = tab.dataset.month;
      // El mes es compartido: Gasto publicitario se entera y se repinta con el mismo.
      window.TLMObjectives?.selectMonth?.(state.month);
      render();
    });
    document.getElementById('ads-group')?.addEventListener('change', event => {
      state.group = event.target.value;
      render();
    });
    document.getElementById('ads-density-btn')?.addEventListener('click', () => {
      state.compact = !state.compact;
      savePref(DENSITY_KEY, state.compact);
      applyDensity();
    });
    document.getElementById('ads-expand-btn')?.addEventListener('click', () => {
      state.full = !state.full;
      applyFullscreen();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.full) { state.full = false; applyFullscreen(); }
    });
    window.addEventListener('tlm:month-changed', event => {
      const name = event.detail?.month;
      if (!name || name === state.month) return;
      state.month = name;
      render();
    });
  }

  function load() {
    const data = window.TLMObjectives?.snapshot?.();
    if (!data || !Array.isArray(data.adColumns)) return false;
    state.data = data;
    state.cols = data.adColumns;
    const available = monthsWithAds();
    if (!state.month) {
      const shared = window.TLMObjectives?.month?.();
      state.month = shared && (shared === ANNUAL || (monthByName(shared)?.ads || []).length)
        ? shared
        : available[available.length - 1]?.name || ANNUAL;
    }
    render();
    return true;
  }

  function start() {
    state.compact = readPref(DENSITY_KEY, 'false') === 'true';
    wire();
    applyDensity();
    // El modulo puede abrirse antes de que Gasto publicitario termine de cargar, y despues de cada
    // sincronizacion hay datos nuevos: en los dos casos se vuelve a leer con el mismo evento.
    load();
    window.addEventListener('tlm:data-updated', load);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

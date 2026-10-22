(function () {
  // Datos generados por scripts/build-ads-data.py desde las exportaciones mensuales de Meta Ads en Drive.
  // En el build llegan incrustados como window.TLM_ADS_DATA.
  const DATA_URL = 'data/tlm-ads-2026.json';
  // Informe por dia (filas por dia, campana y anuncio) del mismo script: da el tramo real del mes anterior.
  const DAILY_URL = 'data/tlm-ads-daily.json';
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const SHORT_MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const GROUP_CLASS = { Ventas: 'sales', Mensajes: 'messages', Reconocimiento: 'branding' };
  const COLORS = { spend: '#2563eb', revenue: '#0d9488', costPerPurchase: '#db2777', costPerConversation: '#0f766e' };
  const CHART_METRICS = {
    spend: { label: 'Inversión y ventas', money: true, sub: 'Inversión en Meta Ads frente al valor de las compras atribuidas a los anuncios (S/.)', series: [['spend', 'Inversión'], ['revenue', 'Valor de compras']] },
    purchases: { label: 'Compras', sub: 'Compras en la tienda online atribuidas a los anuncios (pixel de Meta)', series: [['purchases', 'Compras']] },
    conversations: { label: 'Conversaciones', sub: 'Conversaciones de WhatsApp iniciadas desde los anuncios', series: [['conversations', 'Conversaciones']] },
    clicks: { label: 'Clics en el enlace', sub: 'Clics en el enlace de todas las campañas', series: [['clicks', 'Clics en el enlace']] },
    // Costos por resultado: salen de sumar la inversion y los resultados de su tipo de campana en el mes (los
    // mismos de los KPIs); un mes sin compras o sin conversaciones queda como hueco.
    costPerPurchase: { label: 'Costo por compra', money: true, cost: true, sub: 'Inversión de la campaña de Ventas / compras de cada mes (sin compras, hueco)', series: [['costPerPurchase', 'Costo por compra']] },
    costPerConversation: { label: 'Costo por conversación', money: true, cost: true, sub: 'Inversión de la campaña de Mensajes / conversaciones de cada mes (sin conversaciones, hueco)', series: [['costPerConversation', 'Costo por conversación']] },
  };
  // Grupo de campanas del que sale cada costo por resultado y su resultado.
  const COST_BASES = { costPerPurchase: ['Ventas', 'purchases'], costPerConversation: ['Mensajes', 'conversations'] };
  // Columnas de los mejores anuncios segun el tipo de campana.
  const AD_COLUMNS = {
    Ventas: [['purchases', 'Compras'], ['revenue', 'Valor', true], ['clicks', 'Clics']],
    Mensajes: [['conversations', 'Conversaciones'], ['profileVisits', 'Visitas al perfil'], ['clicks', 'Clics']],
    Reconocimiento: [['thruplays', 'ThruPlays'], ['impressions', 'Impresiones'], ['clicks', 'Clics']],
  };
  const CHART_COLLAPSED_KEY = 'tlm-chart-collapsed-v1';
  const CHART_METRIC_KEY = 'tlm-ads-chart-metric-v1';
  // Web App de Apps Script (scripts/sync-trigger.gs) que lanza el workflow sync-ads-data.yml con un token
  // guardado en Apps Script: el tablero no lleva credenciales ni abre GitHub. Si quedara vacio, el boton solo
  // vuelve a leer los datos publicados por la sincronizacion automatica.
  const SYNC_TRIGGER_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyoEjOyQ8FfCZLnulkTVO8C2KURxLQfWFZwppLM-EMpcZsQNW0NvN4qq6MOKODxuXTMHA/exec';
  const SYNC_TRIGGER_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
  const SYNC_SCHEDULE = 'automática 7:00 a. m., 12:00 m. y 5:00 p. m.';
  const SYNC_POLL_MS = 15000;
  const SYNC_TIMEOUT_MS = 10 * 60 * 1000;
  // La sincronizacion corre tres veces al dia: mas de un dia sin datos nuevos pone la pildora en aviso.
  const STALE_MS = 26 * 3600000;
  // Indicadores de Gasto con variacion contra el mes anterior: la inversion es neutra; en los demas, subir es bueno.
  const KPI_DEFS = [
    { key: 'spend', label: 'Inversión Meta Ads', name: 'inversión', money: true, better: null },
    { key: 'revenue', label: 'Valor de compras', name: 'valor de compras', money: true, better: 'up' },
    { key: 'purchases', label: 'Compras', name: 'compras', better: 'up' },
    { key: 'conversations', label: 'Conversaciones', name: 'conversaciones', better: 'up' },
    { key: 'clicks', label: 'Clics en el enlace', name: 'clics', better: 'up' },
  ];
  const COMPARE_KEYS = KPI_DEFS.map(kpi => kpi.key);
  // Chart.js en Inter, como Royal Baby (ejes, tooltips y leyendas de los graficos del tablero).
  if (window.Chart?.defaults?.font) window.Chart.defaults.font.family = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const state = { data: null, month: null, chart: null, group: 'all', metric: readPref(CHART_METRIC_KEY, 'spend'), chartCollapsed: readPref(CHART_COLLAPSED_KEY, 'false') === 'true', open: new Set(), syncing: false, syncError: false, loadError: false, daily: null };

  function readPref(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, String(value)); } catch {}
  }

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  // Solo enlaces https de Facebook (vista previa de anuncios); descarta cualquier otro esquema.
  const safeUrl = value => /^https:\/\/(www\.)?facebook\.com\//i.test(String(value || '')) ? esc(value) : '';
  const isNum = value => value != null && value !== '' && Number.isFinite(Number(value));
  const ratio = (value, count) => isNum(value) && Number(count) > 0 ? Number(value) / Number(count) : null;
  const fmtCount = value => isNum(value) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '—';
  const fmtPct = value => isNum(value) ? `${Number(value).toLocaleString('es-PE', { maximumFractionDigits: 1 })}%` : '—';
  const fmtRoas = value => isNum(value) ? `${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x` : '—';
  // Moneda "S/. " como Royal Baby: los datos de la sincronizacion traen "S/" y se muestra con punto.
  function symbol() { const value = state.data?.platform?.symbol || 'S/.'; return value === 'S/' ? 'S/.' : value; }
  function fmtMoney(value, digits = 2) {
    if (!isNum(value)) return '—';
    return `${symbol()} ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }
  // Los costos por ThruPlay o por clic pueden ser de centimos: tres decimales para no perderlos.
  const fmtCost = value => fmtMoney(value, isNum(value) && Number(value) < 0.1 ? 3 : 2);
  function fmtCompact(value, money) {
    if (value == null) return '';
    const prefix = money ? `${symbol()} ` : '';
    if (Math.abs(value) >= 1e6) return `${prefix}${(value / 1e6).toFixed(2)}M`;
    if (Math.abs(value) >= 1e3) return `${prefix}${(value / 1e3).toFixed(1)}k`;
    return `${prefix}${money ? Number(value).toFixed(0) : Math.round(value)}`;
  }
  function monthData(name) { return state.data.months.find(month => month.name === name); }
  function hasData(month) { return Boolean(month?.kpis); }
  // Pestana "Anual" junto a las de mes (como en Terminal Pesquero): acumula todos los meses con datos.
  const ANNUAL = 'Anual';
  function current() { return state.month === ANNUAL ? annualMonth() : monthData(state.month); }
  function sumInto(target, source, skip = []) {
    Object.entries(source).forEach(([key, value]) => {
      if (typeof value === 'number' && !skip.includes(key)) target[key] = (target[key] || 0) + value;
    });
  }
  // Las campanas y sus mejores anuncios de todo el ano, sumados por nombre.
  function annualMonth() {
    const months = state.data.months.filter(hasData);
    const kpis = {}, spendByGroup = {}, campaigns = new Map();
    months.forEach(month => {
      sumInto(kpis, month.kpis);
      Object.entries(month.spendByGroup || {}).forEach(([group, value]) => { spendByGroup[group] = (spendByGroup[group] || 0) + value; });
      month.campaigns.forEach(campaign => {
        const item = campaigns.get(campaign.name) || { name: campaign.name, objective: campaign.objective, group: campaign.group, ads: new Map() };
        sumInto(item, campaign, ['cpm', 'cpc']);
        (campaign.topAds || []).forEach(ad => {
          const merged = item.ads.get(ad.name) || { name: ad.name, url: ad.url };
          sumInto(merged, ad);
          if (!merged.url && ad.url) merged.url = ad.url;
          item.ads.set(ad.name, merged);
        });
        campaigns.set(campaign.name, item);
      });
    });
    const order = { Ventas: 0, Mensajes: 1, Reconocimiento: 2 };
    const sortKeys = { Ventas: ['purchases', 'revenue', 'clicks'], Mensajes: ['conversations', 'profileVisits', 'clicks'], Reconocimiento: ['thruplays', 'impressions'] };
    const list = [...campaigns.values()].map(({ ads, ...campaign }) => {
      const keys = sortKeys[campaign.group] || ['clicks'];
      const topAds = [...ads.values()].sort((a, b) => keys.reduce((diff, key) => diff || (b[key] || 0) - (a[key] || 0), 0) || b.spend - a.spend).slice(0, 5);
      return { ...campaign, cpm: campaign.impressions ? campaign.spend / campaign.impressions * 1000 : null, cpc: campaign.clicks ? campaign.spend / campaign.clicks : null, topAds };
    }).sort((a, b) => (order[a.group] ?? 3) - (order[b.group] ?? 3) || b.spend - a.spend);
    const last = months[months.length - 1];
    return {
      name: ANNUAL, annual: true, months, kpis, spendByGroup, campaigns: list,
      status: last?.status, firstDay: months[0]?.firstDay, lastDay: last?.lastDay,
      period: last ? `${months[0].name} a ${last.name} 2026` : '',
    };
  }
  function longDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return match ? `${Number(match[3])} de ${MONTHS[Number(match[2]) - 1].toLowerCase()}` : '—';
  }
  function groupPill(group) {
    return `<span class="group-pill ${GROUP_CLASS[group] || ''}">${esc(group)}</span>`;
  }
  // Totales de las campanas de un tipo (Ventas, Mensajes, Reconocimiento) en uno o varios meses.
  function groupTotals(months, group) {
    const totals = { spend: 0, impressions: 0, clicks: 0, landingViews: 0, addToCart: 0, checkouts: 0, purchases: 0, revenue: 0, conversations: 0, profileVisits: 0, thruplays: 0 };
    months.forEach(month => (month.campaigns || []).filter(campaign => campaign.group === group).forEach(campaign => {
      Object.keys(totals).forEach(key => { totals[key] += Number(campaign[key] || 0); });
    }));
    return totals;
  }

  // Resultado principal de cada campana segun su objetivo.
  function mainResult(campaign) {
    if (campaign.group === 'Ventas') return { value: campaign.purchases, label: campaign.purchases === 1 ? 'compra' : 'compras' };
    if (campaign.group === 'Mensajes') return { value: campaign.conversations, label: 'conversaciones' };
    if (campaign.group === 'Reconocimiento') return { value: campaign.thruplays, label: 'ThruPlays' };
    return { value: campaign.clicks, label: 'clics' };
  }

  // ── Comparacion con el mes anterior (mismo criterio que Royal Baby y Tierra Films) ──
  const pad = value => String(value).padStart(2, '0');
  const daysIn = (year, index) => new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const dayOf = iso => Number(String(iso || '').slice(8, 10)) || null;
  const rangeText = (index, from, to) => `${from === to ? to : `${from}-${to}`} ${MONTHS[index]}`;
  const listText = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items.join(''));
  const KPI_NAMES = Object.fromEntries(KPI_DEFS.map(kpi => [kpi.key, kpi.name]));

  // Informe por dia sumado por fecha: Map "2026-09-01" -> { spend, revenue, purchases, conversations, clicks }.
  // Sus filas traen d = dias desde firstDay. Sin informe (o con otro formato) queda null y se prorratea.
  function dailyTotals(daily) {
    const columns = Array.isArray(daily?.columns) ? daily.columns : [];
    const start = Date.parse(`${daily?.firstDay}T00:00:00Z`);
    const dayCol = columns.indexOf('d');
    if (!Array.isArray(daily?.rows) || dayCol < 0 || !Number.isFinite(start)) return null;
    const cols = COMPARE_KEYS.map(key => [key, columns.indexOf(key)]).filter(([, index]) => index >= 0);
    const byDay = new Map();
    daily.rows.forEach(row => {
      if (!Number.isFinite(Number(row[dayCol]))) return;
      const day = new Date(start + Number(row[dayCol]) * 86400000).toISOString().slice(0, 10);
      const totals = byDay.get(day) || {};
      cols.forEach(([key, index]) => { totals[key] = (totals[key] || 0) + Number(row[index] || 0); });
      byDay.set(day, totals);
    });
    return byDay;
  }
  // Periodo de un mes: completo si esta cerrado; en curso, del 1 al ultimo dia con datos ("1-18 Octubre").
  function periodOf(data, byDay, month) {
    const index = MONTHS.indexOf(month.name);
    const closed = month.status !== 'parcial';
    const to = closed ? daysIn(data.year, index) : dayOf(month.lastDay) || daysIn(data.year, index);
    return { index, closed, to, label: rangeText(index, 1, to), compare: compareOf(data, byDay, index, closed, to) };
  }
  // Un mes cerrado se compara contra el mes anterior completo. Un mes en curso, contra el mismo tramo del mes
  // anterior: cada suma sale del informe por dia cuando ese informe cubre el mes anterior y, si no, del mes
  // anterior prorrateado a los mismos dias. Sin mes anterior con datos, null.
  function compareOf(data, byDay, index, closed, to) {
    const previous = index > 0 ? data.months.find(item => item.name === MONTHS[index - 1]) : null;
    if (!hasData(previous)) return null;
    const prevIndex = index - 1;
    const prevDays = daysIn(data.year, prevIndex);
    const full = Object.fromEntries(COMPARE_KEYS.map(key => [key, Number(previous.kpis[key] || 0)]));
    if (closed || to >= prevDays) {
      const label = rangeText(prevIndex, 1, prevDays);
      return { totals: full, real: [], label, shortFor: () => label };
    }
    const tramo = dailyTramo(byDay, data.year, prevIndex, to, full);
    const real = COMPARE_KEYS.filter(key => key in tramo);
    const factor = to / prevDays;
    const tramoLabel = rangeText(prevIndex, 1, to);
    const prorated = `${MONTHS[prevIndex]} prorrateado a ${to} ${to === 1 ? 'día' : 'días'}`;
    return {
      totals: Object.fromEntries(COMPARE_KEYS.map(key => [key, key in tramo ? tramo[key] : full[key] * factor])),
      real,
      label: real.length === COMPARE_KEYS.length ? tramoLabel
        : real.length ? `${tramoLabel} en ${listText(real.map(key => KPI_NAMES[key]))}; el resto, ${prorated}` : prorated,
      shortFor: key => (key in tramo ? tramoLabel : `${SHORT_MONTHS[prevIndex]} prorrateado`),
    };
  }
  // Sumas del 1 al dia "to" del mes anterior en el informe por dia. Una suma solo vale si el informe da en todo ese
  // mes lo mismo que su hoja mensual: si empieza tarde (julio arranca el 6) o le faltan dias, queda prorrateada.
  function dailyTramo(byDay, year, index, to, full) {
    if (!byDay) return {};
    const prefix = `${year}-${pad(index + 1)}-`;
    const month = {}, tramo = {};
    let days = 0;
    byDay.forEach((totals, day) => {
      if (!day.startsWith(prefix)) return;
      days += 1;
      COMPARE_KEYS.forEach(key => {
        month[key] = (month[key] || 0) + (totals[key] || 0);
        if (dayOf(day) <= to) tramo[key] = (tramo[key] || 0) + (totals[key] || 0);
      });
    });
    if (!days) return {};
    return Object.fromEntries(COMPARE_KEYS.filter(key => Math.abs((month[key] || 0) - full[key]) < 0.015).map(key => [key, tramo[key] || 0]));
  }
  const change = (now, before) => (isNum(now) && isNum(before) && Number(before) !== 0 ? (now - before) / before : null);
  // "▲ 12.3% vs 1-18 Septiembre". El color depende de si subir es bueno para el indicador; la inversion es neutra.
  function deltaHtml(now, before, better, label) {
    const d = change(now, before);
    if (d === null) return `<small class="kpi-delta flat">Sin dato en ${esc(label)}</small>`;
    const direction = Math.abs(d) < 0.0005 ? 'flat' : d > 0 ? 'up' : 'down';
    const tone = direction === 'flat' || !better ? 'flat' : direction === better ? 'good' : 'bad';
    const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '●';
    const pct = (Math.abs(d) * 100).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `<small class="kpi-delta ${tone}">${arrow} ${pct}% vs ${esc(label)}</small>`;
  }

  // ── Avisos de datos (hojas faltantes o copiadas) ───────────────────────────
  // Los avisos de la carpeta van en el detalle de la barra superior; la pildora se pone ambar mientras haya.
  function renderWarnings() {
    const host = document.getElementById('ads-warnings');
    const warnings = state.data.warnings || [];
    if (!host) return;
    host.hidden = !warnings.length;
    host.innerHTML = warnings.length ? `<strong>Revisar la carpeta de Drive</strong><ul>${warnings.map(text => `<li>${esc(text)}</li>`).join('')}</ul>` : '';
  }

  // ── KPIs acumulados del año ────────────────────────────────────────────────
  function yearTotals(months = state.data.months.filter(hasData)) {
    const totals = { spend: 0, revenue: 0, purchases: 0, conversations: 0, clicks: 0, landingViews: 0, months: months.length };
    months.forEach(month => Object.keys(totals).forEach(key => { if (key !== 'months') totals[key] += Number(month.kpis[key] || 0); }));
    return { ...totals, sales: groupTotals(months, 'Ventas'), messages: groupTotals(months, 'Mensajes') };
  }
  // Vista anual: promedio por mes en lugar de variacion (no hay datos del ano anterior). Mientras haya meses
  // cerrados el mes en curso queda fuera: un mes a medias bajaria el promedio.
  function monthlyAverage(period) {
    const closed = period.months.filter(month => month.status === 'cerrado');
    const months = closed.length ? closed : period.months;
    const totals = yearTotals(months);
    return { values: Object.fromEntries(COMPARE_KEYS.map(key => [key, totals[key] / months.length])), basis: `Promedio de ${months.map(month => month.name).join(', ')}` };
  }
  // KPIs del periodo elegido en las pestanas: un mes (con su variacion contra el mes anterior) o el acumulado del ano.
  function renderKpis() {
    const host = document.getElementById('kpi-strip');
    const period = current();
    if (!period) return;
    const t = yearTotals(period.annual ? period.months : [period]);
    const cutoff = longDate(state.data.cutoff);
    const notes = {
      spend: period.annual ? `Acumulado al ${cutoff} | ${t.months} meses con datos` : `${period.campaigns.length} campañas`,
      revenue: `ROAS ${fmtRoas(ratio(t.revenue, t.spend))} total | ${fmtRoas(ratio(t.sales.revenue, t.sales.spend))} en Ventas`,
      purchases: `${fmtMoney(ratio(t.sales.spend, t.sales.purchases))} por compra en Ventas`,
      conversations: `WhatsApp | ${fmtCost(ratio(t.messages.spend, t.messages.conversations))} por conversación`,
      clicks: `${fmtCost(ratio(t.spend, t.clicks))} por clic | ${fmtCompact(t.landingViews, false)} visitas a la web`,
    };
    const value = (kpi, number) => (kpi.money ? fmtMoney(number) : fmtCount(number));
    const average = period.annual ? monthlyAverage(period) : null;
    const compare = period.annual ? null : periodOf(state.data, state.daily, period).compare;
    host.innerHTML = KPI_DEFS.map(kpi => {
      const line = average
        ? `<small title="${esc(average.basis)}">Prom. mensual: ${value(kpi, average.values[kpi.key])}</small>`
        : compare
          ? deltaHtml(t[kpi.key], compare.totals[kpi.key], kpi.better, compare.shortFor(kpi.key))
          : '<small class="kpi-delta flat">Sin mes anterior para comparar</small>';
      return `<div class="kpi-pill"><span>${kpi.label}</span><strong>${value(kpi, t[kpi.key])}</strong>${line}<small>${notes[kpi.key]}</small></div>`;
    }).join('');
  }

  // ── Grafico mensual ────────────────────────────────────────────────────────
  function applyChartCollapsed() {
    const panel = document.getElementById('chart-panel');
    const button = document.getElementById('chart-toggle-btn');
    panel.classList.toggle('is-collapsed', state.chartCollapsed);
    button.setAttribute('aria-expanded', String(!state.chartCollapsed));
    button.setAttribute('title', state.chartCollapsed ? 'Expandir gráfico' : 'Minimizar gráfico');
  }
  function renderChart() {
    const metric = CHART_METRICS[state.metric] ? state.metric : 'spend';
    const config = CHART_METRICS[metric];
    document.getElementById('chart-title').textContent = `Evolución mensual · ${config.label} · 2026`;
    document.getElementById('chart-sub').textContent = config.sub;
    document.querySelectorAll('#chart-series-toggles .series-toggle').forEach(item => {
      const active = item.dataset.series === metric;
      item.classList.toggle('active', active);
      item.querySelector('input').checked = active;
    });
    const color = key => COLORS[key] || COLORS.spend;
    document.getElementById('chart-legend').innerHTML = config.series.map(([key, name]) => `<span><i class="legend-line" style="background:${color(key)}"></i><b>${esc(name)}</b></span>`).join(' ');
    if (state.chartCollapsed) return;
    const canvas = document.getElementById('chart-monthly');
    if (!canvas) return;
    if (typeof Chart === 'undefined') { canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Gráfico no disponible sin conexión.</strong><span>Los totales mensuales siguen visibles debajo.</span></div>'; return; }
    const lastIndex = state.data.months.reduce((last, month, index) => hasData(month) ? index : last, 0);
    const months = state.data.months.slice(0, lastIndex + 1);
    const labels = SHORT_MONTHS.slice(0, lastIndex + 1).map((name, index) => months[index]?.status === 'parcial' ? `${name}*` : name);
    const datasets = config.series.map(([key, name]) => ({
      label: name,
      data: months.map(month => chartValue(month, key)),
      borderColor: color(key),
      backgroundColor: color(key),
      borderWidth: 2.5,
      pointRadius: 5,
      pointHoverRadius: 7,
      tension: .3,
      cubicInterpolationMode: 'monotone',
      spanGaps: false,
    }));
    const axis = { beginAtZero: true, grace: '15%', border: { display: false }, ticks: { color: '#94A3B8', font: { size: 10 } } };
    const scales = {
      x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#94A3B8', font: { size: 10 } } },
      y: { ...axis, grid: { color: 'rgba(15,23,42,.06)' }, ticks: { ...axis.ticks, callback: value => (config.cost && Math.abs(value) < 10 ? fmtMoney(value) : fmtCompact(value, config.money)) } },
    };
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 22, right: 8, left: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: items => { const month = months[items[0].dataIndex]; return `${month.name}${month.status === 'parcial' ? ` (parcial, ${month.period})` : month.notice ? ` (${month.notice.toLowerCase()})` : ''}`; },
            label: context => context.raw == null ? ` ${context.dataset.label}: sin datos` : ` ${context.dataset.label}: ${config.cost ? fmtCost(context.raw) : config.money ? fmtMoney(context.raw) : fmtCount(context.raw)}`,
            footer: items => {
              const month = months[items[0].dataIndex];
              return metric === 'spend' && hasData(month) ? `ROAS ${fmtRoas(ratio(month.kpis.revenue, month.kpis.spend))}` : '';
            },
          } },
        },
        scales,
        onClick: (event, elements) => { if (elements[0]) selectMonth(months[elements[0].index].name); },
      },
      // Valor en cada punto, menos los ceros y los huecos. Va arriba en un pico y abajo en un valle, para no
      // montarse en la linea, con halo blanco; si choca con otra etiqueta (inversion y valor de compras van en el
      // mismo cuadro) o se sale del grafico prueba el otro lado y, si tampoco cabe, se omite (queda en el tooltip).
      plugins: [{ id: 'valueLabels', afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const placed = [];
        const overlaps = box => placed.some(other => !(box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom));
        const top = chart.chartArea.top - 20;
        const bottom = chart.chartArea.bottom;
        ctx.save();
        ctx.font = '600 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,.92)';
        chart.data.datasets.forEach((dataset, index) => {
          ctx.fillStyle = dataset.backgroundColor;
          chart.getDatasetMeta(index).data.forEach((dot, point) => {
            const value = dataset.data[point];
            if (!isNum(value) || Number(value) === 0) return;
            // Soles sin decimales, salvo montos chicos (un costo de S/ 0.45 no debe leerse S/ 0).
            const text = config.money && Math.abs(value) < 10 ? fmtCost(value) : fmtCompact(value, config.money);
            const half = ctx.measureText(text).width / 2 + 2;
            const before = dataset.data[point - 1];
            const after = dataset.data[point + 1];
            const valley = isNum(before) && isNum(after) && value < before && value < after;
            const sides = valley ? [dot.y + 12, dot.y - 11] : [dot.y - 11, dot.y + 12];
            // Pegada al borde, la etiqueta se corre hacia adentro para no cortarse.
            const x = Math.min(Math.max(dot.x, half), chart.width - half);
            const box = sides
              .map(y => ({ y, left: x - half, right: x + half, top: y - 6, bottom: y + 6 }))
              .find(item => item.top >= top && item.bottom <= bottom && !overlaps(item));
            if (!box) return;
            placed.push(box);
            ctx.strokeText(text, x, box.y);
            ctx.fillText(text, x, box.y);
          });
        });
        ctx.restore();
      } }],
    });
  }
  // Valor de un indicador del grafico en un mes; sin hoja del mes, hueco. Los costos, de las sumas de su tipo de
  // campana (sin resultados, hueco).
  function chartValue(month, key) {
    if (!hasData(month)) return null;
    if (COST_BASES[key]) {
      const [group, result] = COST_BASES[key];
      const totals = groupTotals([month], group);
      return ratio(totals.spend, totals[result]);
    }
    return Number(month.kpis[key] || 0);
  }

  // ── Mes seleccionado ───────────────────────────────────────────────────────
  function renderTabs() {
    const host = document.getElementById('month-tabs');
    const tab = (name, available, title, mark = '') => {
      const selected = name === state.month;
      return `<button type="button" class="month-tab ${selected ? 'active' : ''}" data-month="${name}" aria-pressed="${selected}" ${available ? '' : 'disabled'} ${title ? `title="${esc(title)}"` : ''}>${name}${mark}</button>`;
    };
    host.innerHTML = MONTHS.map(name => {
      const month = monthData(name);
      const partial = month?.status === 'parcial';
      const title = partial ? `Parcial: ${month.period}` : month?.notice || (hasData(month) ? '' : 'Sin hoja de Meta en la carpeta');
      const mark = partial ? '<span class="current-dot"></span>' : month?.notice ? '<span class="warn-dot"></span>' : '';
      return tab(name, hasData(month), title, mark);
    }).join('') + tab(ANNUAL, state.data.months.some(hasData), 'Acumulado 2026 de los meses con datos');
  }
  function selectMonth(name) {
    if (name !== ANNUAL && !hasData(monthData(name))) return;
    state.month = name;
    state.open.clear();
    document.querySelectorAll('#month-tabs .month-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.month === name);
      tab.setAttribute('aria-pressed', String(tab.dataset.month === name));
    });
    renderKpis();
    renderMonth();
  }
  function sheetLink(month) {
    const id = month.sheet?.id;
    if (!id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) return '';
    return `<a class="refresh-sheet-btn ads-report-link" href="https://docs.google.com/spreadsheets/d/${esc(id)}/edit" target="_blank" rel="noopener">Abrir hoja del mes</a>`;
  }
  // Cabecera del periodo como Royal Baby: "Periodo: 1-18 Octubre 2026 (mes en curso)", debajo "Comparación vs
  // 1-18 Septiembre" y la fuente.
  function renderPeriod(month) {
    const year = state.data.year || 2026;
    const campaigns = `${month.campaigns.length} campañas`;
    let title, sub, source;
    if (month.annual) {
      const first = month.months[0];
      const last = periodOf(state.data, null, month.months[month.months.length - 1]);
      title = `Periodo: 1 ${first.name} - ${last.to} ${MONTHS[last.index]} ${year}${last.index === 11 && last.closed ? '' : ' (año en curso)'}`;
      sub = `Acumulado de ${month.months.length} meses con datos (${month.months.map(item => SHORT_MONTHS[MONTHS.indexOf(item.name)]).join(', ')}). Sin año anterior para comparar.`;
      source = ['Fuente: hojas mensuales de Meta Ads en Drive', campaigns];
    } else {
      const period = periodOf(state.data, state.daily, month);
      title = `Periodo: ${period.label} ${year}${period.closed ? '' : ' (mes en curso)'}`;
      sub = period.compare ? `Comparación vs ${period.compare.label}` : 'Sin mes anterior para comparar';
      const days = month.firstDay && month.lastDay ? `pauta del ${longDate(month.firstDay)} al ${longDate(month.lastDay)}` : '';
      const daily = period.compare?.real.length ? `${MONTHS[period.index - 1]} del informe por día` : '';
      source = [`Fuente: ${month.sheet ? `hoja "${month.sheet.title}"` : 'exportación de Meta Ads'}`, days, campaigns, daily];
    }
    document.getElementById('period-title').textContent = title;
    document.getElementById('period-sub').textContent = sub;
    const sourceNode = document.getElementById('period-source');
    if (sourceNode) sourceNode.textContent = source.filter(Boolean).join(' | ');
    document.getElementById('period-actions').innerHTML = month.annual ? '' : sheetLink(month);
  }
  function summaryCard(month) {
    const k = month.kpis;
    const sales = groupTotals([month], 'Ventas');
    const messages = groupTotals([month], 'Mensajes');
    const branding = groupTotals([month], 'Reconocimiento');
    const metrics = [
      ['Compras', fmtCount(k.purchases), sales.purchases ? `${fmtMoney(ratio(sales.spend, sales.purchases))} por compra en Ventas` : 'Sin compras atribuidas'],
      ['Valor de compras', fmtMoney(k.revenue), `ROAS ${fmtRoas(ratio(k.revenue, k.spend))} total | ${fmtRoas(ratio(sales.revenue, sales.spend))} en Ventas`],
      ['Conversaciones', fmtCount(k.conversations), `${fmtCost(ratio(messages.spend, messages.conversations))} c/u en Mensajes | ${fmtCount(k.profileVisits)} visitas al perfil`],
      ['ThruPlays', fmtCount(k.thruplays), `${fmtCost(ratio(branding.spend, branding.thruplays))} c/u | ${fmtCompact(branding.impressions, false)} impresiones de Reconocimiento`],
    ];
    const groups = Object.entries(month.spendByGroup || {}).sort((a, b) => b[1] - a[1]);
    const bar = groups.map(([group, value]) => `<i class="${GROUP_CLASS[group] || ''}" style="width:${(value / k.spend * 100).toFixed(2)}%" title="${esc(group)}: ${fmtMoney(value)}"></i>`).join('');
    const legend = groups.map(([group, value]) => `<span><i class="${GROUP_CLASS[group] || ''}"></i>${esc(group)} <b>${fmtMoney(value)}</b> <em>${fmtPct(value / k.spend * 100)}</em></span>`).join('');
    return `
      <div class="panel ads-platform-card meta">
        <div class="ads-platform-head">
          <div><span class="platform-pill meta">${esc(state.data.platform.label)}</span><div class="panel-sub">${esc(state.data.platform.currency)} | ${month.campaigns.length} campañas | ${fmtCount(k.impressions)} impresiones</div></div>
          <div class="ads-platform-spend"><span>Inversión</span><strong>${fmtMoney(k.spend)}</strong></div>
        </div>
        <div class="ads-platform-metrics cols-2">${metrics.map(([name, value, hint]) => `<div><span>${name}</span><strong>${value}</strong><small>${esc(hint)}</small></div>`).join('')}</div>
        <div class="ads-split"><div class="ads-split-bar">${bar}</div><div class="ads-split-legend">${legend}</div></div>
      </div>`;
  }
  // Embudo de la campana de Ventas: de la impresion a la compra en la tienda online.
  function funnelCard(month) {
    const sales = groupTotals([month], 'Ventas');
    if (!sales.spend) {
      return '<div class="panel ads-platform-card funnel empty"><div class="ads-platform-head"><span class="platform-pill sales">Embudo de compra</span></div><div class="empty-state"><strong>Sin campaña de Ventas</strong><span>Este mes no hubo inversión en la campaña de Ventas.</span></div></div>';
    }
    const steps = [
      ['Impresiones', sales.impressions],
      ['Clics en el enlace', sales.clicks],
      ['Visitas a la web', sales.landingViews],
      ['Agregados al carrito', sales.addToCart],
      ['Pagos iniciados', sales.checkouts],
      ['Compras', sales.purchases],
    ];
    const max = Math.log10((steps[0][1] || 0) + 1) || 1;
    const rows = steps.map(([name, value], index) => {
      // Escala logaritmica: con escala lineal las compras quedarian invisibles frente a las impresiones.
      const width = value > 0 ? Math.max(3, Math.log10(value + 1) / max * 100) : 0;
      const rate = index ? ratio(value * 100, steps[index - 1][1]) : null;
      return `<div class="funnel-step"><span class="funnel-name">${name}</span><div class="funnel-bar"><i style="width:${width.toFixed(1)}%"></i></div><strong>${fmtCount(value)}</strong><small>${index ? `${fmtPct(rate)} del paso anterior` : 'Base'}</small></div>`;
    }).join('');
    return `
      <div class="panel ads-platform-card funnel">
        <div class="ads-platform-head">
          <div><span class="platform-pill sales">Embudo de compra</span><div class="panel-sub">Solo la campaña de Ventas | conversión de la impresión a la compra</div></div>
          <div class="ads-platform-spend"><span>Costo por compra</span><strong>${fmtMoney(ratio(sales.spend, sales.purchases))}</strong></div>
        </div>
        <div class="funnel-steps">${rows}</div>
        <div class="funnel-foot">Inversión ${fmtMoney(sales.spend)} | valor de compras ${fmtMoney(sales.revenue)} | ROAS ${fmtRoas(ratio(sales.revenue, sales.spend))}</div>
      </div>`;
  }
  function adsDetail(campaign) {
    const ads = campaign.topAds || [];
    if (!ads.length) return '<span class="no-data">Sin detalle por anuncio</span>';
    const cols = AD_COLUMNS[campaign.group] || [['clicks', 'Clics'], ['impressions', 'Impresiones']];
    const cell = (ad, [key, , money]) => money ? fmtMoney(ad[key]) : fmtCount(ad[key]);
    return `<table class="ads-top-table"><thead><tr><th>Anuncio</th>${cols.map(([, name]) => `<th class="num">${name}</th>`).join('')}<th class="num">Inversión</th><th></th></tr></thead><tbody>${ads.map(ad => `
      <tr><td>${esc(ad.name)}</td>${cols.map(col => `<td class="num">${cell(ad, col)}</td>`).join('')}<td class="num">${fmtMoney(ad.spend)}</td><td>${safeUrl(ad.url) ? `<a href="${safeUrl(ad.url)}" target="_blank" rel="noopener">Ver anuncio</a>` : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  function renderCampaigns(month) {
    const rows = month.campaigns.map((campaign, index) => ({ campaign, key: String(index) })).filter(({ campaign }) => state.group === 'all' || campaign.group === state.group);
    document.getElementById('campaigns-title').textContent = month.annual ? 'Campañas de 2026 (acumulado)' : `Campañas de ${month.name} 2026`;
    document.getElementById('campaigns-sub').textContent = `${month.campaigns.length} campañas con inversión. Despliega cada fila para ver los mejores anuncios.`;
    document.querySelectorAll('#campaigns-filter .series-toggle').forEach(item => item.classList.toggle('active', item.dataset.series === state.group));
    const body = document.getElementById('campaigns-body');
    if (!rows.length) { body.innerHTML = '<tr><td colspan="13" class="table-empty">Sin campañas de este tipo en el mes.</td></tr>'; return; }
    body.innerHTML = rows.map(({ campaign, key }) => {
      const result = mainResult(campaign);
      const open = state.open.has(key);
      const hasAds = (campaign.topAds || []).length > 0;
      return `
        <tr class="ads-campaign-row ${open ? 'open' : ''}">
          <td class="campaign-name">${esc(campaign.name)}</td>
          <td>${groupPill(campaign.group)}</td>
          <td class="num"><b>${fmtMoney(campaign.spend)}</b></td>
          <td class="num">${fmtPct(ratio(campaign.spend * 100, month.kpis.spend))}</td>
          <td class="num">${fmtCount(result.value)} <small class="result-label">${result.label}</small></td>
          <td class="num">${fmtCount(campaign.impressions)}</td>
          <td class="num">${fmtMoney(campaign.cpm)}</td>
          <td class="num">${fmtCount(campaign.clicks)}</td>
          <td class="num">${fmtCost(campaign.cpc)}</td>
          <td class="num">${campaign.purchases ? fmtCount(campaign.purchases) : '—'}</td>
          <td class="num">${campaign.revenue ? fmtMoney(campaign.revenue) : '—'}</td>
          <td class="num">${campaign.revenue ? fmtRoas(ratio(campaign.revenue, campaign.spend)) : '—'}</td>
          <td>${hasAds ? `<button type="button" class="ads-expand" data-key="${key}" aria-expanded="${open}">${open ? 'Ocultar' : `Ver ${campaign.topAds.length}`}</button>` : '<span class="no-data">—</span>'}</td>
        </tr>
        ${open ? `<tr class="ads-detail-row"><td colspan="13">${adsDetail(campaign)}</td></tr>` : ''}`;
    }).join('') + totalRow(rows.map(({ campaign }) => campaign), month);
  }
  // "Total del periodo" de las campanas a la vista (respeta el filtro de tipo): las sumas salen de las campanas y
  // CPM, costo por clic y ROAS se recalculan sobre esas sumas. El resultado principal solo se suma si todas son
  // del mismo tipo (compras, conversaciones y ThruPlays no se suman entre si).
  function totalRow(campaigns, month) {
    const sum = key => campaigns.reduce((total, campaign) => total + Number(campaign[key] || 0), 0);
    const t = { spend: sum('spend'), impressions: sum('impressions'), clicks: sum('clicks'), purchases: sum('purchases'), revenue: sum('revenue') };
    const groups = new Set(campaigns.map(campaign => campaign.group));
    const result = groups.size === 1
      ? mainResult({ group: campaigns[0].group, purchases: t.purchases, conversations: sum('conversations'), thruplays: sum('thruplays'), clicks: t.clicks })
      : null;
    const mixed = '<span class="no-data" title="Compras, conversaciones y ThruPlays no se suman entre sí">No se suman entre tipos</span>';
    return `
        <tr class="ads-total-row">
          <td class="campaign-name">Total del periodo</td>
          <td></td>
          <td class="num">${fmtMoney(t.spend)}</td>
          <td class="num">${fmtPct(ratio(t.spend * 100, month.kpis.spend))}</td>
          <td class="num">${result ? `${fmtCount(result.value)} <small class="result-label">${result.label}</small>` : mixed}</td>
          <td class="num">${fmtCount(t.impressions)}</td>
          <td class="num">${fmtMoney(ratio(t.spend * 1000, t.impressions))}</td>
          <td class="num">${fmtCount(t.clicks)}</td>
          <td class="num">${fmtCost(ratio(t.spend, t.clicks))}</td>
          <td class="num">${t.purchases ? fmtCount(t.purchases) : '—'}</td>
          <td class="num">${t.revenue ? fmtMoney(t.revenue) : '—'}</td>
          <td class="num">${t.revenue ? fmtRoas(ratio(t.revenue, t.spend)) : '—'}</td>
          <td></td>
        </tr>`;
  }
  function renderMonth() {
    const month = current();
    renderPeriod(month);
    document.getElementById('ads-platforms').innerHTML = summaryCard(month) + funnelCard(month);
    renderCampaigns(month);
  }

  // ── Historico (meses cerrados) ─────────────────────────────────────────────
  function renderHistory() {
    const body = document.getElementById('history-body');
    if (!body || !state.data) return;
    const closed = state.data.months.filter(month => month.status === 'cerrado');
    const rows = [...closed].reverse().flatMap(month => month.campaigns.map(campaign => ({ month, campaign })));
    const sum = key => closed.reduce((total, month) => total + Number(month.kpis[key] || 0), 0);
    const sales = groupTotals(closed, 'Ventas');
    const messages = groupTotals(closed, 'Mensajes');
    const kpis = document.getElementById('history-kpis');
    if (kpis) {
      kpis.innerHTML = [
        ['Campañas', fmtCount(rows.length), `${closed.length} meses cerrados`],
        ['Inversión', fmtMoney(sum('spend')), 'Meses cerrados'],
        ['Valor de compras', fmtMoney(sum('revenue')), `ROAS ${fmtRoas(ratio(sum('revenue'), sum('spend')))} total`],
        ['Compras', fmtCount(sum('purchases')), `${fmtMoney(ratio(sales.spend, sales.purchases))} por compra en Ventas`],
        ['Conversaciones', fmtCount(sum('conversations')), `${fmtCost(ratio(messages.spend, messages.conversations))} c/u en Mensajes`],
      ].map(([name, value, meta]) => `<div class="kpi-pill"><span>${name}</span><strong>${value}</strong><small>${meta}</small></div>`).join('');
    }
    const sub = document.getElementById('history-sub');
    if (sub) sub.textContent = rows.length ? `${rows.length} campañas de ${closed.length} meses cerrados. El mes en curso se ve en Gasto publicitario.` : 'Sin meses cerrados.';
    if (!rows.length) { body.innerHTML = '<tr><td colspan="10" class="table-empty">Sin campañas en meses cerrados.</td></tr>'; return; }
    body.innerHTML = rows.map(({ month, campaign }) => {
      const result = mainResult(campaign);
      const ads = (campaign.topAds || []).slice(0, 3);
      return `<tr>
        <td class="date-col">${esc(month.name)}</td>
        <td class="campaign-name">${esc(campaign.name)}</td>
        <td>${groupPill(campaign.group)}</td>
        <td class="num">${fmtMoney(campaign.spend)}</td>
        <td class="num">${fmtCount(result.value)} <small class="result-label">${result.label}</small></td>
        <td class="num">${fmtCount(campaign.clicks)}</td>
        <td class="num">${campaign.purchases ? fmtCount(campaign.purchases) : '—'}</td>
        <td class="num">${campaign.revenue ? fmtMoney(campaign.revenue) : '—'}</td>
        <td>${ads.length ? ads.map(ad => safeUrl(ad.url) ? `<a class="history-ad-link" href="${safeUrl(ad.url)}" target="_blank" rel="noopener">${esc(ad.name)}</a>` : `<span class="history-ad-muted">${esc(ad.name)}</span>`).join('') : '—'}</td>
        <td class="date-col">${esc(month.period || '—')}</td>
      </tr>`;
    }).join('');
  }

  // ── Sincronizacion con Drive ───────────────────────────────────────────────
  // El workflow sync-ads-data.yml descarga las hojas de Drive, regenera data/tlm-ads-2026.json y lo
  // publica (tres veces al dia y a pedido). El boton le pide al Web App que lo lance y espera a que el
  // sello syncedAt del JSON publicado cambie para volver a dibujar el tablero.
  function syncEndpoint() { return SYNC_TRIGGER_RE.test(SYNC_TRIGGER_ENDPOINT) ? SYNC_TRIGGER_ENDPOINT : ''; }
  function syncStamp(data) { return data?.syncedAt || data?.generatedAt || ''; }
  function syncDate(data) {
    const stamp = syncStamp(data);
    const date = stamp ? new Date(stamp.length === 10 ? `${stamp}T12:00:00` : stamp) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }
  function syncLabel(data) {
    const date = syncDate(data);
    if (!date) return '';
    const day = `${date.getDate()} ${SHORT_MONTHS[date.getMonth()].toLowerCase()}`;
    return syncStamp(data).length === 10 ? `Última sincronización: ${day}` : `Última sincronización: ${day}, ${date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`;
  }
  function relativeTime(date) {
    const minutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return 'hace segundos';
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    return `hace ${Math.round(hours / 24)} d`;
  }
  // Pildora de la barra superior como Royal Baby, igual en todas las vistas. ok: "Sincronizado · hace 2 h";
  // cargando: "Recargando…" mientras corre Actualizar; aviso: avisos de la carpeta de Drive o mas de un dia sin
  // sincronizar; error: no se pudieron leer los datos o lanzar la sincronizacion (el detalle va en la tarjeta).
  function renderPill() {
    const pill = document.getElementById('data-status-btn');
    const label = document.getElementById('topbar-status');
    if (!pill || !label) return;
    const date = syncDate(state.data);
    const warned = Boolean(state.data?.warnings?.length) || !date || Date.now() - date.getTime() > STALE_MS;
    const tone = state.syncing ? 'loading' : state.loadError || state.syncError ? 'err' : warned ? 'warn' : 'ok';
    ['ok', 'loading', 'warn', 'err'].forEach(name => pill.classList.toggle(name, name === tone));
    label.textContent = state.syncing ? 'Recargando…'
      : state.loadError ? 'No se pudieron cargar los datos'
        : state.syncError ? 'No se pudo sincronizar'
          : date ? `Sincronizado · ${relativeTime(date)}` : 'Aún no sincronizado';
  }
  // Boton fantasma "Actualizar": el icono gira y el texto cambia mientras corre.
  function setSyncBusy(busy) {
    const button = document.getElementById('ads-sync-btn');
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle('loading', busy);
    const label = button.querySelector('.topbar-refresh-label');
    if (label) label.textContent = busy ? 'Actualizando…' : 'Actualizar';
    button.title = syncEndpoint() ? 'Lee otra vez la carpeta de Drive y actualiza el tablero' : 'Vuelve a cargar los últimos datos publicados';
  }
  function setSyncStatus(text, busy = false) {
    const status = document.getElementById('ads-sync-status');
    if (status) { status.textContent = text; status.hidden = !text; }
    setSyncBusy(busy);
  }
  // Proxima corrida automatica del workflow (7:00, 12:00 y 17:00 de Lima; GitHub puede demorarla unos minutos).
  function nextAutoSync() {
    const lima = new Date(Date.now() - 5 * 3600000);
    const hour = lima.getUTCHours() + lima.getUTCMinutes() / 60;
    const next = [7, 12, 17].find(value => value > hour);
    const label = value => value === 12 ? '12:00 m.' : `${value > 12 ? value - 12 : value}:00 ${value < 12 ? 'a. m.' : 'p. m.'}`;
    return next ? `Hoy, ${label(next)}` : `Mañana, ${label(7)}`;
  }
  function renderStatus() {
    const set = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };
    const cutoff = /^(\d{4})-(\d{2})-(\d{2})$/.exec(state.data.cutoff || '');
    const last = [...state.data.months].reverse().find(hasData);
    set('status-data', cutoff ? `Meta Ads al ${Number(cutoff[3])} de ${MONTHS[Number(cutoff[2]) - 1].toLowerCase()}` : '—');
    set('status-last', syncLabel(state.data).replace('Última sincronización: ', '') || '—');
    set('status-next', nextAutoSync());
    set('status-file', last?.sheet?.title || '—');
  }
  function wireStatusCard() {
    const button = document.getElementById('data-status-btn');
    const card = document.getElementById('data-status-card');
    if (!button || !card) return;
    const close = () => {
      card.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    button.addEventListener('click', event => {
      event.stopPropagation();
      const open = card.hidden;
      // La proxima corrida depende de la hora: se recalcula al abrir el detalle.
      if (open && state.data) renderStatus();
      card.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', event => {
      if (!card.hidden && !card.contains(event.target) && event.target !== button) close();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  }
  // Pide al Web App que lance el workflow. POST sin cabeceras propias (sin preflight de CORS).
  async function requestSync(endpoint) {
    const response = await fetch(endpoint, { method: 'POST', body: 'action=sync', redirect: 'follow' });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || `HTTP ${response.status}`);
    return result;
  }
  async function fetchPublishedData() {
    const response = await fetch(`${DATA_URL}?cb=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  // El informe por dia es opcional: sin el, el mes en curso se compara contra el mes anterior prorrateado.
  async function fetchDaily() {
    try {
      const response = await fetch(`${DAILY_URL}?cb=${Date.now()}`, { cache: 'no-store' });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }
  async function applyData(data) {
    const daily = dailyTotals(await fetchDaily());
    if (daily) state.daily = daily;
    state.data = data;
    const withData = data.months.filter(hasData);
    if (state.month !== ANNUAL && !hasData(monthData(state.month))) state.month = withData[withData.length - 1]?.name || null;
    state.open.clear();
    renderAll();
  }
  async function syncFromDrive() {
    if (state.syncing) return;
    state.syncing = true;
    state.syncError = false;
    renderPill();
    const before = syncStamp(state.data);
    const endpoint = syncEndpoint();
    try {
      // Sin Web App: solo se relee lo que publico la sincronizacion automatica.
      if (!endpoint) {
        setSyncStatus('Buscando datos nuevos…', true);
        const data = await fetchPublishedData().catch(() => null);
        if (data && syncStamp(data) !== before) await applyData(data);
        state.syncError = !data;
        setSyncStatus(data
          ? `${syncStamp(data) !== before ? 'Datos actualizados.' : 'Ya tienes los últimos datos publicados.'} Sincronización ${SYNC_SCHEDULE}`
          : 'No se pudieron leer los datos. Intenta en unos minutos.');
        return;
      }
      setSyncStatus('Leyendo la carpeta de Drive. El tablero se actualiza solo al terminar (2 a 4 minutos).', true);
      try {
        const result = await requestSync(endpoint);
        if (result.pending) setSyncStatus('Ya hay una sincronización en curso. El tablero se actualiza solo al terminar.', true);
      } catch (error) {
        state.syncError = true;
        setSyncStatus(`No se pudo iniciar la sincronización (${error.message}). ${syncLabel(state.data)}`);
        return;
      }
      const started = Date.now();
      while (Date.now() - started < SYNC_TIMEOUT_MS) {
        await new Promise(resolve => setTimeout(resolve, SYNC_POLL_MS));
        const data = await fetchPublishedData().catch(() => null);
        if (data && syncStamp(data) !== before) {
          await applyData(data);
          setSyncStatus(`Datos actualizados. ${syncLabel(data)}`);
          return;
        }
      }
      setSyncStatus('Aún no llegan datos nuevos. Recarga la página en unos minutos.');
    } finally {
      state.syncing = false;
      setSyncBusy(false);
      renderPill();
    }
  }

  function renderAll() {
    const folder = document.getElementById('ads-folder-link');
    if (folder && /^[A-Za-z0-9_-]{10,}$/.test(state.data.folderId || '')) folder.href = `https://drive.google.com/drive/folders/${state.data.folderId}`;
    renderWarnings();
    renderPill();
    renderStatus();
    renderKpis();
    applyChartCollapsed();
    renderChart();
    renderTabs();
    renderMonth();
    renderHistory();
    window.dispatchEvent(new CustomEvent('tlm:data-updated'));
  }
  function wireEvents() {
    document.getElementById('chart-series-toggles').addEventListener('change', event => {
      const input = event.target.closest('input[type="radio"]');
      if (!input) return;
      state.metric = input.value;
      savePref(CHART_METRIC_KEY, state.metric);
      renderChart();
    });
    document.getElementById('chart-toggle-btn').addEventListener('click', () => {
      state.chartCollapsed = !state.chartCollapsed;
      savePref(CHART_COLLAPSED_KEY, state.chartCollapsed);
      applyChartCollapsed();
      if (!state.chartCollapsed) renderChart();
    });
    document.getElementById('month-tabs').addEventListener('click', event => {
      const tab = event.target.closest('.month-tab:not(:disabled)');
      if (tab) selectMonth(tab.dataset.month);
    });
    document.getElementById('campaigns-filter').addEventListener('change', event => {
      const input = event.target.closest('input[type="radio"]');
      if (!input) return;
      state.group = input.value;
      renderCampaigns(current());
    });
    // "Actualizar" abre el detalle para que se vea el avance (sin que el clic lo vuelva a cerrar).
    document.getElementById('ads-sync-btn')?.addEventListener('click', event => {
      event.stopPropagation();
      const card = document.getElementById('data-status-card');
      if (card) { card.hidden = false; document.getElementById('data-status-btn')?.setAttribute('aria-expanded', 'true'); }
      syncFromDrive();
    });
    document.getElementById('campaigns-body').addEventListener('click', event => {
      const button = event.target.closest('.ads-expand');
      if (!button) return;
      const key = button.dataset.key;
      if (state.open.has(key)) state.open.delete(key); else state.open.add(key);
      renderCampaigns(current());
    });
  }
  async function init() {
    try {
      const dailyRequest = fetchDaily();
      if (window.TLM_ADS_DATA) state.data = window.TLM_ADS_DATA;
      else {
        const response = await fetch(DATA_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state.data = await response.json();
      }
      const withData = state.data.months.filter(hasData);
      if (!withData.length) throw new Error('Sin meses con datos');
      state.month = withData[withData.length - 1].name;
      state.daily = dailyTotals(await dailyRequest);
      wireEvents();
      wireStatusCard();
      renderAll();
      setSyncStatus('');
      // "hace N min" sigue al dia con el tablero abierto.
      setInterval(renderPill, 60000);
    } catch (error) {
      state.loadError = true;
      renderPill();
      document.getElementById('view-obj').innerHTML = '<div class="data-notice error"><strong>No se pudo cargar la información de The Little Market.</strong></div>';
      console.error(error);
    }
  }
  // Copia de solo lectura para Proyecciones.
  function snapshot() {
    return state.data ? JSON.parse(JSON.stringify(state.data)) : null;
  }
  // comparison: las funciones puras de la variacion contra el mes anterior (sirven para probarlas con Node).
  window.TLMObjectives = { renderHistory, snapshot, comparison: { dailyTotals, periodOf, deltaHtml } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

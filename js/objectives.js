(function () {
  // Datos generados por scripts/build-ads-data.py desde las exportaciones mensuales de Meta Ads en Drive.
  // En el build llegan incrustados como window.TLM_ADS_DATA.
  const DATA_URL = 'data/tlm-ads-2026.json';
  // Informe por dia (filas por dia, campana y anuncio) del mismo script: da el tramo real del mes anterior.
  const DAILY_URL = 'data/tlm-ads-daily.json';
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const SHORT_MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const GROUP_CLASS = { Ventas: 'sales', Mensajes: 'messages', Reconocimiento: 'branding' };
  // Indicadores del grafico mensual. Se marcan varios y cada uno va en su panel, con la misma mecanica de los
  // graficos de campana: nunca dos escalas sobre las mismas lineas, porque los cruces no significarian nada.
  const MONTH_METRICS = [
    { key: 'spend', label: 'Inversión', color: '#2563eb', unit: 'money' },
    { key: 'revenue', label: 'Valor de compras', color: '#0d9488', unit: 'money' },
    { key: 'purchases', label: 'Compras', color: '#2a8276', unit: 'count' },
    { key: 'conversations', label: 'Conversaciones', color: '#16a34a', unit: 'count' },
    { key: 'clicks', label: 'Clics en el enlace', color: '#7c3aed', unit: 'count' },
    // Costos por resultado: salen de sumar la inversion y los resultados de su tipo de campana en el mes (los
    // mismos de los KPIs); un mes sin compras o sin conversaciones queda como hueco.
    { key: 'costPerPurchase', label: 'Costo por compra', color: '#db2777', unit: 'money' },
    { key: 'costPerConversation', label: 'Costo por conversación', color: '#d97706', unit: 'money' },
  ];
  const DEFAULT_MONTH_METRICS = ['spend', 'revenue'];
  // Grupo de campanas del que sale cada costo por resultado y su resultado.
  const COST_BASES = { costPerPurchase: ['Ventas', 'purchases'], costPerConversation: ['Mensajes', 'conversations'] };
  const CHART_COLLAPSED_KEY = 'tlm-chart-collapsed-v1';
  // v1 guardaba un solo indicador (los botones eran excluyentes); v2 guarda los marcados y el "un solo cuadro".
  const CHART_METRIC_KEY = 'tlm-ads-chart-metric-v1';
  const CHART_KEY = 'tlm-ads-chart-v2';
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
  // Dias de atraso del corte a partir de los cuales la pildora avisa: Meta cierra el dia anterior, asi que
  // dos dias es lo normal y tres significa que la carpeta de Drive dejo de moverse.
  const STALE_DATA_DAYS = 2;
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
  const state = { data: null, month: null, chart: null, group: 'all', monthChart: { metrics: DEFAULT_MONTH_METRICS, combined: false }, chartCollapsed: readPref(CHART_COLLAPSED_KEY, 'false') === 'true', open: new Set(), campaignCharts: {}, campaignChartObjects: new Map(), dailyRaw: null, syncing: false, syncError: false, loadError: false, daily: null };

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
  // Ajustes del grafico mensual. La version anterior guardaba un solo indicador: se traduce al llegar.
  function loadMonthChart() {
    let saved = {};
    try { saved = JSON.parse(readPref(CHART_KEY, '{}')) || {}; } catch { saved = {}; }
    const metrics = MONTH_METRICS.map(item => item.key).filter(key => Array.isArray(saved.metrics) && saved.metrics.includes(key));
    const old = readPref(CHART_METRIC_KEY, '');
    // "Inversion y ventas" eran dos series en un boton; los demas botones, una sola.
    const before = old && old !== 'spend' && MONTH_METRICS.some(item => item.key === old) ? [old] : DEFAULT_MONTH_METRICS;
    state.monthChart = { metrics: metrics.length ? metrics : before, combined: saved.combined === true };
  }
  function saveMonthChart(changes) {
    state.monthChart = { ...state.monthChart, ...changes };
    savePref(CHART_KEY, JSON.stringify(state.monthChart));
  }
  function renderChart() {
    const chosen = MONTH_METRICS.filter(metric => state.monthChart.metrics.includes(metric.key));
    const combined = state.monthChart.combined && chosen.length > 1;
    document.getElementById('chart-title').textContent = 'Evolución mensual · 2026';
    document.getElementById('chart-sub').textContent = `${chosen.map(metric => metric.label).join(' · ')}, mes a mes. Un clic en el gráfico abre ese mes.`;
    document.getElementById('chart-series-toggles').innerHTML = MONTH_METRICS.map(metric => `
      <label class="series-toggle ${state.monthChart.metrics.includes(metric.key) ? 'active' : ''}" style="--serie:${metric.color}">
        <input type="checkbox" value="${metric.key}" ${state.monthChart.metrics.includes(metric.key) ? 'checked' : ''}>${esc(metric.label)}
      </label>`).join('');
    // Con un indicador no hay nada que juntar: el boton solo aparece con dos o mas.
    document.getElementById('chart-modes').innerHTML = chosen.length > 1
      ? `<button type="button" class="table-tool-btn ${combined ? 'active' : ''}" data-combined="1" aria-pressed="${combined}" title="Los indicadores marcados, juntos en un cuadro">Un solo cuadro</button>`
      : '';
    if (state.chartCollapsed) return;
    const canvas = document.getElementById('chart-monthly');
    if (!canvas) return;
    if (typeof Chart === 'undefined') { canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Gráfico no disponible sin conexión.</strong><span>Los totales mensuales siguen visibles debajo.</span></div>'; return; }
    // Cada panel pide su alto; en un solo cuadro van todos en uno.
    const panels = chosen.length > 1 && !combined ? chosen.length : 1;
    document.getElementById('monthly-chart-body').style.height = `${Math.max(300, panels * 160)}px`;
    const lastIndex = state.data.months.reduce((last, month, index) => hasData(month) ? index : last, 0);
    const months = state.data.months.slice(0, lastIndex + 1);
    const labels = SHORT_MONTHS.slice(0, lastIndex + 1).map((name, index) => months[index]?.status === 'parcial' ? `${name}*` : name);
    const datasets = chosen.map((metric, order) => ({
      label: metric.label,
      unit: metric.unit,
      data: months.map(month => chartValue(month, metric.key)),
      borderColor: metric.color,
      backgroundColor: metric.color,
      pointBackgroundColor: metric.color,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: .25,
      spanGaps: false,
      valueLabels: true,
      yAxisID: chosen.length === 1 ? 'y' : `y${order}`,
    }));
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 24, right: 12, left: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: item => item.raw != null,
            callbacks: {
              title: items => { const month = months[items[0].dataIndex]; return `${month.name}${month.status === 'parcial' ? ` (parcial, ${month.period})` : month.notice ? ` (${month.notice.toLowerCase()})` : ''}`; },
              label: context => ` ${context.dataset.label}: ${seriesValue(context.dataset.unit, context.raw)}`,
              // El ROAS solo significa algo con la inversion y el valor de compras a la vista.
              footer: items => {
                const month = months[items[0].dataIndex];
                const both = ['spend', 'revenue'].every(key => state.monthChart.metrics.includes(key));
                return both && hasData(month) ? `ROAS ${fmtRoas(ratio(month.kpis.revenue, month.kpis.spend))}` : '';
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
          ...panelScales(chosen, combined),
        },
        onClick: (event, elements) => { if (elements[0]) selectMonth(months[elements[0].index].name); },
      },
      plugins: LINE_PLUGINS,
    });
    const note = document.getElementById('chart-note');
    if (note) {
      note.textContent = `${combined ? 'Los indicadores van juntos, cada uno con su escala y sin eje a la vista: se compara la forma y el valor se lee en el punto.'
        : chosen.length > 1 ? 'Cada indicador en su panel, con su escala, sobre el mismo eje de meses.'
          : 'Marca más indicadores para verlos en paneles apilados.'} El asterisco marca un mes parcial.`;
    }
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
    // Anuncios comparte el mes con esta vista: cambiar de mes aqui lo repinta alla.
    window.dispatchEvent(new CustomEvent('tlm:month-changed', { detail: { month: name } }));
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
      // Días que la exportación todavía no cubre y completa la pestaña de Nexus, con lo que ese origen no trae.
      const nexus = month.nexus ? `del ${longDate(month.nexus.from)} al ${longDate(month.nexus.to)} desde Nexus `
        + `(sin ${month.nexus.missing.join(', ')})` : '';
      source = [`Fuente: ${month.sheet ? `hoja "${month.sheet.title}"` : 'exportación de Meta Ads'}`, days, campaigns, daily, nexus];
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
      ['Valor de compras', fmtMoney(k.revenue), `ROAS ${fmtRoas(ratio(k.revenue, k.spend))} total · ${fmtRoas(ratio(sales.revenue, sales.spend))} en Ventas`],
      ['Conversaciones', fmtCount(k.conversations), `${fmtCost(ratio(messages.spend, messages.conversations))} c/u en Mensajes · ${fmtCount(k.profileVisits)} visitas al perfil`],
      ['ThruPlays', fmtCount(k.thruplays), `${fmtCost(ratio(branding.spend, branding.thruplays))} c/u · ${fmtCompact(branding.impressions, false)} impresiones de Reconocimiento`],
    ];
    const groups = Object.entries(month.spendByGroup || {}).sort((a, b) => b[1] - a[1]);
    const bar = groups.map(([group, value]) => `<i class="${GROUP_CLASS[group] || ''}" style="width:${(value / k.spend * 100).toFixed(2)}%" title="${esc(group)}: ${fmtMoney(value)}"></i>`).join('');
    const legend = groups.map(([group, value]) => `<span><i class="${GROUP_CLASS[group] || ''}"></i>${esc(group)} <b>${fmtMoney(value)}</b> <em>${fmtPct(value / k.spend * 100)}</em></span>`).join('');
    // Mismo marco y mismas tarjetas que los cuadros de campana: tarjeta blanca de borde fino y KPIs en kpi-pill.
    return `
      <section class="campaign-block platform-block">
        <div class="campaign-block-head">
          <div>
            <div class="campaign-block-title">${esc(state.data.platform.label)} <span class="platform-pill meta">Resumen</span></div>
            <div class="campaign-block-sub">${esc(state.data.platform.currency)} · ${month.campaigns.length} campañas · ${fmtCount(k.impressions)} impresiones</div>
          </div>
          <div class="block-figure"><span>Inversión</span><strong>${fmtMoney(k.spend)}</strong></div>
        </div>
        <div class="kpi-strip campaign-kpis">${metrics.map(([name, value, hint]) => `<div class="kpi-pill"><span>${name}</span><strong>${value}</strong><small>${esc(hint)}</small></div>`).join('')}</div>
        <div class="ads-split"><div class="ads-split-bar">${bar}</div><div class="ads-split-legend">${legend}</div></div>
      </section>`;
  }
  // Embudo de la campana de Ventas: de la impresion a la compra en la tienda online.
  function funnelCard(month) {
    const sales = groupTotals([month], 'Ventas');
    if (!sales.spend) {
      return '<section class="campaign-block platform-block funnel empty"><div class="campaign-block-head"><div><div class="campaign-block-title">Embudo de compra</div></div></div><div class="empty-state"><strong>Sin campaña de Ventas</strong><span>Este mes no hubo inversión en la campaña de Ventas.</span></div></section>';
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
      <section class="campaign-block platform-block funnel">
        <div class="campaign-block-head">
          <div>
            <div class="campaign-block-title">Embudo de compra <span class="platform-pill sales">Ventas</span></div>
            <div class="campaign-block-sub">Solo la campaña de Ventas · conversión de la impresión a la compra</div>
          </div>
          <div class="block-figure"><span>Costo por compra</span><strong>${fmtMoney(ratio(sales.spend, sales.purchases))}</strong></div>
        </div>
        <div class="funnel-steps">${rows}</div>
        <div class="funnel-foot">Inversión ${fmtMoney(sales.spend)} · valor de compras ${fmtMoney(sales.revenue)} · ROAS ${fmtRoas(ratio(sales.revenue, sales.spend))}</div>
      </section>`;
  }
  // ── Campanas, un marco cada una ───────────────────────────────────────────
  // La estructura del tablero de Terminal Pesquero: en vez de una fila por campana, un cuadro por campana
  // con sus KPIs contra el mes anterior, sus conjuntos de anuncios y sus anuncios. El detalle sale de
  // months[].ads, la tabla por anuncio del barrido, que trae el conjunto en cada fila.
  const AD_SUMS = ['spend', 'impressions', 'reach', 'clicks', 'landingViews', 'addToCart', 'checkouts',
                   'purchases', 'revenue', 'conversations', 'profileVisits', 'thruplays'];

  // Anuncios del mes (o del ano, sumados por anuncio y conjunto) en forma de objeto.
  function adsOfMonth(name) {
    const columns = state.data.adColumns;
    if (!Array.isArray(columns)) return [];
    const toAd = row => { const ad = {}; columns.forEach((key, index) => { ad[key] = row[index]; }); return ad; };
    const months = name === ANNUAL
      ? state.data.months.filter(month => (month.ads || []).length)
      : [monthData(name)].filter(month => (month?.ads || []).length);
    const total = new Map();
    months.forEach(month => month.ads.forEach(row => {
      const ad = toAd(row);
      const key = `${ad.name}|${ad.campaign}|${ad.adSet}`;
      const found = total.get(key);
      if (!found) { total.set(key, ad); return; }
      AD_SUMS.forEach(metric => { found[metric] += ad[metric]; });
      found.results += ad.results;
      found.days += ad.days;
      if (!found.url) found.url = ad.url;
    }));
    return [...total.values()];
  }

  // El mes anterior con datos, que no siempre es el de al lado: febrero estuvo vacio mucho tiempo.
  function previousMonthWithData(name) {
    if (name === ANNUAL) return null;
    for (let index = MONTHS.indexOf(name) - 1; index >= 0; index -= 1) {
      const month = monthData(MONTHS[index]);
      if (hasData(month)) return month;
    }
    return null;
  }

  const costOf = campaign => ratio(campaign.spend, mainResult(campaign).value);
  // El singular en espanol no sale de quitarle la ese al plural: "conversaciones" lleva tilde al
  // singular y "ThruPlays" no es una palabra que se pueda declinar.
  const RESULT_WORDS = {
    Ventas: { plural: 'Compras', singular: 'compra' },
    Mensajes: { plural: 'Conversaciones', singular: 'conversación' },
    Reconocimiento: { plural: 'ThruPlays', singular: 'ThruPlay' },
  };
  const resultWords = group => RESULT_WORDS[group] || { plural: 'Clics', singular: 'clic' };

  function campaignKpis(campaign, before, label) {
    const result = mainResult(campaign);
    const words = resultWords(campaign.group);
    const cards = [
      { label: words.plural, value: fmtCount(result.value), now: result.value, prev: before ? mainResult(before).value : null, better: 'up' },
      { label: 'Inversión', value: fmtMoney(campaign.spend), now: campaign.spend, prev: before?.spend, better: null },
      { label: `Costo por ${words.singular}`, value: fmtCost(costOf(campaign)), now: costOf(campaign), prev: before ? costOf(before) : null, better: 'down' },
      { label: 'Alcance', value: fmtCount(campaign.reach), now: campaign.reach, prev: before?.reach, better: 'up' },
      { label: 'Impresiones', value: fmtCount(campaign.impressions), now: campaign.impressions, prev: before?.impressions, better: 'up' },
      { label: 'CPM', value: fmtMoney(campaign.cpm), now: campaign.cpm, prev: before ? ratio(before.spend * 1000, before.impressions) : null, better: 'down' },
    ];
    if (campaign.revenue > 0) {
      const roas = ratio(campaign.revenue, campaign.spend);
      cards.push({ label: 'ROAS', value: fmtRoas(roas), now: roas, prev: before?.revenue > 0 ? ratio(before.revenue, before.spend) : null, better: 'up' });
    }
    return `<div class="kpi-strip campaign-kpis">${cards.map(card => `
      <div class="kpi-pill"><span>${esc(card.label)}</span><strong>${card.value}</strong>
      ${label ? deltaHtml(card.now, card.prev, card.better, label) : '<small class="kpi-delta flat">Sin mes anterior</small>'}</div>`).join('')}</div>`;
  }

  // Conjuntos de anuncios de la campana. El tipo de resultado es el que mas resultados trae del conjunto:
  // una campana de Mensajes mezcla conversaciones y visitas al perfil, y sumarlas no significaria nada.
  function adSetsHtml(ads, campaign) {
    const sets = new Map();
    ads.forEach(ad => {
      const name = ad.adSet || '(sin conjunto)';
      const set = sets.get(name) || { name, ads: 0, kinds: {}, spend: 0, impressions: 0, reach: 0, clicks: 0 };
      set.ads += 1;
      ['spend', 'impressions', 'reach', 'clicks'].forEach(metric => { set[metric] += Number(ad[metric] || 0); });
      if (ad.resultType) set.kinds[ad.resultType] = (set.kinds[ad.resultType] || 0) + Number(ad.results || 0);
      sets.set(name, set);
    });
    const rows = [...sets.values()].sort((a, b) => b.spend - a.spend);
    if (!rows.length) return '';
    const body = rows.map(set => {
      const [kind, results] = Object.entries(set.kinds).sort((a, b) => b[1] - a[1])[0] || ['', 0];
      return `<tr>
        <td class="campaign-name">${esc(set.name)}<small>${set.ads} ${set.ads === 1 ? 'anuncio' : 'anuncios'}</small></td>
        <td>${kind ? `<span class="type-pill">${esc(kind)}</span>` : '<span class="no-data">—</span>'}</td>
        <td class="num"><b>${results > 0 ? fmtCount(results) : '<span class="no-data">—</span>'}</b></td>
        <td class="num">${results > 0 ? fmtCost(ratio(set.spend, results)) : '<span class="no-data">—</span>'}</td>
        <td class="num">${fmtMoney(set.spend)}</td>
        <td class="num">${fmtPct(ratio(set.spend * 100, campaign.spend))}</td>
        <td class="num">${fmtCount(set.impressions)}</td>
        <td class="num">${fmtCount(set.reach)}</td>
        <td class="num">${fmtMoney(ratio(set.spend * 1000, set.impressions))}</td>
        <td class="num">${fmtCount(set.clicks)}</td>
      </tr>`;
    }).join('');
    return `
      <div class="adset-head"><div class="panel-title">Conjuntos de anuncios</div>
        <div class="panel-sub">${rows.length} ${rows.length === 1 ? 'conjunto' : 'conjuntos'} con inversión en el periodo.</div></div>
      <div class="table-scroll"><table class="data-table adset-table">
        <thead><tr><th>Conjunto</th><th>Resultado</th><th class="num">Resultados</th><th class="num">Costo por resultado</th><th class="num">Inversión</th><th class="num">% de la campaña</th><th class="num">Impresiones</th><th class="num">Alcance</th><th class="num">CPM</th><th class="num">Clics</th></tr></thead>
        <tbody>${body}</tbody></table></div>`;
  }

  function campaignAdsHtml(ads, campaign) {
    const rows = [...ads].sort((a, b) => (b.results - a.results) || (b.spend - a.spend));
    if (!rows.length) return '<p class="no-data">Sin detalle por anuncio en este periodo.</p>';
    const leader = rows.find(ad => ad.results > 0);
    const body = rows.map(ad => `<tr>
      <td class="campaign-name">${ad === leader ? '<b class="leader-star" title="Líder de la campaña">★</b> ' : ''}${safeUrl(ad.url) ? `<a href="${safeUrl(ad.url)}" target="_blank" rel="noopener">${esc(ad.name)} <span aria-hidden="true">↗</span></a>` : esc(ad.name)}<small>${esc(ad.adSet || '—')}</small></td>
      <td class="num"><b>${ad.results > 0 ? fmtCount(ad.results) : '<span class="no-data">—</span>'}</b></td>
      <td class="num">${ad.results > 0 ? fmtCost(ratio(ad.spend, ad.results)) : '<span class="no-data">—</span>'}</td>
      <td class="num">${fmtMoney(ad.spend)}</td>
      <td class="num">${fmtPct(ratio(ad.spend * 100, campaign.spend))}</td>
      <td class="num">${fmtCount(ad.impressions)}</td>
      <td class="num">${fmtCount(ad.reach)}</td>
      <td class="num">${fmtMoney(ratio(ad.spend * 1000, ad.impressions))}</td>
      <td class="num">${fmtCount(ad.clicks)}</td>
      <td class="num">${fmtCount(ad.days)}</td>
    </tr>`).join('');
    return `
      <div class="adset-head"><div class="panel-title">Anuncios</div>
        <div class="panel-sub">${rows.length} ${rows.length === 1 ? 'anuncio' : 'anuncios'}, de más a menos resultados. La estrella marca al líder.</div></div>
      <div class="table-scroll"><table class="data-table adset-table">
        <thead><tr><th>Anuncio</th><th class="num">Resultados</th><th class="num">Costo por resultado</th><th class="num">Inversión</th><th class="num">% de la campaña</th><th class="num">Impresiones</th><th class="num">Alcance</th><th class="num">CPM</th><th class="num">Clics</th><th class="num">Días activos</th></tr></thead>
        <tbody>${body}</tbody></table></div>`;
  }

  // ── Grafico de cada campana ───────────────────────────────────────────────
  // Se pueden marcar varios indicadores. Van en un solo cuadro, cada uno con su escala y sin eje a la
  // vista: lo que se compara es la forma, y el valor se lee en el punto. Dos escalas dibujadas a la vez
  // invitan a leer los cruces entre lineas, que no significan nada.
  const CAMPAIGN_CHART_KEY = 'tlm-campaign-charts-v1';
  const CAMPAIGN_METRICS = [
    { key: 'result', label: 'Resultado', color: '#2a8276', unit: 'count' },
    { key: 'spend', label: 'Inversión', color: '#2563eb', unit: 'money' },
    { key: 'impressions', label: 'Impresiones', color: '#7c3aed', unit: 'count' },
    { key: 'reach', label: 'Alcance', color: '#0ea5e9', unit: 'count' },
    { key: 'costPerResult', label: 'Costo por resultado', color: '#d97706', unit: 'money' },
  ];
  const DEFAULT_CAMPAIGN_METRICS = ['result', 'spend'];
  // La columna del resultado principal de cada tipo en el archivo diario.
  const RESULT_COLUMN = { Ventas: 'purchases', Mensajes: 'conversations', Reconocimiento: 'thruplays' };

  function campaignChartSettings(key) {
    const saved = state.campaignCharts[key] || {};
    const metrics = CAMPAIGN_METRICS.map(item => item.key).filter(metric => Array.isArray(saved.metrics) && saved.metrics.includes(metric));
    return { metrics: metrics.length ? metrics : DEFAULT_CAMPAIGN_METRICS,
             mode: saved.mode === 'monthly' ? 'monthly' : 'daily',
             combined: saved.combined === true };
  }
  function saveCampaignChart(key, changes) {
    state.campaignCharts[key] = { ...campaignChartSettings(key), ...changes };
    savePref(CAMPAIGN_CHART_KEY, JSON.stringify(state.campaignCharts));
  }

  // Serie por dia de una campana dentro del mes elegido. El archivo diario solo guarda las ultimas
  // semanas, asi que para los meses anteriores no hay vista por dia y el cuadro lo dice.
  function dailySeries(campaign, monthName) {
    const daily = state.dailyRaw;
    const columns = Array.isArray(daily?.columns) ? daily.columns : [];
    const start = Date.parse(`${daily?.firstDay}T00:00:00Z`);
    const index = columns.indexOf('d');
    const campaignCol = columns.indexOf('campaign');
    if (!Array.isArray(daily?.rows) || index < 0 || campaignCol < 0 || !Number.isFinite(start)) return null;
    const which = (daily.campaigns || []).findIndex(item => item.name === campaign.name);
    if (which < 0) return null;
    const month = MONTHS.indexOf(monthName) + 1;
    if (month < 1) return null;
    const resultCol = columns.indexOf(RESULT_COLUMN[campaign.group] || 'clicks');
    const spendCol = columns.indexOf('spend');
    const cols = { spend: spendCol, impressions: columns.indexOf('impressions'), reach: columns.indexOf('reach') };
    const byDay = new Map();
    daily.rows.forEach(row => {
      if (Number(row[campaignCol]) !== which) return;
      const date = new Date(start + Number(row[index]) * 86400000);
      if (date.getUTCFullYear() !== state.data.year || date.getUTCMonth() + 1 !== month) return;
      const day = date.getUTCDate();
      const totals = byDay.get(day) || { result: 0, spend: 0, impressions: 0, reach: 0 };
      totals.result += Number(row[resultCol] || 0);
      Object.entries(cols).forEach(([key, column]) => { totals[key] += Number(row[column] || 0); });
      byDay.set(day, totals);
    });
    if (!byDay.size) return null;
    const days = [...byDay.keys()].sort((a, b) => a - b);
    return {
      labels: days.map(String),
      values: key => days.map(day => value(byDay.get(day), key)),
      note: `Por día, del ${days[0]} al ${days[days.length - 1]} de ${monthName.toLowerCase()}.`,
    };
  }

  // Serie por mes: la campana a lo largo del ano. Siempre disponible, tambien en la vista Anual.
  function monthlySeries(campaign) {
    const points = [];
    state.data.months.forEach(month => {
      if (!hasData(month)) return;
      const found = (month.campaigns || []).find(item => item.name === campaign.name);
      if (!found) return;
      points.push({ label: SHORT_MONTHS[MONTHS.indexOf(month.name)], totals: {
        result: mainResult(found).value, spend: found.spend, impressions: found.impressions, reach: found.reach } });
    });
    if (!points.length) return null;
    return {
      labels: points.map(point => point.label),
      values: key => points.map(point => value(point.totals, key)),
      note: `Por mes, los ${points.length} meses en que corrió.`,
    };
  }

  // Un dia sin resultados no tiene costo por resultado: queda como hueco y no como cero, que leeria
  // como "gratis" en vez de "no hubo".
  function value(totals, key) {
    if (!totals) return null;
    if (key !== 'costPerResult') return Number(totals[key] || 0);
    return totals.result > 0 ? Number(totals.spend || 0) / totals.result : null;
  }

  function campaignChartHtml(campaign, index) {
    const settings = campaignChartSettings(campaign.name);
    const toggles = CAMPAIGN_METRICS.map(metric => `
      <label class="series-toggle ${settings.metrics.includes(metric.key) ? 'active' : ''}" style="--serie:${metric.color}">
        <input type="checkbox" value="${metric.key}" ${settings.metrics.includes(metric.key) ? 'checked' : ''}>${metric.label}
      </label>`).join('');
    // En el acumulado del ano la vista por dia no se ofrece: no hay un mes al que referirla.
    const annual = state.month === ANNUAL;
    const shownMode = annual ? 'monthly' : settings.mode;
    const mode = (key, label) => `<button type="button" class="table-tool-btn ${shownMode === key ? 'active' : ''}" data-mode="${key}"${annual && key === 'daily' ? ' disabled title="La vista por día necesita un mes"' : ''} aria-pressed="${shownMode === key}">${label}</button>`;
    // Con un indicador no hay nada que juntar: el boton solo aparece con dos o mas.
    const many = settings.metrics.length > 1;
    const single = many
      ? `<button type="button" class="table-tool-btn ${settings.combined ? 'active' : ''}" data-combined="1" aria-pressed="${settings.combined}" title="Los indicadores marcados, juntos en un cuadro">Un solo cuadro</button>`
      : '';
    // Cada panel pide su alto; en un solo cuadro van todos en uno.
    const panels = many && !settings.combined ? settings.metrics.length : 1;
    const height = Math.max(220, panels * 135);
    return `
      <div class="campaign-chart" data-key="${esc(campaign.name)}">
        <div class="campaign-chart-head">
          <div class="chart-series-toggles campaign-series">${toggles}</div>
          <div class="campaign-chart-modes">${mode('daily', 'Por día')}${mode('monthly', 'Por mes')}${single}</div>
        </div>
        <div class="chart-wrap" style="height:${height}px"><canvas id="campaign-chart-${index}"></canvas></div>
        <div class="campaign-chart-note" id="campaign-chart-note-${index}"></div>
      </div>`;
  }

  // Formatos del grafico, como en Terminal Pesquero: el costo por ThruPlay son centesimas de sol, asi que
  // los montos chicos llevan mas decimales o toda la columna quedaria en "S/. 0".
  const seriesValue = (unit, value) => (unit === 'money' ? fmtCost(value) : fmtCount(value));
  const pointValue = (unit, value) => (unit === 'money'
    ? (Math.abs(value) >= 10 ? tickValue('money', Math.round(value)) : fmtCost(value))
    : Number(value).toLocaleString('es-PE', { notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }));
  const tickValue = (unit, value) => (unit === 'money'
    ? (value === 0 ? `${symbol()} 0` : `${symbol()} ${Number(value).toLocaleString('es-PE', { maximumFractionDigits: Math.abs(value) >= 10 ? 0 : Math.abs(value) >= 1 ? 2 : 3 })}`)
    : Number(value).toLocaleString('es-PE', { notation: Math.abs(value) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }));

  // Los tres anadidos que comparten los graficos de linea del tablero: el valor sobre cada punto, el
  // nombre de cada panel y la linea vertical del tooltip.
  const LINE_PLUGINS = [{
        // El valor de cada punto, menos los ceros. Arriba en un pico y abajo en un valle, para no montarse
        // en la linea; si choca con otra etiqueta o se sale de su panel, prueba el otro lado y si tampoco
        // cabe se omite y queda en el tooltip.
        id: 'valueLabels',
        afterDatasetsDraw(target) {
          const ctx = target.ctx;
          const placed = [];
          const overlaps = box => placed.some(other => !(box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom));
          const isValue = value => value != null && Number.isFinite(Number(value));
          ctx.save();
          ctx.font = '600 11px Inter, sans-serif';
          Object.values(target.scales).forEach(scale => {
            if (!scale.options.panelLabel) return;
            const left = target.chartArea.left + 4;
            placed.push({ left, right: left + ctx.measureText(scale.options.panelLabel).width + 8, top: scale.top + 2, bottom: scale.top + 18 });
          });
          ctx.font = '600 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255,255,255,.92)';
          target.data.datasets.forEach((dataset, order) => {
            if (!dataset.valueLabels) return;
            const meta = target.getDatasetMeta(order);
            const scale = target.scales[meta.yAxisID];
            if (!scale) return;
            const top = scale.top <= target.chartArea.top + 1 ? target.chartArea.top - 22 : scale.top;
            ctx.fillStyle = dataset.borderColor;
            meta.data.forEach((point, pointIndex) => {
              const raw = dataset.data[pointIndex];
              if (!isValue(raw) || Number(raw) === 0) return;
              const text = pointValue(dataset.unit, raw);
              const half = ctx.measureText(text).width / 2 + 2;
              const prev = dataset.data[pointIndex - 1];
              const next = dataset.data[pointIndex + 1];
              const valley = isValue(prev) && isValue(next) && raw < prev && raw < next;
              const sides = valley ? [point.y + 13, point.y - 12] : [point.y - 12, point.y + 13];
              const x = Math.min(Math.max(point.x, half), target.width - half);
              const box = sides.map(y => ({ y, left: x - half, right: x + half, top: y - 6, bottom: y + 6 }))
                .find(item => item.top >= top && item.bottom <= scale.bottom && !overlaps(item));
              if (!box) return;
              placed.push(box);
              ctx.strokeText(text, x, box.y);
              ctx.fillText(text, x, box.y);
            });
          });
          ctx.restore();
        },
      }, {
        // El nombre de cada panel, arriba a la izquierda y en horizontal (solo con varios indicadores).
        id: 'panelLabels',
        afterDatasetsDraw(target) {
          const ctx = target.ctx;
          ctx.save();
          ctx.font = '600 11px Inter, sans-serif';
          ctx.textBaseline = 'top';
          Object.values(target.scales).forEach(scale => {
            const label = scale.options.panelLabel;
            if (!label) return;
            const x = target.chartArea.left + 8;
            const y = scale.top + 4;
            ctx.fillStyle = 'rgba(255,255,255,.85)';
            ctx.fillRect(x - 4, y - 2, ctx.measureText(label).width + 8, 16);
            ctx.fillStyle = '#475569';
            ctx.fillText(label, x, y);
          });
          ctx.restore();
        },
      }, {
        // Linea vertical en el dia del tooltip, a lo alto de todos los paneles.
        id: 'crosshair',
        afterDatasetsDraw(target) {
          const active = target.tooltip?.getActiveElements() || [];
          if (!active.length) return;
          const ctx = target.ctx;
          ctx.save();
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(active[0].element.x, target.chartArea.top);
          ctx.lineTo(active[0].element.x, target.chartArea.bottom);
          ctx.stroke();
          ctx.restore();
        },
      }];

  // Con un indicador, un solo eje. Con varios, un panel por indicador apilado sobre el mismo eje de dias:
  // nunca dos escalas a la vista sobre las mismas lineas, porque los cruces no significarian nada. En "un
  // solo cuadro" cada indicador conserva su escala pero sin eje visible: se compara la forma.
  function panelScales(metrics, combined) {
    const base = unit => ({ beginAtZero: true, border: { display: false },
      ticks: { color: '#94a3b8', font: { size: 10 }, callback: value => tickValue(unit, value) } });
    if (metrics.length === 1) return { y: { ...base(metrics[0].unit), grid: { color: 'rgba(15,23,42,.06)' } } };
    if (combined) return Object.fromEntries(metrics.map((metric, index) => [`y${index}`, { display: false, beginAtZero: true, grace: '18%' }]));
    // Chart.js apila de abajo hacia arriba: los ejes van al reves para que el primero quede arriba.
    return Object.fromEntries(metrics.map((metric, index) => [`y${index}`, {
      ...base(metric.unit),
      stack: 'metrics',
      stackWeight: 1,
      grace: '25%',
      // El tope de un panel cae sobre el cero del de arriba: se omite para que no se encimen.
      ticks: { ...base(metric.unit).ticks, maxTicksLimit: 5,
        callback: (value, tickIndex, ticks) => (index > 0 && tickIndex === ticks.length - 1 ? '' : tickValue(metric.unit, value)) },
      grid: { color: context => (context.tick?.value === 0 ? '#cbd5e1' : 'rgba(15,23,42,.06)') },
      panelLabel: metric.label,
    }]).reverse());
  }

  function drawCampaignChart(campaign, index, monthName) {
    const canvas = document.getElementById(`campaign-chart-${index}`);
    const note = document.getElementById(`campaign-chart-note-${index}`);
    if (!canvas) return;
    const settings = campaignChartSettings(campaign.name);
    const annual = monthName === ANNUAL;
    const daily = annual ? null : dailySeries(campaign, monthName);
    const useDaily = settings.mode === 'daily' && Boolean(daily);
    const series = useDaily ? daily : monthlySeries(campaign);
    const fallback = settings.mode === 'daily' && !daily && !annual;
    state.campaignChartObjects.get(campaign.name)?.destroy();
    state.campaignChartObjects.delete(campaign.name);
    if (!series) {
      if (note) note.textContent = 'Sin serie para esta campaña en el periodo.';
      return;
    }
    if (typeof window.Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Gráfico no disponible sin conexión.</strong><span>Los indicadores y las tablas siguen visibles.</span></div>';
      return;
    }
    const chosen = CAMPAIGN_METRICS.filter(metric => settings.metrics.includes(metric.key));
    const combined = settings.combined === true && chosen.length > 1;
    const datasets = chosen.map((metric, order) => ({
      label: metric.label,
      unit: metric.unit,
      data: series.values(metric.key),
      borderColor: metric.color,
      backgroundColor: metric.color,
      pointBackgroundColor: metric.color,
      borderWidth: 2,
      pointRadius: series.labels.length > 20 ? 0 : 3,
      pointHoverRadius: 4,
      tension: .25,
      spanGaps: false,
      valueLabels: true,
      yAxisID: chosen.length === 1 ? 'y' : `y${order}`,
    }));
    // Con un solo indicador y vista por dia, se dibuja el mismo dia del mes anterior para comparar.
    const previous = chosen.length === 1 && useDaily ? previousMonthWithData(monthName) : null;
    const before = previous ? dailySeries(campaign, previous.name) : null;
    if (before) {
      const values = before.values(chosen[0].key);
      datasets.push({
        label: previous.name,
        unit: chosen[0].unit,
        data: series.labels.map(day => { const at = before.labels.indexOf(day); return at < 0 ? null : values[at]; }),
        borderColor: '#cbd5e1',
        backgroundColor: '#cbd5e1',
        borderWidth: 2,
        borderDash: [4, 4],
        pointRadius: 0,
        tension: .25,
        spanGaps: false,
        valueLabels: false,
        yAxisID: 'y',
      });
    }
    const chart = new window.Chart(canvas, {
      type: 'line',
      data: { labels: series.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 24, right: 12, left: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: item => item.raw != null,
            callbacks: {
              title: items => (useDaily ? `Día ${items[0].label}` : items[0].label),
              label: context => ` ${context.dataset.label}: ${seriesValue(context.dataset.unit, context.raw)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#cbd5e1' },
               ticks: { color: '#94a3b8', font: { size: 10 }, autoSkip: true, maxTicksLimit: useDaily ? 16 : 12 } },
          ...panelScales(chosen, combined),
        },
      },
      plugins: LINE_PLUGINS,
    });
    state.campaignChartObjects.set(campaign.name, chart);
    if (note) {
      const what = combined ? 'Los indicadores van juntos, cada uno con su escala y sin eje a la vista: se compara la forma y el valor se lee en el punto.'
        : chosen.length > 1 ? 'Cada indicador en su panel, con su escala, sobre el mismo eje de días.'
          : before ? `La línea punteada es ${before ? previous.name : ''}, el mismo día del mes anterior.`
            : 'Marca más indicadores para verlos en paneles apilados.';
      note.textContent = fallback
        ? `${series.note} El informe por día solo guarda desde el ${longDate(state.dailyRaw?.firstDay)}, así que este mes no tiene vista por día.`
        : `${series.note} ${what}`;
    }
  }

  function renderCampaigns(month) {
    const shown = month.campaigns.filter(campaign => state.group === 'all' || campaign.group === state.group);
    document.getElementById('campaigns-title').textContent = month.annual ? 'Campañas de 2026 (acumulado)' : `Campañas de ${month.name} 2026`;
    document.getElementById('campaigns-sub').textContent = `${month.campaigns.length} campañas con inversión. Cada una con sus conjuntos y sus anuncios; el botón de la derecha minimiza el cuadro.`;
    document.querySelectorAll('#campaigns-filter .series-toggle').forEach(item => item.classList.toggle('active', item.dataset.series === state.group));
    const host = document.getElementById('campaign-blocks');
    if (!host) return;
    if (!shown.length) { host.innerHTML = '<p class="table-empty">Sin campañas de este tipo en el periodo.</p>'; return; }
    const previous = previousMonthWithData(month.annual ? ANNUAL : month.name);
    const label = previous ? previous.name : '';
    const ads = adsOfMonth(month.annual ? ANNUAL : month.name);
    host.innerHTML = shown.map((campaign, index) => {
      const key = campaign.name;
      const open = !state.open.has(key);
      const before = previous ? (previous.campaigns || []).find(item => item.name === campaign.name) : null;
      const mine = ads.filter(ad => ad.campaign === campaign.name);
      return `
        <section class="campaign-block ${open ? '' : 'collapsed'}" data-key="${esc(key)}">
          <div class="campaign-block-head">
            <div>
              <div class="campaign-block-title">${esc(campaign.name)} ${groupPill(campaign.group)}</div>
              <div class="campaign-block-sub">${fmtMoney(campaign.spend)} · ${fmtPct(ratio(campaign.spend * 100, month.kpis.spend))} del periodo · ${mine.length} ${mine.length === 1 ? 'anuncio' : 'anuncios'}</div>
            </div>
            <button type="button" class="campaign-collapse" data-key="${esc(key)}" aria-expanded="${open}" title="${open ? 'Minimizar' : 'Expandir'} ${esc(campaign.name)}">${open ? '–' : '+'}</button>
          </div>
          <div class="campaign-block-body"${open ? '' : ' hidden'}>
            ${campaignKpis(campaign, before, label)}
            ${campaignChartHtml(campaign, index)}
            ${adSetsHtml(mine, campaign)}
            ${campaignAdsHtml(mine, campaign)}
          </div>
        </section>`;
    }).join('');
    state.campaignChartObjects.forEach((chart, name) => {
      if (!shown.some(campaign => campaign.name === name)) { chart.destroy(); state.campaignChartObjects.delete(name); }
    });
    shown.forEach((campaign, index) => {
      if (!state.open.has(campaign.name)) drawCampaignChart(campaign, index, month.annual ? ANNUAL : month.name);
    });
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
  // Hasta que dia llegan los datos y cuantos dias lleva parado. Sincronizar y traer datos nuevos no son
  // lo mismo: la carpeta de Drive puede no haberse movido aunque el barrido corra tres veces al dia.
  function cutoffDay(data) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data?.cutoff || '');
    return parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : null;
  }
  function cutoffLag(data) {
    const day = cutoffDay(data);
    if (!day) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((today - day) / 86400000);
  }
  function cutoffLabel(data) {
    const day = cutoffDay(data);
    return day ? `${day.getDate()} de ${MONTHS[day.getMonth()].toLowerCase()}` : '';
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
  // cargando: "Recargando…" mientras corre Actualizar; aviso: avisos de la carpeta de Drive, mas de un dia sin
  // sincronizar o datos parados (entonces manda el corte, que es lo que de verdad ve el cliente); error: no se
  // pudieron leer los datos o lanzar la sincronizacion (el detalle va en la tarjeta).
  function renderPill() {
    const pill = document.getElementById('data-status-btn');
    const label = document.getElementById('topbar-status');
    if (!pill || !label) return;
    const date = syncDate(state.data);
    const lag = cutoffLag(state.data);
    const behind = lag !== null && lag > STALE_DATA_DAYS;
    const warned = Boolean(state.data?.warnings?.length) || !date || Date.now() - date.getTime() > STALE_MS || behind;
    const tone = state.syncing ? 'loading' : state.loadError || state.syncError ? 'err' : warned ? 'warn' : 'ok';
    ['ok', 'loading', 'warn', 'err'].forEach(name => pill.classList.toggle(name, name === tone));
    label.textContent = state.syncing ? 'Recargando…'
      : state.loadError ? 'No se pudieron cargar los datos'
        : state.syncError ? 'No se pudo sincronizar'
          : behind ? `Datos al ${cutoffLabel(state.data)}`
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
    const label = cutoffLabel(state.data);
    const lag = cutoffLag(state.data);
    const last = [...state.data.months].reverse().find(hasData);
    // Cuando el corte se queda atras lo dice aqui tambien, para que no haya que restar fechas a ojo.
    set('status-data', label ? `Meta Ads al ${label}${lag > STALE_DATA_DAYS ? ` (hace ${lag} días)` : ''}` : '—');
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
    const raw = await fetchDaily();
    const daily = dailyTotals(raw);
    if (raw) state.dailyRaw = raw;
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
  function loadCampaignCharts() {
    try { state.campaignCharts = JSON.parse(readPref(CAMPAIGN_CHART_KEY, '{}')) || {}; } catch { state.campaignCharts = {}; }
  }
  function wireEvents() {
    // Un indicador sin marcar deja el cuadro vacio: se exige al menos uno, como en los cuadros de campana.
    document.getElementById('chart-series-toggles').addEventListener('change', event => {
      const input = event.target.closest('input[type="checkbox"]');
      if (!input) return;
      const metrics = [...document.querySelectorAll('#chart-series-toggles input:checked')].map(item => item.value);
      if (!metrics.length) { input.checked = true; return; }
      saveMonthChart({ metrics });
      renderChart();
    });
    document.getElementById('chart-modes').addEventListener('click', event => {
      if (!event.target.closest('[data-combined]')) return;
      saveMonthChart({ combined: !state.monthChart.combined });
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
    // state.open guarda los cuadros MINIMIZADOS: por defecto se abren todos, como en Terminal Pesquero.
    const blocks = document.getElementById('campaign-blocks');
    blocks.addEventListener('click', event => {
      const collapse = event.target.closest('.campaign-collapse');
      if (collapse) {
        const key = collapse.dataset.key;
        if (state.open.has(key)) state.open.delete(key); else state.open.add(key);
        renderCampaigns(current());
        return;
      }
      const button = event.target.closest('.campaign-chart-modes .table-tool-btn');
      if (!button) return;
      const key = button.closest('.campaign-chart').dataset.key;
      if (button.dataset.combined) saveCampaignChart(key, { combined: !campaignChartSettings(key).combined });
      else saveCampaignChart(key, { mode: button.dataset.mode });
      renderCampaigns(current());
    });
    // Un indicador sin marcar deja el cuadro vacio: se exige al menos uno, como en Terminal Pesquero.
    blocks.addEventListener('change', event => {
      const input = event.target.closest('.campaign-series input[type="checkbox"]');
      if (!input) return;
      const chart = input.closest('.campaign-chart');
      const metrics = [...chart.querySelectorAll('.campaign-series input:checked')].map(item => item.value);
      if (!metrics.length) { input.checked = true; return; }
      saveCampaignChart(chart.dataset.key, { metrics });
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
      state.dailyRaw = await dailyRequest;
      state.daily = dailyTotals(state.dailyRaw);
      loadCampaignCharts();
      loadMonthChart();
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
  window.TLMObjectives = { renderHistory, snapshot, selectMonth, month: () => state.month,
                           comparison: { dailyTotals, periodOf, deltaHtml } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

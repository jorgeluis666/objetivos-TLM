(function () {
  // Datos generados por scripts/build-ads-data.py desde las exportaciones mensuales de Meta Ads en Drive.
  // En el build llegan incrustados como window.TLM_ADS_DATA.
  const DATA_URL = 'data/tlm-ads-2026.json';
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const SHORT_MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const GROUP_CLASS = { Ventas: 'sales', Mensajes: 'messages', Reconocimiento: 'branding' };
  const COLORS = { spend: '#2563eb', revenue: '#0d9488' };
  const CHART_METRICS = {
    spend: { label: 'Inversion y ventas', money: true, sub: 'Inversion en Meta Ads frente al valor de las compras atribuidas a los anuncios (S/)', series: [['spend', 'Inversion'], ['revenue', 'Valor de compras']] },
    purchases: { label: 'Compras', sub: 'Compras en la tienda online atribuidas a los anuncios (pixel de Meta)', series: [['purchases', 'Compras']] },
    conversations: { label: 'Conversaciones', sub: 'Conversaciones de WhatsApp iniciadas desde los anuncios', series: [['conversations', 'Conversaciones']] },
    clicks: { label: 'Clics en el enlace', sub: 'Clics en el enlace de todas las campanas', series: [['clicks', 'Clics en el enlace']] },
  };
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
  const SYNC_SCHEDULE = 'automatica 7:00 a. m., 12:00 m. y 5:00 p. m.';
  const SYNC_POLL_MS = 15000;
  const SYNC_TIMEOUT_MS = 10 * 60 * 1000;
  const state = { data: null, month: null, chart: null, group: 'all', metric: readPref(CHART_METRIC_KEY, 'spend'), chartCollapsed: readPref(CHART_COLLAPSED_KEY, 'false') === 'true', open: new Set(), syncing: false };

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
  const fmtCount = value => isNum(value) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '-';
  const fmtPct = value => isNum(value) ? `${Number(value).toLocaleString('es-PE', { maximumFractionDigits: 1 })}%` : '-';
  const fmtRoas = value => isNum(value) ? `${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x` : '-';
  function symbol() { return state.data?.platform?.symbol || 'S/'; }
  function fmtMoney(value, digits = 2) {
    if (!isNum(value)) return '-';
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
    return match ? `${Number(match[3])} de ${MONTHS[Number(match[2]) - 1].toLowerCase()}` : '-';
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

  // ── Avisos de datos (hojas faltantes o copiadas) ───────────────────────────
  // Los avisos de la carpeta van en el detalle de la barra superior; la pildora se pone ambar mientras haya.
  function renderWarnings() {
    const host = document.getElementById('ads-warnings');
    const warnings = state.data.warnings || [];
    document.getElementById('data-status-btn')?.classList.toggle('warn', Boolean(warnings.length));
    document.getElementById('data-status-btn')?.classList.toggle('ok', !warnings.length);
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
  // KPIs del periodo elegido en las pestanas: un mes o el acumulado del ano.
  function renderKpis() {
    const host = document.getElementById('kpi-strip');
    const period = current();
    if (!period) return;
    const t = yearTotals(period.annual ? period.months : [period]);
    const cutoff = longDate(state.data.cutoff);
    const cards = [
      ['Inversion Meta Ads', fmtMoney(t.spend), period.annual ? `Acumulado al ${cutoff} | ${t.months} meses con datos` : `${period.period || period.name} | ${period.campaigns.length} campanas`],
      ['Valor de compras', fmtMoney(t.revenue), `ROAS ${fmtRoas(ratio(t.revenue, t.spend))} total | ${fmtRoas(ratio(t.sales.revenue, t.sales.spend))} en Ventas`],
      ['Compras', fmtCount(t.purchases), `${fmtMoney(ratio(t.sales.spend, t.sales.purchases))} por compra en Ventas`],
      ['Conversaciones', fmtCount(t.conversations), `WhatsApp | ${fmtCost(ratio(t.messages.spend, t.messages.conversations))} por conversacion`],
      ['Clics en el enlace', fmtCount(t.clicks), `${fmtCost(ratio(t.spend, t.clicks))} por clic | ${fmtCompact(t.landingViews, false)} visitas a la web`],
    ];
    host.innerHTML = cards.map(([name, value, meta]) => `<div class="kpi-pill"><span>${name}</span><strong>${value}</strong><small>${meta}</small></div>`).join('');
  }

  // ── Grafico mensual ────────────────────────────────────────────────────────
  function applyChartCollapsed() {
    const panel = document.getElementById('chart-panel');
    const button = document.getElementById('chart-toggle-btn');
    panel.classList.toggle('is-collapsed', state.chartCollapsed);
    button.textContent = state.chartCollapsed ? '+' : '-';
    button.setAttribute('aria-expanded', String(!state.chartCollapsed));
    button.setAttribute('title', state.chartCollapsed ? 'Expandir grafico' : 'Minimizar grafico');
  }
  function renderChart() {
    const metric = CHART_METRICS[state.metric] ? state.metric : 'spend';
    const config = CHART_METRICS[metric];
    document.getElementById('chart-title').textContent = `Evolucion mensual | ${config.label} | 2026`;
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
    if (typeof Chart === 'undefined') { canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Grafico no disponible sin conexion.</strong><span>Los totales mensuales siguen visibles debajo.</span></div>'; return; }
    const lastIndex = state.data.months.reduce((last, month, index) => hasData(month) ? index : last, 0);
    const months = state.data.months.slice(0, lastIndex + 1);
    const labels = SHORT_MONTHS.slice(0, lastIndex + 1).map((name, index) => months[index]?.status === 'parcial' ? `${name}*` : name);
    const datasets = config.series.map(([key, name]) => ({
      label: name,
      data: months.map(month => hasData(month) ? Number(month.kpis[key] || 0) : null),
      borderColor: color(key),
      backgroundColor: color(key),
      borderWidth: 2.5,
      pointRadius: 5,
      pointHoverRadius: 7,
      tension: .3,
      cubicInterpolationMode: 'monotone',
      spanGaps: false,
    }));
    const axis = { beginAtZero: true, grace: '15%', border: { display: false }, ticks: { color: '#7890b5', font: { size: 10 } } };
    const scales = {
      x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#7890b5', font: { size: 10 } } },
      y: { ...axis, grid: { color: 'rgba(148,163,184,.20)' }, ticks: { ...axis.ticks, callback: value => fmtCompact(value, config.money) } },
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
            label: context => context.raw == null ? ` ${context.dataset.label}: sin datos` : ` ${context.dataset.label}: ${config.money ? fmtMoney(context.raw) : fmtCount(context.raw)}`,
            footer: items => {
              const month = months[items[0].dataIndex];
              return metric === 'spend' && hasData(month) ? `ROAS ${fmtRoas(ratio(month.kpis.revenue, month.kpis.spend))}` : '';
            },
          } },
        },
        scales,
        onClick: (event, elements) => { if (elements[0]) selectMonth(months[elements[0].index].name); },
      },
      plugins: [{ id: 'valueLabels', afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = '600 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        chart.data.datasets.forEach((dataset, index) => {
          ctx.fillStyle = dataset.backgroundColor;
          chart.getDatasetMeta(index).data.forEach((dot, point) => {
            const value = dataset.data[point];
            if (value) ctx.fillText(fmtCompact(value, config.money), dot.x, dot.y - 11);
          });
        });
        ctx.restore();
      } }],
    });
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
  // Cabecera del periodo (como en Terminal Pesquero): "Periodo: Octubre 2026 (mes en curso)" y su detalle.
  function renderPeriod(month) {
    const open = month.status === 'parcial';
    document.getElementById('period-title').textContent = month.annual
      ? `Periodo: Anual 2026${open ? ' (año en curso)' : ''}`
      : `Periodo: ${month.name} 2026${open ? ' (mes en curso)' : ''}`;
    const days = month.firstDay && month.lastDay ? `pauta del ${longDate(month.firstDay)} al ${longDate(month.lastDay)}` : '';
    const source = month.annual
      ? `Acumulado de ${month.months.length} meses con datos (${month.months.map(item => SHORT_MONTHS[MONTHS.indexOf(item.name)]).join(', ')})`
      : month.sheet ? `Hoja "${month.sheet.title}"` : 'Exportacion de Meta Ads';
    document.getElementById('period-sub').textContent = [source, days, `${month.campaigns.length} campanas`].filter(Boolean).join(' | ');
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
          <div><span class="platform-pill meta">${esc(state.data.platform.label)}</span><div class="panel-sub">${esc(state.data.platform.currency)} | ${month.campaigns.length} campanas | ${fmtCount(k.impressions)} impresiones</div></div>
          <div class="ads-platform-spend"><span>Inversion</span><strong>${fmtMoney(k.spend)}</strong></div>
        </div>
        <div class="ads-platform-metrics cols-2">${metrics.map(([name, value, hint]) => `<div><span>${name}</span><strong>${value}</strong><small>${esc(hint)}</small></div>`).join('')}</div>
        <div class="ads-split"><div class="ads-split-bar">${bar}</div><div class="ads-split-legend">${legend}</div></div>
      </div>`;
  }
  // Embudo de la campana de Ventas: de la impresion a la compra en la tienda online.
  function funnelCard(month) {
    const sales = groupTotals([month], 'Ventas');
    if (!sales.spend) {
      return '<div class="panel ads-platform-card funnel empty"><div class="ads-platform-head"><span class="platform-pill sales">Embudo de compra</span></div><div class="empty-state"><strong>Sin campana de Ventas</strong><span>Este mes no hubo inversion en la campana de Ventas.</span></div></div>';
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
          <div><span class="platform-pill sales">Embudo de compra</span><div class="panel-sub">Solo la campana de Ventas | conversion de la impresion a la compra</div></div>
          <div class="ads-platform-spend"><span>Costo por compra</span><strong>${fmtMoney(ratio(sales.spend, sales.purchases))}</strong></div>
        </div>
        <div class="funnel-steps">${rows}</div>
        <div class="funnel-foot">Inversion ${fmtMoney(sales.spend)} | valor de compras ${fmtMoney(sales.revenue)} | ROAS ${fmtRoas(ratio(sales.revenue, sales.spend))}</div>
      </div>`;
  }
  function adsDetail(campaign) {
    const ads = campaign.topAds || [];
    if (!ads.length) return '<span class="no-data">Sin detalle por anuncio</span>';
    const cols = AD_COLUMNS[campaign.group] || [['clicks', 'Clics'], ['impressions', 'Impresiones']];
    const cell = (ad, [key, , money]) => money ? fmtMoney(ad[key]) : fmtCount(ad[key]);
    return `<table class="ads-top-table"><thead><tr><th>Anuncio</th>${cols.map(([, name]) => `<th class="num">${name}</th>`).join('')}<th class="num">Inversion</th><th></th></tr></thead><tbody>${ads.map(ad => `
      <tr><td>${esc(ad.name)}</td>${cols.map(col => `<td class="num">${cell(ad, col)}</td>`).join('')}<td class="num">${fmtMoney(ad.spend)}</td><td>${safeUrl(ad.url) ? `<a href="${safeUrl(ad.url)}" target="_blank" rel="noopener">Ver anuncio</a>` : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  function renderCampaigns(month) {
    const rows = month.campaigns.map((campaign, index) => ({ campaign, key: String(index) })).filter(({ campaign }) => state.group === 'all' || campaign.group === state.group);
    document.getElementById('campaigns-title').textContent = month.annual ? 'Campanas de 2026 (acumulado)' : `Campanas de ${month.name} 2026`;
    document.getElementById('campaigns-sub').textContent = `${month.campaigns.length} campanas con inversion. Despliega cada fila para ver los mejores anuncios.`;
    document.querySelectorAll('#campaigns-filter .series-toggle').forEach(item => item.classList.toggle('active', item.dataset.series === state.group));
    const body = document.getElementById('campaigns-body');
    if (!rows.length) { body.innerHTML = '<tr><td colspan="13" class="table-empty">Sin campanas de este tipo en el mes.</td></tr>'; return; }
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
          <td class="num">${campaign.purchases ? fmtCount(campaign.purchases) : '-'}</td>
          <td class="num">${campaign.revenue ? fmtMoney(campaign.revenue) : '-'}</td>
          <td class="num">${campaign.revenue ? fmtRoas(ratio(campaign.revenue, campaign.spend)) : '-'}</td>
          <td>${hasAds ? `<button type="button" class="ads-expand" data-key="${key}" aria-expanded="${open}">${open ? 'Ocultar' : `Ver ${campaign.topAds.length}`}</button>` : '<span class="no-data">-</span>'}</td>
        </tr>
        ${open ? `<tr class="ads-detail-row"><td colspan="13">${adsDetail(campaign)}</td></tr>` : ''}`;
    }).join('');
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
        <td class="num">${campaign.purchases ? fmtCount(campaign.purchases) : '-'}</td>
        <td class="num">${campaign.revenue ? fmtMoney(campaign.revenue) : '-'}</td>
        <td>${ads.length ? ads.map(ad => safeUrl(ad.url) ? `<a class="history-ad-link" href="${safeUrl(ad.url)}" target="_blank" rel="noopener">${esc(ad.name)}</a>` : `<span class="history-ad-muted">${esc(ad.name)}</span>`).join('') : '-'}</td>
        <td class="date-col">${esc(month.period || '-')}</td>
      </tr>`;
    }).join('');
  }

  // ── Sincronizacion con Drive ───────────────────────────────────────────────
  // El workflow sync-ads-data.yml descarga las hojas de Drive, regenera data/tlm-ads-2026.json y lo
  // publica (tres veces al dia y a pedido). El boton le pide al Web App que lo lance y espera a que el
  // sello syncedAt del JSON publicado cambie para volver a dibujar el tablero.
  function syncEndpoint() { return SYNC_TRIGGER_RE.test(SYNC_TRIGGER_ENDPOINT) ? SYNC_TRIGGER_ENDPOINT : ''; }
  function syncStamp(data) { return data?.syncedAt || data?.generatedAt || ''; }
  function syncLabel(data) {
    const stamp = syncStamp(data);
    const date = stamp ? new Date(stamp.length === 10 ? `${stamp}T12:00:00` : stamp) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    const day = `${date.getDate()} ${SHORT_MONTHS[date.getMonth()].toLowerCase()}`;
    return stamp.length === 10 ? `Ultima sincronizacion: ${day}` : `Ultima sincronizacion: ${day}, ${date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`;
  }
  function setSyncStatus(text, busy = false) {
    const button = document.getElementById('ads-sync-btn');
    const status = document.getElementById('ads-sync-status');
    if (status) { status.textContent = text; status.hidden = !text; }
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? 'Actualizando...' : 'Actualizar';
    button.title = syncEndpoint() ? 'Lee otra vez la carpeta de Drive y actualiza el tablero' : 'Vuelve a cargar los ultimos datos publicados';
  }
  // Proxima corrida automatica del workflow (7:00, 12:00 y 17:00 de Lima; GitHub puede demorarla unos minutos).
  function nextAutoSync() {
    const lima = new Date(Date.now() - 5 * 3600000);
    const hour = lima.getUTCHours() + lima.getUTCMinutes() / 60;
    const next = [7, 12, 17].find(value => value > hour);
    const label = value => value === 12 ? '12:00 m.' : `${value > 12 ? value - 12 : value}:00 ${value < 12 ? 'a. m.' : 'p. m.'}`;
    return next ? `Hoy, ${label(next)}` : `Manana, ${label(7)}`;
  }
  function renderStatus() {
    const set = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };
    const cutoff = /^(\d{4})-(\d{2})-(\d{2})$/.exec(state.data.cutoff || '');
    const last = [...state.data.months].reverse().find(hasData);
    set('status-data', cutoff ? `Meta Ads al ${Number(cutoff[3])} de ${MONTHS[Number(cutoff[2]) - 1].toLowerCase()}` : '-');
    set('status-last', syncLabel(state.data).replace('Ultima sincronizacion: ', '') || '-');
    set('status-next', nextAutoSync());
    set('status-file', last?.sheet?.title || '-');
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
  function applyData(data) {
    state.data = data;
    const withData = data.months.filter(hasData);
    if (state.month !== ANNUAL && !hasData(monthData(state.month))) state.month = withData[withData.length - 1]?.name || null;
    state.open.clear();
    renderAll();
  }
  async function syncFromDrive() {
    if (state.syncing) return;
    state.syncing = true;
    const before = syncStamp(state.data);
    const endpoint = syncEndpoint();
    try {
      // Sin Web App: solo se relee lo que publico la sincronizacion automatica.
      if (!endpoint) {
        setSyncStatus('Buscando datos nuevos...', true);
        const data = await fetchPublishedData().catch(() => null);
        if (data && syncStamp(data) !== before) applyData(data);
        setSyncStatus(data
          ? `${syncStamp(data) !== before ? 'Datos actualizados.' : 'Ya tienes los ultimos datos publicados.'} Sincronizacion ${SYNC_SCHEDULE}`
          : 'No se pudieron leer los datos. Intenta en unos minutos.');
        return;
      }
      setSyncStatus('Leyendo la carpeta de Drive. El tablero se actualiza solo al terminar (2 a 4 minutos).', true);
      try {
        const result = await requestSync(endpoint);
        if (result.pending) setSyncStatus('Ya hay una sincronizacion en curso. El tablero se actualiza solo al terminar.', true);
      } catch (error) {
        setSyncStatus(`No se pudo iniciar la sincronizacion (${error.message}). ${syncLabel(state.data)}`);
        return;
      }
      const started = Date.now();
      while (Date.now() - started < SYNC_TIMEOUT_MS) {
        await new Promise(resolve => setTimeout(resolve, SYNC_POLL_MS));
        const data = await fetchPublishedData().catch(() => null);
        if (data && syncStamp(data) !== before) {
          applyData(data);
          setSyncStatus(`Datos actualizados. ${syncLabel(data)}`);
          return;
        }
      }
      setSyncStatus('Aun no llegan datos nuevos. Recarga la pagina en unos minutos.');
    } finally {
      state.syncing = false;
      const button = document.getElementById('ads-sync-btn');
      if (button) { button.textContent = 'Actualizar'; button.disabled = false; }
    }
  }

  function renderAll() {
    const folder = document.getElementById('ads-folder-link');
    if (folder && /^[A-Za-z0-9_-]{10,}$/.test(state.data.folderId || '')) folder.href = `https://drive.google.com/drive/folders/${state.data.folderId}`;
    renderWarnings();
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
      if (window.TLM_ADS_DATA) state.data = window.TLM_ADS_DATA;
      else {
        const response = await fetch(DATA_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state.data = await response.json();
      }
      const withData = state.data.months.filter(hasData);
      if (!withData.length) throw new Error('Sin meses con datos');
      state.month = withData[withData.length - 1].name;
      wireEvents();
      wireStatusCard();
      renderAll();
      setSyncStatus('');
    } catch (error) {
      document.getElementById('view-obj').innerHTML = '<div class="data-notice error"><strong>No se pudo cargar la informacion de The Little Market.</strong></div>';
      console.error(error);
    }
  }
  // Copia de solo lectura para Proyecciones.
  function snapshot() {
    return state.data ? JSON.parse(JSON.stringify(state.data)) : null;
  }
  window.TLMObjectives = { renderHistory, snapshot };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

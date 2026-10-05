(function () {
  // Proyecta al cierre del mes en curso los indicadores del modulo Gasto publicitario (Meta Ads, en soles).
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const SHORT_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const COLORS = { spend: '#2563eb', revenue: '#0d9488' };
  // Indicadores acumulables del mes.
  const METRICS = [
    { key: 'spend', label: 'Inversion', money: true },
    { key: 'revenue', label: 'Valor de compras', money: true, note: 'Atribuido a los anuncios por el pixel de Meta' },
    { key: 'purchases', label: 'Compras' },
    { key: 'addToCart', label: 'Agregados al carrito' },
    { key: 'conversations', label: 'Conversaciones de WhatsApp' },
    { key: 'clicks', label: 'Clics en el enlace' },
    { key: 'thruplays', label: 'ThruPlays' },
  ];
  const CHART_METRICS = {
    spend: { label: 'Inversion', money: true, sub: 'Inversion acumulada en soles' },
    revenue: { label: 'Valor de compras', money: true, sub: 'Valor de las compras atribuidas a los anuncios' },
    purchases: { label: 'Compras', sub: 'Compras en la tienda online' },
    conversations: { label: 'Conversaciones', sub: 'Conversaciones de WhatsApp iniciadas' },
    clicks: { label: 'Clics en el enlace', sub: 'Clics en el enlace de todas las campanas' },
  };
  const KPI_KEYS = ['spend', 'revenue', 'purchases', 'conversations', 'clicks'];
  const KPI_TITLES = {
    spend: 'Inversion proyectada',
    revenue: 'Valor de compras proyectado',
    purchases: 'Compras proyectadas',
    conversations: 'Conversaciones proyectadas',
    clicks: 'Clics proyectados',
  };

  const state = { ready: false, metric: 'spend', chart: null, projection: null, data: null };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const isNum = value => value != null && value !== '' && Number.isFinite(Number(value));
  const symbol = () => state.data?.platform?.symbol || 'S/';
  const fmtCount = value => isNum(value) ? Math.round(Number(value)).toLocaleString('es-PE') : '-';
  function fmtMoney(value, digits = 2) {
    if (!isNum(value)) return '-';
    return `${symbol()} ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }
  const fmtCost = value => fmtMoney(value, isNum(value) && Number(value) < 0.1 ? 3 : 2);
  const fmtRoas = value => isNum(value) ? `${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x` : '-';
  const fmtValue = (value, metric) => (metric.money ? fmtMoney(value) : fmtCount(value));
  function fmtCompact(value, money) {
    if (!isNum(value)) return '';
    const prefix = money ? `${symbol()} ` : '';
    if (Math.abs(value) >= 1e6) return `${prefix}${(value / 1e6).toFixed(2)}M`;
    if (Math.abs(value) >= 1e3) return `${prefix}${(value / 1e3).toFixed(1)}k`;
    return `${prefix}${Math.round(value)}`;
  }
  const pctChange = (value, base) => (isNum(value) && Number(base) > 0 ? (value / base - 1) * 100 : null);
  const ratio = (value, count) => (isNum(value) && Number(count) > 0 ? Number(value) / Number(count) : null);

  function parseDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  }
  const longDate = date => (date ? `${date.getDate()} de ${MONTHS[date.getMonth()].toLowerCase()}` : '-');
  const hasData = month => Boolean(month?.kpis);
  function groupTotals(month, group) {
    const totals = { spend: 0, purchases: 0, revenue: 0, conversations: 0 };
    (month?.campaigns || []).filter(campaign => campaign.group === group).forEach(campaign => {
      Object.keys(totals).forEach(key => { totals[key] += Number(campaign[key] || 0); });
    });
    return totals;
  }

  // El mes proyectado es el de la fecha de corte; si no tiene datos, el ultimo mes con datos.
  function pickMonth(months, cutoff) {
    const withData = months.filter(hasData);
    if (!withData.length) return null;
    const current = cutoff ? withData.find(month => MONTHS.indexOf(month.name) === cutoff.getMonth()) : null;
    return current || withData[withData.length - 1];
  }

  // Dias transcurridos: si la pauta arranco despues del dia 1, el ritmo se calcula solo sobre los dias con pauta.
  function elapsedDays(month, year, monthIndex, lastDay) {
    const first = parseDate(month.firstDay);
    const startDay = first && first.getFullYear() === year && first.getMonth() === monthIndex ? first.getDate() : 1;
    return Math.max(1, lastDay - startDay + 1);
  }

  function buildProjection(data) {
    const cutoff = parseDate(data.cutoff);
    const month = pickMonth(data.months || [], cutoff);
    if (!month) return null;
    const monthIndex = MONTHS.indexOf(month.name);
    const year = data.year || cutoff?.getFullYear() || new Date().getFullYear();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const closed = month.status !== 'parcial' || !cutoff || cutoff.getMonth() !== monthIndex || cutoff.getDate() >= daysInMonth;
    const lastDay = closed ? daysInMonth : cutoff.getDate();
    const previous = [...data.months.slice(0, data.months.indexOf(month))].reverse().find(hasData) || null;
    const days = elapsedDays(month, year, monthIndex, lastDay);
    const remaining = daysInMonth - lastDay;

    const metrics = METRICS.map(metric => {
      const actual = Number(month.kpis[metric.key]) || 0;
      const pace = actual / days;
      const projected = closed ? actual : actual + pace * remaining;
      const reference = previous ? Number(previous.kpis[metric.key]) || null : null;
      return { ...metric, actual, pace, projected, reference, change: pctChange(projected, reference) };
    });
    const byKey = Object.fromEntries(metrics.map(metric => [metric.key, metric]));
    const projectedGroups = Object.fromEntries(Object.entries(month.spendByGroup || {}).map(([group, value]) => [group, closed ? value : value + (value / days) * remaining]));
    // Con un ritmo constante los costos unitarios no cambian al cierre; se comparan con el mes anterior.
    const sales = groupTotals(month, 'Ventas');
    const salesBefore = groupTotals(previous, 'Ventas');
    const messages = groupTotals(month, 'Mensajes');
    const messagesBefore = groupTotals(previous, 'Mensajes');
    const costs = [
      { label: 'Costo por compra (Ventas)', value: ratio(sales.spend, sales.purchases), reference: previous ? ratio(salesBefore.spend, salesBefore.purchases) : null, inverse: true },
      { label: 'ROAS total', value: ratio(month.kpis.revenue, month.kpis.spend), reference: previous ? ratio(previous.kpis.revenue, previous.kpis.spend) : null, roas: true },
      { label: 'Costo por conversacion (Mensajes)', value: ratio(messages.spend, messages.conversations), reference: previous ? ratio(messagesBefore.spend, messagesBefore.conversations) : null, inverse: true },
      { label: 'Costo por clic en el enlace', value: ratio(month.kpis.spend, month.kpis.clicks), reference: previous ? ratio(previous.kpis.spend, previous.kpis.clicks) : null, inverse: true },
    ];
    costs.forEach(cost => { cost.change = pctChange(cost.value, cost.reference); });

    return {
      month,
      monthIndex,
      monthLabel: `${month.name} ${year}`,
      shortMonth: SHORT_MONTHS[monthIndex],
      previous,
      previousName: previous?.name || null,
      year,
      daysInMonth,
      lastDay,
      daysLeft: remaining,
      closed,
      cutoff,
      days,
      startOffset: lastDay - days,
      metrics,
      byKey,
      projectedGroups,
      costs,
    };
  }

  function changePill(change, { inverse = false, neutral = false } = {}) {
    if (!isNum(change)) return '<span class="no-data">Sin referencia</span>';
    const rounded = Math.round(change);
    if (rounded === 0) return '<span class="projection-gap flat">Igual al mes anterior</span>';
    // En costos, subir es negativo; en volumen, subir es positivo. La inversion no se califica.
    const good = inverse ? rounded < 0 : rounded > 0;
    const tone = neutral ? 'flat' : good ? 'ok' : 'over';
    return `<span class="projection-gap ${tone}">${rounded > 0 ? '+' : ''}${rounded}%</span>`;
  }

  function renderKpis(projection) {
    const host = document.getElementById('projection-kpis');
    if (!host) return;
    const prev = projection.previousName ? `vs ${projection.previousName}` : '';
    const progress = projection.closed ? 'Mes cerrado' : `Dia ${projection.lastDay} de ${projection.daysInMonth} | quedan ${projection.daysLeft} dias`;
    const cards = KPI_KEYS.map(key => projection.byKey[key]).map(metric => {
      const pace = metric.money ? fmtMoney(metric.pace) : fmtCount(metric.pace);
      const change = isNum(metric.change) ? ` | ${metric.change >= 0 ? '+' : ''}${metric.change.toFixed(0)}% ${prev}` : '';
      return `<div class="kpi-pill"><span>${esc(KPI_TITLES[metric.key] || metric.label)}</span><strong>${fmtValue(metric.projected, metric)}</strong><small>${esc(`${pace} por dia${change}`)}</small></div>`;
    }).join('');
    host.innerHTML = `<div class="projection-kpi-row"><div class="projection-kpi-head"><span class="platform-pill meta">${esc(state.data.platform.label)}</span><small>${esc(state.data.platform.currency)} | ${esc(progress)}</small></div><div class="kpi-strip cols-${KPI_KEYS.length}">${cards}</div></div>`;
  }

  function renderTable(projection) {
    const body = document.getElementById('projection-body');
    if (!body) return;
    const prevHead = document.getElementById('projection-prev-head');
    if (prevHead) prevHead.textContent = projection.previousName ? `Cierre ${projection.previousName}` : 'Mes anterior';
    const actualHead = document.getElementById('projection-actual-head');
    if (actualHead) actualHead.textContent = `Actual al ${projection.lastDay}-${projection.shortMonth}`;
    const closeHead = document.getElementById('projection-close-head');
    if (closeHead) closeHead.textContent = `Proyeccion al ${projection.daysInMonth}-${projection.shortMonth}`;

    const pace = projection.startOffset > 0 ? ` | pauta desde el dia ${projection.startOffset + 1}` : '';
    const headRow = `<tr class="projection-platform-row"><td colspan="6"><span class="platform-pill meta">${esc(state.data.platform.label)}</span><small>${esc(state.data.platform.currency)} | ritmo sobre ${projection.days} dias${pace}</small></td></tr>`;
    const metricRows = projection.metrics.map(metric => `
      <tr>
        <td class="campaign-name">${esc(metric.label)}${metric.note ? `<small class="projection-note-inline">${esc(metric.note)}</small>` : ''}</td>
        <td class="num">${fmtValue(metric.actual, metric)}</td>
        <td class="num">${metric.money ? fmtMoney(metric.pace) : fmtCount(metric.pace)}</td>
        <td class="num projection-value">${fmtValue(metric.projected, metric)}</td>
        <td class="num">${isNum(metric.reference) ? fmtValue(metric.reference, metric) : '<span class="no-data">-</span>'}</td>
        <td>${changePill(metric.change, { neutral: metric.key === 'spend' })}</td>
      </tr>`).join('');
    const groups = Object.entries(projection.projectedGroups).sort((a, b) => b[1] - a[1]);
    const groupRows = groups.length > 1 ? groups.map(([group, value]) => {
      const actual = projection.month.spendByGroup[group];
      const reference = projection.previous?.spendByGroup?.[group];
      return `
      <tr class="projection-sub-row">
        <td class="campaign-name">Inversion ${esc(group)}</td>
        <td class="num">${fmtMoney(actual)}</td>
        <td class="num">${fmtMoney(actual / projection.days)}</td>
        <td class="num projection-value">${fmtMoney(value)}</td>
        <td class="num">${isNum(reference) ? fmtMoney(reference) : '<span class="no-data">-</span>'}</td>
        <td>${changePill(pctChange(value, reference), { neutral: true })}</td>
      </tr>`;
    }).join('') : '';
    const costRows = projection.costs.map(cost => {
      const format = cost.roas ? fmtRoas : fmtCost;
      return `
      <tr class="projection-cost-row">
        <td class="campaign-name">${esc(cost.label)}</td>
        <td class="num">${format(cost.value)}</td>
        <td class="num"><span class="no-data">-</span></td>
        <td class="num projection-value">${format(cost.value)}</td>
        <td class="num">${isNum(cost.reference) ? format(cost.reference) : '<span class="no-data">-</span>'}</td>
        <td>${changePill(cost.change, { inverse: cost.inverse })}</td>
      </tr>`;
    }).join('');
    body.innerHTML = headRow + metricRows + groupRows + costRows;
  }

  // Serie acumulada diaria: real hasta el corte y ritmo constante hasta fin de mes.
  function series(projection, metricKey) {
    const metric = projection.byKey[metricKey];
    if (!metric) return { real: [], forecast: [], reference: null };
    const valueAt = day => (day <= projection.startOffset ? 0 : metric.pace * (day - projection.startOffset));
    const days = Array.from({ length: projection.daysInMonth }, (_, index) => index + 1);
    return {
      real: days.map(day => (day <= projection.lastDay ? valueAt(day) : null)),
      forecast: days.map(day => (!projection.closed && day >= projection.lastDay ? valueAt(day) : null)),
      reference: metric.reference,
    };
  }

  const cutoffMarker = {
    id: 'cutoffMarker',
    afterDatasetsDraw(chart, args, options) {
      const index = options?.index;
      if (index == null || index < 0) return;
      const x = chart.scales.x.getPixelForValue(index);
      const { top, bottom, left, right } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#7890b5';
      ctx.font = '700 9px Inter, sans-serif';
      ctx.textAlign = x > (left + right) / 2 ? 'right' : 'left';
      ctx.fillText(options.label || '', x + (ctx.textAlign === 'right' ? -6 : 6), top + 10);
      ctx.restore();
    },
  };

  function renderChart(projection) {
    const metricKey = CHART_METRICS[state.metric] ? state.metric : 'spend';
    const config = CHART_METRICS[metricKey];
    document.getElementById('projection-chart-sub').textContent = projection.closed
      ? `${projection.monthLabel} cerrado. ${config.sub}.`
      : `Real hasta el dia ${projection.lastDay} y proyeccion hasta el ${projection.daysInMonth}. ${config.sub}.`;
    document.querySelectorAll('#projection-metrics .series-toggle').forEach(item => {
      const active = item.dataset.series === metricKey;
      item.classList.toggle('active', active);
      item.querySelector('input').checked = active;
    });
    const color = COLORS[metricKey] || COLORS.spend;
    const legend = document.getElementById('projection-legend');
    if (legend) {
      legend.innerHTML = [
        `<span><i class="legend-line" style="background:${color}"></i><b>${esc(config.label)} real</b></span>`,
        '<span><i class="legend-line dashed"></i><b>Proyeccion al cierre</b></span>',
        projection.previousName ? `<span><i class="legend-line dotted"></i><b>Cierre de ${esc(projection.previousName)}</b></span>` : '',
      ].join('');
    }

    const canvas = document.getElementById('chart-projection');
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Grafico no disponible sin conexion.</strong><span>La tabla de proyeccion sigue visible debajo.</span></div>';
      return;
    }
    const labels = Array.from({ length: projection.daysInMonth }, (_, index) => `${index + 1} ${projection.shortMonth}`);
    const data = series(projection, metricKey);
    const base = { borderColor: color, backgroundColor: color, pointRadius: 0, pointHoverRadius: 5, tension: 0 };
    const datasets = [
      { ...base, label: `${config.label} real`, data: data.real, borderWidth: 2.5 },
      { ...base, label: `${config.label} proyeccion`, data: data.forecast, borderWidth: 2, borderDash: [6, 5] },
    ];
    if (isNum(data.reference)) {
      datasets.push({ ...base, label: `Cierre ${projection.previousName}`, data: labels.map(() => data.reference), borderWidth: 1.2, borderDash: [2, 4], pointHoverRadius: 0, borderColor: `${color}88` });
    }
    const axis = { beginAtZero: true, grace: '8%', border: { display: false }, ticks: { color: '#7890b5', font: { size: 10 } } };
    const scales = {
      x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#7890b5', font: { size: 10 }, maxTicksLimit: 10, autoSkip: true } },
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
        layout: { padding: { top: 18, right: 8, left: 4 } },
        plugins: {
          legend: { display: false },
          cutoffMarker: { index: projection.closed ? -1 : projection.lastDay - 1, label: `Datos al ${projection.lastDay}-${projection.shortMonth}` },
          tooltip: {
            filter: item => item.raw != null,
            callbacks: {
              label: context => ` ${context.dataset.label}: ${config.money ? fmtMoney(context.raw) : fmtCount(context.raw)}`,
            },
          },
        },
        scales,
      },
      plugins: [cutoffMarker],
    });
  }

  function renderHeader(projection) {
    const desc = document.getElementById('projection-desc');
    if (desc) {
      desc.textContent = projection.closed
        ? `${projection.monthLabel} esta cerrado: se muestran sus totales reales frente a ${projection.previousName || 'el mes anterior'}.`
        : `Cierre estimado de ${projection.monthLabel} con los datos reales del modulo Gasto publicitario al ${longDate(projection.cutoff)} (${projection.lastDay} de ${projection.daysInMonth} dias), manteniendo el ritmo diario promedio del mes.`;
    }
    const title = document.getElementById('projection-title');
    if (title) title.textContent = `Linea de tiempo | ${projection.monthLabel}`;
    const tableSub = document.getElementById('projection-table-sub');
    if (tableSub) {
      tableSub.textContent = `Ritmo diario = acumulado real / dias con pauta. Proyeccion = actual + ritmo x ${projection.daysLeft} dias restantes. La ultima columna compara la proyeccion con el cierre de ${projection.previousName || 'el mes anterior'}.`;
    }
    const note = document.getElementById('projection-note');
    if (note) {
      const sheet = projection.month.sheet?.title ? `hoja "${projection.month.sheet.title}"` : 'exportacion de Meta Ads';
      note.textContent = `La linea real se traza con el ritmo promedio del periodo. Pocas compras al inicio del mes hacen que su proyeccion sea muy variable. Fuente del mes: ${sheet}.`;
    }
  }

  function renderEmpty(message) {
    const body = document.getElementById('projection-body');
    if (body) body.innerHTML = `<tr><td class="table-empty" colspan="6">${esc(message)}</td></tr>`;
    const sub = document.getElementById('projection-chart-sub');
    if (sub) sub.textContent = message;
  }

  function render() {
    // El modulo puede abrirse antes de que Gasto publicitario termine de cargar; tlm:data-updated lo reintenta.
    const data = window.TLMObjectives?.snapshot?.();
    if (!data) {
      renderEmpty('Esperando los datos del modulo Gasto publicitario...');
      return;
    }
    state.data = data;
    const projection = buildProjection(data);
    state.projection = projection;
    if (!projection) {
      renderEmpty('Sin datos para proyectar.');
      return;
    }
    renderHeader(projection);
    renderKpis(projection);
    renderChart(projection);
    renderTable(projection);
  }

  function wireEvents() {
    document.getElementById('projection-metrics')?.addEventListener('change', event => {
      const input = event.target.closest('input[type="radio"]');
      if (!input) return;
      state.metric = input.value;
      if (state.projection) renderChart(state.projection);
    });
    window.addEventListener('tlm:data-updated', () => {
      if (state.ready) render();
    });
  }

  function init() {
    if (!state.ready) {
      wireEvents();
      state.ready = true;
    }
    render();
  }

  window.TLMProjections = { init, render };
})();

/**
 * calculadora.js - Calculadora de Inversion: de una meta de facturacion a la inversion en Meta Ads.
 *
 * La de Terminal Pesquero va de facturacion a mensajes por CPL, porque esa cuenta vende por WhatsApp.
 * The Little Market vende en la tienda online, asi que la cadena es otra: facturacion objetivo -> compras
 * necesarias (por el ticket promedio) -> inversion necesaria (por el ROAS).
 *
 * Los tres campos arrancan con los numeros reales de la cuenta, no con cifras de ejemplo: el ticket y el
 * ROAS salen del acumulado del ano, que es la base mas estable que hay (un mes suelto de esta cuenta trae
 * pocas compras y el promedio salta). Se pueden cambiar, y entonces manda lo que escribas.
 */
(function () {
  // Escenarios alrededor del ROAS que este en la caja, que arranca siendo el real de la cuenta. El pivote
  // es ese y no el del archivo: si fuera el del archivo, la fila "el que pusiste" no daria la misma
  // inversion que la tarjeta de arriba y pareceria un error de cuentas.
  const SCENARIOS = [
    { label: 'La mitad', factor: 0.5 },
    { label: 'El ROAS que pusiste', factor: 1, current: true },
    { label: 'Un 25 % mejor', factor: 1.25 },
    { label: 'El doble', factor: 2 },
  ];
  const state = { data: null, base: null, goal: null, ticket: null, roas: null };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const isNum = value => value != null && value !== '' && Number.isFinite(Number(value));
  const symbol = () => { const value = state.data?.platform?.symbol || 'S/.'; return value === 'S/' ? 'S/.' : value; };
  const money = (value, digits = 2) => isNum(value)
    ? `${symbol()} ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
    : '—';
  const count = value => isNum(value) ? Math.round(Number(value)).toLocaleString('es-PE') : '—';
  const roasText = value => isNum(value) ? `${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x` : '—';

  // ── La base: lo que la cuenta hace hoy ─────────────────────────────────────
  function baseOf(data) {
    const months = (data.months || []).filter(month => month.kpis);
    if (!months.length) return null;
    const year = months.reduce((total, month) => {
      ['spend', 'revenue', 'purchases'].forEach(key => { total[key] += Number(month.kpis[key] || 0); });
      return total;
    }, { spend: 0, revenue: 0, purchases: 0 });
    const last = months[months.length - 1];
    return {
      months: months.length,
      spend: year.spend,
      revenue: year.revenue,
      purchases: year.purchases,
      // Sin compras no hay ticket ni ROAS que proponer: la calculadora lo dice y deja los campos vacios.
      ticket: year.purchases > 0 ? year.revenue / year.purchases : null,
      roas: year.spend > 0 && year.revenue > 0 ? year.revenue / year.spend : null,
      monthSpend: Number(last.kpis.spend || 0),
      monthRevenue: Number(last.kpis.revenue || 0),
      monthPurchases: Number(last.kpis.purchases || 0),
      monthName: last.name,
      monthPeriod: last.period || last.name,
    };
  }

  const value = id => {
    const input = document.getElementById(id);
    const number = Number(input?.value);
    return input && input.value !== '' && Number.isFinite(number) && number > 0 ? number : null;
  };

  function render() {
    const base = state.base;
    if (!base) return;
    const goal = state.goal;
    const ticket = state.ticket;
    const roas = state.roas;
    const purchases = goal && ticket ? goal / ticket : null;
    const spend = goal && roas ? goal / roas : null;
    const costPerPurchase = spend && purchases ? spend / purchases : null;

    const kpis = document.getElementById('calc-kpis');
    if (kpis) {
      const cards = [
        { label: 'Inversión necesaria', value: money(spend), note: roas ? `Con un ROAS de ${roasText(roas)}` : 'Falta el ROAS' },
        { label: 'Compras necesarias', value: count(purchases), note: ticket ? `Con un ticket de ${money(ticket)}` : 'Falta el ticket promedio' },
        { label: 'Costo por compra', value: money(costPerPurchase), note: 'Lo que puedes pagar por cada venta' },
        { label: 'Facturación objetivo', value: money(goal), note: 'La meta que escribiste' },
      ];
      kpis.innerHTML = cards.map(card =>
        `<div class="kpi-pill"><span>${esc(card.label)}</span><strong>${card.value}</strong><small>${esc(card.note)}</small></div>`).join('');
    }

    const note = document.getElementById('calc-note');
    if (note) {
      if (!spend) note.textContent = 'Escribe una facturación objetivo para ver cuánto habría que invertir.';
      else {
        const diff = spend - base.monthSpend;
        const more = diff > 0
          ? `${money(diff)} más de lo que lleva ${base.monthName} (${money(base.monthSpend)})`
          : `${money(Math.abs(diff))} menos de lo que lleva ${base.monthName} (${money(base.monthSpend)})`;
        note.textContent = `Son ${more}. El cálculo mantiene el ROAS y el ticket que pusiste arriba: si el ROAS real baja, la misma facturación pide más inversión.`;
      }
    }

    const body = document.getElementById('calc-scenarios');
    if (!body) return;
    if (!goal || !roas) {
      body.innerHTML = '<tr><td class="table-empty" colspan="5">Escribe una facturación objetivo y un ROAS para ver los escenarios.</td></tr>';
      return;
    }
    body.innerHTML = SCENARIOS.map(scenario => {
      const scenarioRoas = roas * scenario.factor;
      const scenarioSpend = goal / scenarioRoas;
      const scenarioCost = purchases ? scenarioSpend / purchases : null;
      const diff = spend ? scenarioSpend - spend : null;
      const diffText = !isNum(diff) || Math.abs(diff) < 0.005
        ? '<span class="no-data">—</span>'
        : `<span class="kpi-delta ${diff > 0 ? 'down' : 'up'}">${diff > 0 ? '▲' : '▼'} ${money(Math.abs(diff))}</span>`;
      return `<tr${scenario.current ? ' class="row-current"' : ''}>
        <td>${esc(scenario.label)}${scenario.current ? ' <b class="leader-star" title="El ROAS de la caja de arriba">★</b>' : ''}</td>
        <td class="num">${roasText(scenarioRoas)}</td>
        <td class="num">${money(scenarioSpend)}</td>
        <td class="num">${money(scenarioCost)}</td>
        <td class="num">${diffText}</td>
      </tr>`;
    }).join('');
  }

  function fill() {
    const base = state.base;
    const goalInput = document.getElementById('calc-goal');
    const ticketInput = document.getElementById('calc-ticket');
    const roasInput = document.getElementById('calc-roas');
    if (!base || !goalInput) return;
    // Meta de arranque: el valor de compras del ultimo mes redondeado hacia arriba a la centena, para que
    // el primer numero que se vea sea del tamano de la cuenta y no un cero.
    if (goalInput.value === '') goalInput.value = String(Math.max(100, Math.ceil((base.monthRevenue || base.revenue / base.months) / 100) * 100));
    if (ticketInput.value === '' && base.ticket) ticketInput.value = base.ticket.toFixed(2);
    if (roasInput.value === '' && base.roas) roasInput.value = base.roas.toFixed(2);
    state.goal = value('calc-goal');
    state.ticket = value('calc-ticket');
    state.roas = value('calc-roas');

    const info = document.getElementById('calc-base');
    if (info) {
      info.textContent = base.purchases > 0
        ? `Base: ${base.months} meses de 2026 con ${count(base.purchases)} compras, ${money(base.revenue)} de valor y ${money(base.spend)} de inversión. Ticket promedio ${money(base.ticket)} y ROAS ${roasText(base.roas)}.`
        : `Base: ${base.months} meses de 2026 con ${money(base.spend)} de inversión y ninguna compra registrada, así que el ticket y el ROAS los tienes que poner tú.`;
    }
  }

  function wire() {
    ['calc-goal', 'calc-ticket', 'calc-roas'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        state.goal = value('calc-goal');
        state.ticket = value('calc-ticket');
        state.roas = value('calc-roas');
        render();
      });
    });
  }

  function load() {
    const data = window.TLMObjectives?.snapshot?.();
    if (!data) return;
    state.data = data;
    state.base = baseOf(data);
    if (!state.base) return;
    fill();
    render();
  }

  function start() {
    wire();
    load();
    window.addEventListener('tlm:data-updated', load);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

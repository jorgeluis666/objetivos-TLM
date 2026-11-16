const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// El mes en curso se descarga por semanas cerradas (months[].periods) y el mes cerrado, completo.
test('El selector ofrece las semanas cerradas del mes en curso y el mes completo del cerrado', async () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/tlm-report-2026.json'), 'utf8'));
  const november = data.months[10];
  const october = data.months[9];
  // Cortes de prueba: cada semana suma mas anuncios, para ver que el reporte se rearma con el elegido.
  const cut = (lastDay, count) => ({ firstDay: '2026-11-01', lastDay, kpis: november.kpis,
    spendByGroup: november.spendByGroup, campaigns: november.campaigns, ads: november.ads.slice(0, count) });
  data.months = data.months.map((month, index) => {
    if (index === 9) return { ...october, status: 'cerrado', lastDay: '2026-10-31' };
    if (index === 10) return { ...november, status: 'parcial', lastDay: '2026-11-22',
      periods: [cut('2026-11-08', 3), cut('2026-11-15', 8), cut('2026-11-22', november.ads.length)] };
    return null;
  });

  const host = { innerHTML: '', querySelectorAll: () => [] };
  let onChange;
  const select = { innerHTML: '', addEventListener(name, handler) { onChange = handler; } };
  const button = { addEventListener() {} };
  const document = { title: 'TLM', getElementById: id => ({ 'week-report': host, 'week-select': select, 'week-print': button, 'week-reset': button }[id]) };
  let printedTitle;
  const window = { addEventListener() {}, removeEventListener() {}, print() { printedTitle = document.title; }, setTimeout() {} };
  const context = { window, document, console, Intl, Date, fetch: async () => ({ ok: true, json: async () => data }) };
  const code = fs.readFileSync(path.join(__dirname, '../js/report-week.js'), 'utf8')
    .replace('global.TLMReportWeek = { init };', 'global.TLMReportWeek = { init, printReport };');
  vm.runInNewContext(code, context);
  await window.TLMReportWeek.init();

  // Las tres semanas del mes en curso, de la mas reciente a la mas antigua, y el mes cerrado entero.
  const options = [...select.innerHTML.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(options.map(option => option[1]), [
    'Noviembre 2026 · 1 – 22 nov · mes en curso',
    'Noviembre 2026 · 1 – 15 nov · mes en curso',
    'Noviembre 2026 · 1 – 8 nov · mes en curso',
    'Octubre 2026 · 1 – 31 oct · mes completo',
  ]);
  // Sin elegir nada se abre en la semana mas reciente.
  assert.match(select.innerHTML, /value="2026-11@22" selected/);
  assert.match(host.innerHTML, /Periodo 1 – 22 nov/);

  // Al elegir una semana anterior, el reporte se rearma con los datos de ese corte.
  onChange({ target: { value: '2026-11@08' } });
  assert.match(host.innerHTML, /Periodo 1 – 8 nov/);
  assert.doesNotMatch(host.innerHTML, /NaN|undefined|No se pudieron cargar/);
  window.TLMReportWeek.printReport();
  assert.match(printedTitle, /Noviembre-2026_1-8$/);

  // El mes cerrado se descarga completo y su PDF no lleva el sufijo del periodo.
  onChange({ target: { value: '2026-10' } });
  assert.match(host.innerHTML, /Periodo 1 – 31 oct/);
  window.TLMReportWeek.printReport();
  assert.match(printedTitle, /Octubre-2026$/);
});

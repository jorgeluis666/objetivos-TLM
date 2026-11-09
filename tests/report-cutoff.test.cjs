const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('Report renders the November cutoff in selector, cover and PDF filename', async () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/tlm-report-2026.json'), 'utf8'));
  // Fix the UI fixture to the requested week; the production dataset advances each week.
  data.months = data.months.map((month, index) => index === 10 ? { ...month, lastDay: '2026-11-08', status: 'parcial' } : null);
  const host = { innerHTML: '', querySelectorAll: () => [] };
  const select = { innerHTML: '', addEventListener() {} };
  const button = { addEventListener() {} };
  const document = { title: 'TLM', getElementById: id => ({ 'week-report': host, 'week-select': select, 'week-print': button, 'week-reset': button }[id]) };
  let printedTitle;
  const window = { addEventListener() {}, removeEventListener() {}, print() { printedTitle = document.title; }, setTimeout() {} };
  const context = { window, document, console, Intl, Date, fetch: async url => {
    assert.match(url, /tlm-report-2026.json/);
    return { ok: true, json: async () => data };
  } };
  const code = fs.readFileSync(path.join(__dirname, '../js/report-week.js'), 'utf8')
    .replace('global.TLMReportWeek = { init };', 'global.TLMReportWeek = { init, printReport };');
  vm.runInNewContext(code, context);
  await window.TLMReportWeek.init();
  assert.match(select.innerHTML, /1 – 8 nov/);
  assert.match(host.innerHTML, /Periodo 1 – 8 nov/);
  assert.doesNotMatch(host.innerHTML, /NaN|undefined|No se pudieron cargar/);
  window.TLMReportWeek.printReport();
  assert.match(printedTitle, /Noviembre-2026_1-8$/);
});

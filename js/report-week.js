(function (global) {
  // Archivo de Reportes > Generar reporte. El reporte de Meta Ads de una semana de lunes a domingo frente a
  // la semana anterior, con las mismas laminas que el ultimo reporte subido a la carpeta de Drive: portada,
  // resumen ejecutivo, distribucion de la inversion, una lamina por grupo de campanas (Ventas, Mensajes,
  // Reconocimiento) con sus mejores anuncios, conclusiones y cierre.
  // Datos: data/tlm-ads-daily.json (scripts/build-ads-data.py), filas por dia, campana y anuncio de las
  // ultimas semanas. Los textos de analisis y conclusiones vienen propuestos con los numeros; el equipo los
  // edita y quedan guardados por semana en este navegador. El PDF sale del dialogo de impresion del navegador.
  // Expone window.TLMReportWeek = { init }.
  const DATA_URL = 'data/tlm-ads-daily.json';
  const WEEKS_IN_LIST = 12;
  const TOP_ADS = 3;
  const NOTES_KEY = 'tlm-week-notes-v1';
  const BRAND = 'The Little Market';
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const SEX = { female: 'Mujeres', male: 'Hombres', unknown: 'Sin dato' };
  // Los grupos de Gasto publicitario, cada uno con el resultado que mide (como en el reporte de la carpeta).
  const GROUPS = {
    Ventas: {
      key: 'Ventas', label: 'Ventas E-Commerce', short: 'E-Commerce (Ventas)', color: '#2a8276', field: 'purchases', one: 'compra', many: 'compras', unit: 'compras',
      kpis: [['spend', 'Inversion'], ['purchases', 'Compras'], ['roas', 'ROAS'], ['revenue', 'Valor conv.'], ['addToCart', 'Anadidos carrito']],
      summary: [['spend', 'Inversion'], ['purchases', 'Compras'], ['roas', 'ROAS'], ['revenue', 'Valor conv.'], ['reach', 'Alcance']],
      adCols: [['purchases', 'Compras'], ['addToCart', 'Carrito'], ['spend', 'Gasto']], topTitle: 'Top anuncios por ventas',
    },
    Mensajes: {
      key: 'Mensajes', label: 'Mensajes & Trafico al Perfil', short: 'Mensajes & Trafico', color: '#16a34a', field: 'conversations', one: 'mensaje', many: 'mensajes', unit: 'msg',
      kpis: [['spend', 'Inversion'], ['conversations', 'Mensajes'], ['cost', 'Costo/mensaje'], ['clicks', 'Clics'], ['reach', 'Alcance']],
      summary: [['spend', 'Inversion'], ['conversations', 'Mensajes'], ['cost', 'Costo/mensaje'], ['clicks', 'Clics'], ['reach', 'Alcance']],
      adCols: [['conversations', 'Mensajes'], ['clicks', 'Clics'], ['spend', 'Gasto']], topTitle: 'Top anuncios por mensajes',
    },
    Reconocimiento: {
      key: 'Reconocimiento', label: 'Reconocimiento', short: 'Reconocimiento', color: '#7c3aed', field: 'thruplays', one: 'reproduccion', many: 'reproducciones', unit: 'repr.',
      kpis: [['spend', 'Inversion'], ['thruplays', 'Reproducciones'], ['cost', 'Costo/repr.'], ['reach', 'Alcance'], ['clicks', 'Clics']],
      summary: [['spend', 'Inversion'], ['thruplays', 'Reproducciones'], ['cost', 'Costo/repr.'], ['reach', 'Alcance'], ['clicks', 'Clics']],
      adCols: [['thruplays', 'Reproduc.'], ['spend', 'Gasto']], topTitle: 'Top anuncios por reproducciones',
    },
  };
  const ORDER = ['Ventas', 'Mensajes', 'Reconocimiento'];
  const OTHER = { key: 'Otros', label: 'Otras campanas', short: 'Otras campanas', color: '#64748b', field: 'clicks', one: 'clic', many: 'clics', unit: 'clics', kpis: [], summary: [], adCols: [['clicks', 'Clics'], ['spend', 'Gasto']], topTitle: 'Top anuncios' };
  const FIELDS = ['spend', 'impressions', 'reach', 'clicks', 'landingViews', 'addToCart', 'checkouts', 'purchases', 'revenue', 'conversations', 'thruplays', 'profileVisits'];

  let data = null;
  let loading = null;
  let selected = '';
  let charts = [];
  let wired = false;

  // ── Formato (el del tablero: "S/" y es-PE) ──
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const safeUrl = value => /^https:\/\/(www\.)?facebook\.com\//i.test(String(value || '')) ? String(value) : '';
  const isNum = value => value != null && Number.isFinite(value);
  const money = (value, digits = 2) => isNum(value) ? `S/ ${value.toLocaleString('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits })}` : '-';
  const count = value => isNum(value) ? Math.round(value).toLocaleString('es-PE') : '-';
  const unitCost = value => isNum(value) ? money(value, value < 0.1 ? 3 : 2) : '-';
  const roasFmt = value => isNum(value) ? `${value.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x` : '-';
  const pct = value => isNum(value) ? `${value.toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '-';
  const ratio = (value, base) => base > 0 ? value / base : null;
  const plural = (value, group) => Math.round(value) === 1 ? group.one : group.many;

  // ── Fechas (los dias del informe estan en hora de Lima) ──
  const todayIso = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const shift = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const mondayOf = day => shift(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
  const dayLabel = day => `${Number(day.slice(8, 10))} ${SHORT[Number(day.slice(5, 7)) - 1]}`;
  // "12 - 18 oct 2026"; si cruza de mes, "28 sep - 4 oct 2026".
  function rangeLabel(monday, year = true) {
    const sunday = shift(monday, 6);
    const start = monday.slice(5, 7) === sunday.slice(5, 7) ? String(Number(monday.slice(8, 10))) : dayLabel(monday);
    return `${start} - ${dayLabel(sunday)}${year ? ` ${sunday.slice(0, 4)}` : ''}`;
  }
  // "12-18 de octubre, 2026", como la portada del reporte de la carpeta.
  function longRange(monday) {
    const sunday = shift(monday, 6);
    const month = date => MONTHS[Number(date.slice(5, 7)) - 1];
    const start = monday.slice(5, 7) === sunday.slice(5, 7) ? String(Number(monday.slice(8, 10))) : `${Number(monday.slice(8, 10))} de ${month(monday)}`;
    return `${start} - ${Number(sunday.slice(8, 10))} de ${month(sunday)}, ${sunday.slice(0, 4)}`;
  }
  // Nombre del PDF con la convencion de la carpeta: The-Little-Market-Reporte-Ads-Semanal-12-18-Octubre-2026.
  function fileName(monday) {
    const sunday = shift(monday, 6);
    const month = date => { const name = MONTHS[Number(date.slice(5, 7)) - 1]; return name.charAt(0).toUpperCase() + name.slice(1); };
    const start = monday.slice(5, 7) === sunday.slice(5, 7) ? `${Number(monday.slice(8, 10))}` : `${Number(monday.slice(8, 10))}-${month(monday)}`;
    return `The-Little-Market-Reporte-Ads-Semanal-${start}-${Number(sunday.slice(8, 10))}-${month(sunday)}-${sunday.slice(0, 4)}`;
  }

  // ── Datos ──
  async function load() {
    if (data) return data;
    if (!loading) {
      loading = fetch(`${DATA_URL}?cb=${Date.now()}`, { cache: 'no-store' })
        .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
        .then(json => { data = expand(json); return data; })
        .finally(() => { loading = null; });
    }
    return loading;
  }
  // Las filas llegan con indices: se convierten en objetos con el dia, la campana, el grupo y el anuncio.
  function expand(json) {
    const at = Object.fromEntries((json.columns || []).map((name, index) => [name, index]));
    const rows = (json.rows || []).map(row => {
      const campaign = json.campaigns[row[at.campaign]] || {};
      const ad = json.ads[row[at.ad]] || {};
      const item = { day: shift(json.firstDay, row[at.d]), campaign: campaign.name || '', group: campaign.group || 'Otros', ad: ad.name || '(sin nombre)', url: safeUrl(ad.url) };
      FIELDS.forEach(field => { item[field] = Number(row[at[field]]) || 0; });
      return item;
    });
    const seg = json.segments || {};
    const sat = Object.fromEntries((seg.columns || []).map((name, index) => [name, index]));
    const segments = (seg.rows || []).map(row => ({
      day: shift(json.firstDay, row[sat.d]), group: seg.groups[row[sat.group]], age: seg.ages[row[sat.age]], sex: seg.sexes[row[sat.sex]],
      spend: Number(row[sat.spend]) || 0, purchases: Number(row[sat.purchases]) || 0, revenue: Number(row[sat.revenue]) || 0,
      conversations: Number(row[sat.conversations]) || 0, thruplays: Number(row[sat.thruplays]) || 0,
    }));
    return { rows, segments, lastDay: json.lastDay, syncedAt: json.syncedAt };
  }

  const activity = row => row.spend > 0 || row.impressions > 0;
  const inWeek = (rows, monday) => rows.filter(row => row.day >= monday && row.day <= shift(monday, 6));
  // Semanas de lunes a domingo ya cerradas y con entregas, de la mas reciente a la mas antigua.
  function weeks(rows) {
    const current = mondayOf(todayIso());
    const mondays = new Set(rows.filter(activity).map(row => mondayOf(row.day)).filter(monday => monday < current));
    // La primera semana del archivo puede venir incompleta: solo se lista si tiene su semana anterior para comparar.
    const first = rows.length ? rows.reduce((min, row) => row.day < min ? row.day : min, rows[0].day) : '';
    return [...mondays].filter(monday => monday >= first).sort().reverse().slice(0, WEEKS_IN_LIST);
  }

  function sums(rows, group) {
    const total = Object.fromEntries(FIELDS.map(field => [field, 0]));
    rows.forEach(row => FIELDS.forEach(field => { total[field] += row[field]; }));
    total.results = group ? total[group.field] : 0;
    total.cost = group && total.results > 0 ? total.spend / total.results : null;
    total.roas = total.spend > 0 && total.revenue > 0 ? total.revenue / total.spend : (total.spend > 0 && group?.key === 'Ventas' ? 0 : null);
    total.cpc = ratio(total.spend, total.clicks);
    return total;
  }
  function topAds(rows, group) {
    const ads = new Map();
    rows.forEach(row => {
      const ad = ads.get(row.ad) || { name: row.ad, url: row.url, rows: [] };
      if (!ad.url && row.url) ad.url = row.url;
      ad.rows.push(row);
      ads.set(row.ad, ad);
    });
    return [...ads.values()].map(ad => ({ ...ad, ...sums(ad.rows, group) }))
      .filter(ad => ad.spend > 0)
      .sort((a, b) => b.results - a.results || (group.key === 'Ventas' ? b.addToCart - a.addToCart : 0) || b.spend - a.spend)
      .slice(0, TOP_ADS);
  }
  // El rango de edad y sexo con mas resultados (o mas inversion) en unas filas de segmentacion.
  function topSegment(rows, field) {
    const map = new Map();
    rows.forEach(row => {
      if (row.age === 'Unknown' || row.sex === 'unknown') return;
      const key = `${row.sex}|${row.age}`;
      const item = map.get(key) || { sex: row.sex, age: row.age, value: 0, spend: 0 };
      item.value += row[field];
      item.spend += row.spend;
      map.set(key, item);
    });
    const best = [...map.values()].filter(item => item.value > 0).sort((a, b) => b.value - a.value || b.spend - a.spend)[0];
    return best ? { label: `${SEX[best.sex] || best.sex} ${best.age}`, value: best.value } : null;
  }

  function buildReport(monday) {
    const prevMonday = shift(monday, -7);
    const week = inWeek(data.rows, monday);
    const prev = inWeek(data.rows, prevMonday);
    const segWeek = inWeek(data.segments, monday);
    const keys = [...ORDER, ...new Set(week.concat(prev).map(row => row.group).filter(key => !ORDER.includes(key)))];
    const groups = keys.map(key => {
      const group = GROUPS[key] || { ...OTHER, key, label: key, short: key };
      const now = week.filter(row => row.group === key), before = prev.filter(row => row.group === key);
      if (!now.some(activity) && !before.some(activity)) return null;
      return { group, now: sums(now, group), before: sums(before, group), ads: topAds(now, group), active: now.some(activity) };
    }).filter(Boolean);
    const total = sums(week), totalBefore = sums(prev);
    const segGroup = key => segWeek.filter(row => row.group === key);
    return {
      monday, prevMonday, groups, total, totalBefore,
      segments: {
        messages: topSegment(segGroup('Mensajes'), 'conversations'),
        buyers: topSegment(segWeek, 'purchases'),
        spend: topSegment(segWeek, 'spend'),
        thruplays: topSegment(segGroup('Reconocimiento'), 'thruplays'),
      },
      missing: Array.from({ length: 7 }, (_, i) => shift(monday, i)).filter(day => day > data.lastDay),
    };
  }

  // ── Textos propuestos (lo que se puede afirmar con los numeros; el porque lo escribe el equipo) ──
  function change(now, before) {
    if (!before) return null;
    return (now / before - 1) * 100;
  }
  function trend(now, before, group) {
    const value = change(now, before);
    if (value == null) return now ? `${count(now)} ${plural(now, group)} (sin ${group.many} la semana anterior)` : `sin ${group.many}`;
    if (Math.abs(value) < 0.5) return `${count(now)} ${plural(now, group)}, igual que la semana anterior`;
    return `${count(now)} ${plural(now, group)}, ${value > 0 ? 'sube' : 'baja'} ${Math.abs(Math.round(value))}% frente a la semana anterior (${count(before)})`;
  }
  function highlight(x) {
    const { group, now, ads } = x;
    const best = ads[0];
    if (!x.active) return `Sin entrega esta semana.`;
    if (!best || !best.results) return `${count(now.results)} ${plural(now.results, group)} con ${money(now.spend)} de inversion.`;
    const share = now.results > 0 ? Math.round(best.results / now.results * 100) : 0;
    const extra = group.key === 'Ventas' && best.roas ? ` (ROAS ${roasFmt(best.roas)})` : group.key !== 'Ventas' && best.cost != null ? ` a ${unitCost(best.cost)} por ${group.one}` : '';
    return `"${best.name}" concentro ${count(best.results)} de ${count(now.results)} ${group.many} (${share}%)${extra}.`;
  }
  function analysis(x) {
    const { group, now, before } = x;
    if (!x.active) return 'El grupo no tuvo entrega esta semana.';
    const parts = [`${group.label}: ${trend(now.results, before.results, group)}, con ${money(now.spend)} de inversion`];
    if (now.cost != null) parts.push(`costo por ${group.one} ${unitCost(now.cost)}${before.cost != null ? ` (antes ${unitCost(before.cost)})` : ''}`);
    if (group.key === 'Ventas') {
      if (now.revenue > 0) parts.push(`ROAS ${roasFmt(now.roas)}`);
      if (now.addToCart > now.purchases * 5 && now.addToCart > 0) parts.push(`${count(now.addToCart)} anadidos al carrito frente a ${count(now.purchases)} ${plural(now.purchases, group)}: hay interes de compra que todavia no se cierra`);
    }
    return `${parts.join(', ')}.`;
  }
  function suggested(r) {
    const notes = { estrategia: '', distribucion: '', c1: '', c2: '', c3: '' };
    const active = r.groups.filter(x => x.active);
    const top = [...active].sort((a, b) => b.now.spend - a.now.spend)[0];
    const segs = [r.segments.messages && `las conversaciones vienen sobre todo de ${r.segments.messages.label}`, r.segments.buyers && `las compras se concentran en ${r.segments.buyers.label}`].filter(Boolean);
    notes.estrategia = `Semana ${rangeLabel(r.monday)}: ${money(r.total.spend)} de inversion en Meta Ads repartidos en ${active.map(x => x.group.short.toLowerCase()).join(', ') || 'ningun grupo'}.${segs.length ? ` En el publico, ${segs.join(' y ')}.` : ''}`;
    notes.distribucion = top ? `${top.group.short} se llevo la mayor parte de la inversion (${pct(top.now.spend / r.total.spend * 100)}). ${active.map(x => `${x.group.short}: ${trend(x.now.results, x.before.results, x.group)}`).join('. ')}.` : '';
    active.slice(0, 3).forEach((x, i) => {
      const best = x.ads[0];
      notes[`c${i + 1}`] = best && best.results
        ? `${x.group.label}: "${best.name}" lidero con ${count(best.results)} ${plural(best.results, x.group)}${x.group.key === 'Ventas' && best.roas ? ` (ROAS ${roasFmt(best.roas)})` : ''}. ${x.now.results >= x.before.results ? 'Mantener esta linea creativa la proxima semana.' : `El grupo bajo frente a la semana anterior (${count(x.before.results)}): mantener la pieza que mejor rinde y probar variantes.`}`
        : `${x.group.label}: sin ${x.group.many} con ${money(x.now.spend)} de inversion${x.group.key === 'Ventas' && x.now.addToCart ? ` y ${count(x.now.addToCart)} anadidos al carrito` : ''}. ${x.group.key === 'Ventas' ? 'Revisar ofertas, anuncios y el paso de pago.' : 'Revisar los anuncios del grupo.'}`;
    });
    active.forEach(x => { notes[`analisis-${x.group.key}`] = analysis(x); });
    return notes;
  }
  const NOTE_TITLES = { c1: 'Conclusion 1', c2: 'Conclusion 2', c3: 'Conclusion 3' };

  function readNotes() {
    try {
      const saved = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch { return {}; }
  }
  function saveNote(monday, key, value) {
    const notes = readNotes();
    notes[monday] = { ...(notes[monday] || {}), [key]: value };
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* sin storage dura hasta recargar */ }
  }
  function resetNotes(monday) {
    const notes = readNotes();
    delete notes[monday];
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* sin storage */ }
  }
  // Texto editable en pantalla; al imprimir se muestra la copia en texto (un textarea no crece en el PDF).
  function editable(key, value, rows = 3) {
    return `<div class="week-edit"><textarea data-week-note="${esc(key)}" rows="${rows}" aria-label="Texto editable del reporte">${esc(value)}</textarea><div class="week-print-text" data-print-for="${esc(key)}">${esc(value)}</div></div>`;
  }

  // ── Pintado ──
  function metricValue(stats, key) {
    if (key === 'spend' || key === 'revenue') return money(stats[key]);
    if (key === 'cost') return unitCost(stats.cost);
    if (key === 'roas') return roasFmt(stats.roas);
    return count(stats[key]);
  }
  // "+12% vs S/ 300" frente a la semana anterior. En la inversion no hay mejor ni peor: va en gris.
  function deltaPill(now, before, key) {
    const a = now[key], b = before[key];
    if (isNum(b) && b === 0) return `<small class="week-delta flat">${a ? 'sem. anterior: 0' : 'igual que la sem. anterior'}</small>`;
    if (!isNum(a) || !isNum(b)) return '<small class="week-delta flat">sin semana anterior</small>';
    const value = (a / b - 1) * 100;
    const better = key === 'cost' ? value <= 0 : key === 'spend' ? null : value >= 0;
    const tone = Math.abs(value) < 0.5 || better == null ? 'flat' : better ? 'up' : 'down';
    return `<small class="week-delta ${tone}">${value >= 0 ? '+' : '-'}${Math.abs(Math.round(value))}% vs ${metricValue(before, key)}</small>`;
  }
  function kpiRow(x, list) {
    return `<div class="week-kpis">${list.map(([key, label]) => `<div class="week-kpi"><strong>${metricValue(x.now, key)}</strong><span>${esc(label)}</span>${deltaPill(x.now, x.before, key)}</div>`).join('')}</div>`;
  }
  const slideHead = (title, sub, color) => `<div class="week-slide-head"${color ? ` style="--gc:${color}"` : ''}><div class="week-slide-title"><span>${esc(BRAND)}</span> | ${esc(title)}</div>${sub ? `<div class="week-slide-sub">${esc(sub)}</div>` : ''}</div>`;
  const slideFoot = r => `<div class="week-slide-foot"><span>LIMA RETAIL | DATA DRIVEN MARKETING | POWER KPI | DIGITAL ANALYTICS</span><span>Reporte Ads - ${esc(BRAND)}: ${esc(rangeLabel(r.monday))}</span></div>`;
  function adsTable(x) {
    const { group, ads } = x;
    if (!ads.length) return '<div class="week-empty">Sin anuncios con inversion esta semana.</div>';
    return `<table class="data-table week-table"><thead><tr><th>Anuncio</th>${group.adCols.map(([, label]) => `<th class="num">${esc(label)}</th>`).join('')}<th>Vista</th></tr></thead><tbody>${ads.map(ad => `
      <tr><td class="week-ad-name">${esc(ad.name)}</td>${group.adCols.map(([key]) => `<td class="num">${key === 'spend' ? money(ad.spend) : count(ad[key])}</td>`).join('')}<td>${ad.url ? `<a href="${esc(ad.url)}" target="_blank" rel="noopener">Ver &raquo;</a>` : '-'}</td></tr>`).join('')}</tbody></table>`;
  }
  function sideTable(x, r) {
    const { group, now } = x;
    if (group.key === 'Ventas') {
      const stages = [['Clics al enlace', now.clicks], ['Visitas a la web', now.landingViews], ['Anadidos al carrito', now.addToCart], ['Pagos iniciados', now.checkouts], ['Compras', now.purchases]];
      return `<div class="week-sub-title">Embudo E-Commerce</div><table class="data-table week-table"><thead><tr><th>Etapa</th><th class="num">Cantidad</th></tr></thead><tbody>${stages.map(([label, value]) => `<tr><td>${label}</td><td class="num">${count(value)}</td></tr>`).join('')}</tbody></table>`;
    }
    if (group.key === 'Mensajes') {
      const rows = [['Mas mensajes', r.segments.messages], ['Compradoras', r.segments.buyers], ['Mayor inversion', r.segments.spend]].filter(([, seg]) => seg);
      return `<div class="week-sub-title">Segmentacion</div><table class="data-table week-table"><thead><tr><th>Dato</th><th>Detalle</th></tr></thead><tbody>${rows.length ? rows.map(([label, seg]) => `<tr><td>${label}</td><td>${esc(seg.label)}</td></tr>`).join('') : '<tr><td colspan="2" class="table-empty">Sin datos de edad y sexo</td></tr>'}</tbody></table>`;
    }
    if (group.key === 'Reconocimiento') {
      const rows = [['Impresiones', count(now.impressions)], ['Alcance (suma diaria)', count(now.reach)], ['Mas reproducciones', r.segments.thruplays ? esc(r.segments.thruplays.label) : '-'], ['Costo por clic', unitCost(now.cpc)]];
      return `<div class="week-sub-title">Alcance de marca</div><table class="data-table week-table"><thead><tr><th>Dato</th><th class="num">Detalle</th></tr></thead><tbody>${rows.map(([label, value]) => `<tr><td>${label}</td><td class="num">${value}</td></tr>`).join('')}</tbody></table>`;
    }
    return '';
  }
  function groupSlide(x, r, notes) {
    const { group } = x;
    return `
      <section class="week-slide" style="--gc:${group.color}">
        ${slideHead(group.label, highlightTitle(x))}
        ${group.kpis.length ? kpiRow(x, group.kpis) : ''}
        <div class="week-cols">
          <div><div class="week-sub-title">${esc(group.topTitle)}</div>${adsTable(x)}</div>
          <div>${sideTable(x, r)}</div>
        </div>
        <div class="week-callout"><b>Destacado:</b> ${esc(highlight(x))}</div>
        <div class="week-analysis"><div class="week-sub-title">Analisis</div>${editable(`analisis-${group.key}`, notes[`analisis-${group.key}`] ?? '')}</div>
        ${slideFoot(r)}
      </section>`;
  }
  function highlightTitle(x) {
    if (!x.active) return 'Sin entrega esta semana';
    const best = x.ads[0];
    return best && best.results ? `"${best.name}" es el anuncio que mas ${x.group.many} trajo` : `${count(x.now.results)} ${plural(x.now.results, x.group)} en la semana`;
  }

  function render() {
    const host = document.getElementById('week-report');
    const select = document.getElementById('week-select');
    if (!host || !data) return;
    const list = weeks(data.rows);
    if (!list.length) {
      if (select) select.innerHTML = '<option value="">Sin semanas cerradas</option>';
      host.innerHTML = '<div class="panel"><div class="week-empty">Todavia no hay una semana cerrada de lunes a domingo con entregas en Meta Ads.</div></div>';
      return;
    }
    if (!list.includes(selected)) selected = list[0];
    if (select) select.innerHTML = list.map((monday, i) => `<option value="${monday}"${monday === selected ? ' selected' : ''}>${esc(rangeLabel(monday))}${i === 0 ? ' | ultima semana cerrada' : ''}</option>`).join('');

    const r = buildReport(selected);
    const saved = readNotes()[selected] || {};
    const notes = { ...suggested(r), ...saved };
    const active = r.groups.filter(x => x.active);
    charts.forEach(chart => chart.destroy());
    charts = [];

    host.innerHTML = `
      ${r.missing.length ? `<div class="data-notice warn week-warn">La descarga de Meta llega hasta el ${esc(dayLabel(data.lastDay))}: faltan ${esc(r.missing.map(dayLabel).join(', '))}, asi que los totales pueden subir. Sincroniza con Drive cuando el equipo suba la descarga completa.</div>` : ''}
      <div class="week-doc" id="week-doc">
        <section class="week-slide week-cover">
          <div class="week-cover-mark">M</div>
          <div class="week-cover-title">Reporte Ads</div>
          <div class="week-cover-period">Semana ${esc(rangeLabel(r.monday))}</div>
          <div class="week-cover-meta"><span>Cliente: ${esc(BRAND)}</span><span>Periodo: ${esc(longRange(r.monday))}</span><span>Comparado con: ${esc(rangeLabel(r.prevMonday))}</span></div>
          <div class="week-cover-foot">LIMA RETAIL | DATA DRIVEN MARKETING<br>POWER KPI | DIGITAL ANALYTICS</div>
        </section>

        <section class="week-slide">
          ${slideHead('Resumen Ejecutivo', `${rangeLabel(r.monday)} | Inversion total: ${money(r.total.spend)} | Meta Ads: ${active.map(x => x.group.key).join(' - ') || 'sin entrega'}`)}
          <div class="week-summary">${r.groups.filter(x => GROUPS[x.group.key]).map(x => `
            <div class="week-summary-row" style="--gc:${x.group.color}">
              <div class="week-summary-name">${esc(x.group.label)}${x.active ? '' : ' <small>(sin entrega esta semana)</small>'}</div>
              ${kpiRow(x, x.group.summary)}
            </div>`).join('')}
          </div>
          <div class="week-analysis"><div class="week-sub-title">Estrategia</div>${editable('estrategia', notes.estrategia, 2)}</div>
          ${slideFoot(r)}
        </section>

        <section class="week-slide">
          ${slideHead('Distribucion de Inversion', 'Como se repartio la inversion entre los objetivos')}
          <div class="week-cols">
            <div class="week-donut"><canvas id="week-donut" role="img" aria-label="Distribucion de la inversion por objetivo"></canvas></div>
            <div>
              <div class="week-sub-title">Resumen por objetivo</div>
              <table class="data-table week-table"><thead><tr><th>Objetivo</th><th class="num">Gasto</th><th class="num">%</th><th class="num">Result.</th><th class="num">Sem. anterior</th></tr></thead><tbody>
                ${r.groups.map(x => `<tr><td><i class="week-dot" style="background:${x.group.color}"></i>${esc(x.group.short)}</td><td class="num">${money(x.now.spend)}</td><td class="num">${pct(ratio(x.now.spend, r.total.spend) * 100)}</td><td class="num">${count(x.now.results)} ${esc(x.group.unit)}</td><td class="num">${money(x.before.spend)}</td></tr>`).join('')}
                <tr class="week-total"><td>Total</td><td class="num">${money(r.total.spend)}</td><td class="num">100%</td><td class="num">${count(r.total.clicks)} clics</td><td class="num">${money(r.totalBefore.spend)}</td></tr>
              </tbody></table>
            </div>
          </div>
          <div class="week-analysis"><div class="week-sub-title">Analisis</div>${editable('distribucion', notes.distribucion)}</div>
          ${slideFoot(r)}
        </section>

        ${r.groups.map(x => groupSlide(x, r, notes)).join('')}

        <section class="week-slide">
          ${slideHead('Conclusiones y Recomendaciones', '')}
          <div class="week-conclusions">${['c1', 'c2', 'c3'].map((key, i) => `
            <div class="week-conclusion"><b>${['&#9733;', '&#9670;', '&#8593;'][i]}</b><div class="week-sub-title">${NOTE_TITLES[key]}</div>${editable(key, notes[key], 5)}</div>`).join('')}
          </div>
          ${slideFoot(r)}
        </section>

        <section class="week-slide week-cover week-closing">
          <div class="week-cover-title">LIMA RETAIL</div>
          <div class="week-cover-period">DATA DRIVEN MARKETING</div>
        </section>
      </div>`;

    renderDonut(r);
    host.querySelectorAll('[data-week-note]').forEach(field => {
      field.addEventListener('input', () => {
        saveNote(r.monday, field.dataset.weekNote, field.value);
        const copy = host.querySelector(`[data-print-for="${CSS.escape(field.dataset.weekNote)}"]`);
        if (copy) copy.textContent = field.value;
      });
    });
  }

  function renderDonut(r) {
    const canvas = document.getElementById('week-donut');
    if (!canvas || typeof global.Chart !== 'function') return;
    const groups = r.groups.filter(x => x.now.spend > 0);
    charts.push(new global.Chart(canvas, {
      type: 'doughnut',
      data: { labels: groups.map(x => x.group.short), datasets: [{ data: groups.map(x => Math.round(x.now.spend * 100) / 100), backgroundColor: groups.map(x => x.group.color), borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, cutout: '58%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, generateLabels: chart => chart.data.labels.map((label, i) => ({ text: `${label} ${pct(chart.data.datasets[0].data[i] / r.total.spend * 100)}`, fillStyle: chart.data.datasets[0].backgroundColor[i], strokeStyle: '#fff', index: i })) } },
          tooltip: { callbacks: { label: context => ` ${context.label}: ${money(context.raw)}` } },
        },
      },
    }));
  }

  // El nombre del PDF lo pone el navegador con el titulo del documento: se cambia solo mientras imprime.
  function printReport() {
    if (!selected) return;
    const title = document.title;
    document.title = fileName(selected);
    document.body.classList.add('printing-week');
    const restore = () => { document.title = title; document.body.classList.remove('printing-week'); global.removeEventListener('afterprint', restore); };
    global.addEventListener('afterprint', restore);
    charts.forEach(chart => chart.resize());
    global.print();
    setTimeout(restore, 2000);
  }

  async function renderModel() {
    const host = document.getElementById('week-model');
    if (!host) return;
    const model = await global.ReportsArchive?.latestReport?.();
    host.innerHTML = model
      ? `Modelo: <a href="${esc(model.viewUrl)}" target="_blank" rel="noopener">${esc(model.title)}</a> (ultimo reporte subido a la carpeta)`
      : 'Modelo: el ultimo reporte de la carpeta de reportes de Drive';
  }

  async function init() {
    const host = document.getElementById('week-report');
    if (!wired) {
      wired = true;
      document.getElementById('week-select')?.addEventListener('change', event => { selected = event.target.value; render(); });
      document.getElementById('week-print')?.addEventListener('click', printReport);
      document.getElementById('week-reset')?.addEventListener('click', () => {
        if (selected && global.confirm('Se descartan los textos editados de esta semana y vuelven los propuestos. Continuar?')) { resetNotes(selected); render(); }
      });
      // Una sincronizacion con Drive trae datos nuevos: se vuelven a leer al abrir otra vez el generador.
      global.addEventListener('tlm:data-updated', () => { data = null; });
    }
    renderModel();
    if (data) { render(); return; }
    if (host) host.innerHTML = '<div class="panel"><div class="week-empty">Cargando los datos por dia...</div></div>';
    try {
      await load();
      render();
    } catch (error) {
      if (host) host.innerHTML = `<div class="panel"><div class="week-empty">No se pudieron cargar los datos por dia (${esc(error.message)}).</div></div>`;
    }
  }

  global.TLMReportWeek = { init };
})(window);

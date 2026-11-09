(function (global) {
  // Archivo de Reportes > Generación de Reporte: el PDF mensual de publicidad con el formato estandar de la
  // agencia ("Modelo Reporte TLM"), el mismo de todas las marcas: laminas 16:9 de 1280x720 con tarjetas
  // blancas de borde fino y acentos en azul. Portada, contenido, resumen ejecutivo, distribucion de la
  // inversion, una lamina por objetivo (ventas, mensajes de WhatsApp, mensajes a tienda y reconocimiento),
  // conclusiones con proximos pasos y cierre.
  //
  // No trae datos nuevos: sale de data/tlm-ads-2026.json (scripts/build-ads-data.py), el mismo barrido de
  // Meta Ads que alimenta el resto del tablero, con una fila por anuncio del mes y su conjunto. El reporte
  // es mensual, como el modelo: se elige el mes arriba y el periodo va del dia 1 al ultimo dia con datos.
  //
  // Las dos campañas de mensajes van en laminas distintas porque no son lo mismo: el conjunto de WhatsApp
  // general apunta a publico amplio y el de tienda solo al radio de 3 km alrededor del local, asi que sus
  // costos por conversacion no son comparables entre si.
  //
  // La bajada de cada lamina, el destacado, el analisis, las conclusiones y los proximos pasos vienen
  // propuestos con lo que dicen los numeros; el equipo los reescribe sobre la misma lamina (clic en el
  // texto, **negrita** con asteriscos) y quedan guardados por mes en este navegador. El PDF sale del
  // dialogo de impresion del navegador.
  //
  // Expone window.TLMReportWeek = { init }.
  const DATA_URL = 'data/tlm-ads-2026.json';
  const NOTES_KEY = 'tlm-report-notes-v2';
  const BRAND = 'The Little Market';
  const SLUG = 'The-Little-Market';
  const CHANNEL = 'Meta Ads';
  const LOGO = 'assets/logo-lima-retail.png';
  const AGENCY_LINE = 'Lima Retail · Data Driven Marketing · Power KPI · Digital Analytics';
  const PAGE_WIDTH = 1280;
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  // Un color por objetivo, en el orden del modelo: el mismo en la dona, en la tabla y en las barras.
  const BLUE = '#2563eb';
  const TEAL = '#14b8a6';
  const AMBER = '#f59e0b';
  const SLATE = '#94a3b8';
  // Mejores anuncios de cada lamina. Si una sola pieza concentra esto de los resultados, va sola y al lado
  // se resume el resto: es lo que hace el modelo cuando una linea creativa se lleva casi todo.
  const TOP_ADS = 2;
  const DOMINANT = 0.6;
  const METRICS = ['spend', 'impressions', 'reach', 'clicks', 'landingViews', 'addToCart', 'checkouts',
    'purchases', 'revenue', 'conversations', 'profileVisits', 'thruplays', 'results'];

  // Iconos de linea (24x24) del contenido, las tarjetas y las conclusiones.
  const ICONS = {
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h2.2l2.3 11.4a2 2 0 0 0 2 1.6h8.1a2 2 0 0 0 2-1.6L21 7H5.2"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
    store: '<path d="M4 9.5V20h16V9.5"/><path d="M3 4h18l1 5.5a3 3 0 0 1-5.5 1.8 3 3 0 0 1-5 0 3 3 0 0 1-5 0A3 3 0 0 1 2 9.5z"/><path d="M9.5 20v-5h5v5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    flag: '<path d="M4 22V4"/><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1"/>',
    chart: '<path d="M3 3v18h18"/><path d="M8 17v-5"/><path d="M13 17V8"/><path d="M18 17v-3"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    pin: '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 5.3a3.4 3.4 0 0 1 0 6.6"/><path d="M18.5 14.4a6.5 6.5 0 0 1 3 5.6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.chart}</svg>`;

  let data = null;
  let loading = null;
  let selected = '';
  let wired = false;
  let resizeObserver = null;

  // ── Formato (el del modelo: "S/ 1,121", "33.6 mil", es-PE) ─────────────
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const safeUrl = value => (/^https:\/\/(www\.)?facebook\.com\//i.test(String(value || '')) ? String(value) : '');
  const finite = value => value != null && Number.isFinite(Number(value));
  const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
  const decimalFormats = new Map();
  const decimals = (value, digits) => {
    if (!decimalFormats.has(digits)) decimalFormats.set(digits, new Intl.NumberFormat('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    return decimalFormats.get(digits).format(Number(value));
  };
  const num = value => (finite(value) ? integer.format(Math.round(value)) : '—');
  const money = value => (finite(value) ? `S/ ${integer.format(Math.round(value))}` : '—');
  const money2 = value => (finite(value) ? `S/ ${decimals(value, 2)}` : '—');
  const cost = value => (finite(value) && value > 0 ? `S/ ${decimals(value, 2)}` : '—');
  const ratio2 = value => (finite(value) ? decimals(value, 2) : '—');
  const pct = value => (finite(value) ? `${Math.round(value)}%` : '—');
  // "33.6k" para tablas y barras; "33.6 mil" para la cifra grande de una tarjeta, como el modelo.
  const compact = value => (!finite(value) ? '—' : value >= 1e6 ? `${decimals(value / 1e6, 1)}M` : value >= 1000 ? `${decimals(value / 1000, 1)}k` : integer.format(Math.round(value)));
  const thousands = value => (!finite(value) ? '—' : value >= 1000 ? `${decimals(value / 1000, 1)} mil` : integer.format(Math.round(value)));
  const pageNumber = value => String(value).padStart(2, '0');
  const divide = (value, base) => (base > 0 ? value / base : null);
  const cap = value => String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
  const listOf = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items[0] || '');
  // **texto** va en negrita, como "Qué pasó:" en el modelo.
  const rich = text => esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Los dias del informe estan en hora de Lima.
  const todayIso = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const issuedLabel = () => {
    const [year, month, day] = todayIso().split('-');
    return `${Number(day)} ${SHORT[Number(month) - 1]}. ${year}`;
  };

  // ── Datos ──────────────────────────────────────────────────────────────
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

  // Las filas de anuncio llegan en columnas (pesan la mitad): aqui vuelven a ser objetos.
  function expand(json) {
    const at = Object.fromEntries((json.adColumns || []).map((name, index) => [name, index]));
    const months = (json.months || []).map((month, index) => {
      if (!month || !month.kpis) return null;
      const ads = (month.ads || []).map(row => {
        const ad = { name: String(row[at.name] || '(sin nombre)'), campaign: String(row[at.campaign] || ''), adSet: String(row[at.adSet] || ''), group: String(row[at.group] || 'Otros'), resultType: String(row[at.resultType] || ''), url: safeUrl(row[at.url]) };
        METRICS.forEach(field => { ad[field] = Number(row[at[field]]) || 0; });
        return ad;
      });
      if (!ads.some(ad => ad.spend > 0 || ad.impressions > 0)) return null;
      return {
        id: `${json.year}-${String(index + 1).padStart(2, '0')}`,
        index,
        name: month.name,
        year: json.year,
        firstDay: month.firstDay,
        lastDay: month.lastDay,
        closed: month.status === 'cerrado',
        kpis: month.kpis,
        // Lo que ese mes no trajo la exportacion de Drive: la API de Meta manda la inversion y los
        // resultados, pero no el embudo, el desglose por edad y sexo ni el enlace de vista previa.
        missing: (month.nexus && month.nexus.missing) || [],
        campaigns: month.campaigns || [],
        ads,
      };
    }).filter(Boolean);
    return { months: months.reverse(), syncedAt: json.syncedAt, cutoff: json.cutoff };
  }

  // ── Objetivos y laminas ────────────────────────────────────────────────
  // Los tres objetivos del barrido, como los lee el cliente en el resumen y en la distribucion.
  const GROUPS = {
    Mensajes: { key: 'Mensajes', label: 'Mensajes por WhatsApp', short: 'Mensajes WhatsApp', lower: 'mensajes por WhatsApp', campaign: 'Mensajes por WhatsApp', metric: 'conversations', unit: 'conv.', plural: 'conversaciones', color: BLUE, role: 'captación de contacto' },
    Ventas: { key: 'Ventas', label: 'Ventas e-commerce', short: 'Ventas e-commerce', lower: 'ventas e-commerce', campaign: 'E-Commerce · Ventas', metric: 'purchases', unit: 'compras', plural: 'compras', color: TEAL, role: 'cierre de venta' },
    Reconocimiento: { key: 'Reconocimiento', label: 'Reconocimiento', short: 'Reconocimiento', lower: 'reconocimiento', campaign: 'Reconocimiento', metric: 'reach', unit: 'alcance', plural: 'personas alcanzadas', color: AMBER, role: 'alcance de marca' },
  };
  const GROUP_ORDER = ['Mensajes', 'Ventas', 'Reconocimiento'];
  const otherGroup = key => ({ key, label: key, short: key, lower: key.toLowerCase(), campaign: key, metric: 'results', unit: 'result.', plural: 'resultados', color: SLATE, role: 'otros objetivos' });

  // Un conjunto de anuncios con segmentacion local: el radio de 3 km alrededor de la tienda.
  const isLocal = adSet => /tienda|local|barrio|\b3\s*km\b/i.test(String(adSet || ''));

  // Las laminas de detalle, en el orden del modelo. "Mensajes" se parte en dos porque el publico amplio y
  // el radio de 3 km no son comparables; si un mes no tuvo campaña local, esa lamina no se dibuja.
  const SECTIONS = [
    {
      key: 'ventas', icon: 'cart', title: 'Ventas e-commerce', short: 'Ventas e-commerce',
      toc: 'Compras, ROAS, embudo y públicos de la campaña de ventas.',
      sub: 'Campaña de ventas en la web. Los valores de compra son atribución de Meta.',
      metric: 'purchases', one: 'compra', many: 'compras', tag: 'Compra ahora', rest: 'Otras piezas de la campaña de ventas',
      match: ad => ad.group === 'Ventas',
    },
    {
      key: 'whatsapp', icon: 'chat', title: 'Mensajes WhatsApp · público general', short: 'Mensajes WhatsApp',
      toc: 'Conversaciones de WhatsApp con público general.',
      sub: 'Conversaciones por WhatsApp dirigidas a público amplio.',
      metric: 'conversations', one: 'conversación', many: 'conversaciones', tag: 'WhatsApp', rest: 'Otras piezas de WhatsApp',
      match: ad => ad.group === 'Mensajes' && !isLocal(ad.adSet),
    },
    {
      key: 'tienda', icon: 'store', title: 'Mensajes a tienda · radio 3 km', short: 'Mensajes a tienda',
      toc: 'Mensajes con segmentación local (radio 3 km).',
      sub: 'Mensajes con segmentación local: solo al público dentro de un radio de 3 km alrededor de la tienda física.',
      metric: 'conversations', one: 'conversación', many: 'conversaciones', tag: 'Mensaje local', rest: 'Otras piezas de mensajes a tienda',
      match: ad => ad.group === 'Mensajes' && isLocal(ad.adSet),
    },
    {
      key: 'reconocimiento', icon: 'eye', title: 'Reconocimiento de marca', short: 'Reconocimiento',
      toc: 'Alcance, frecuencia y piezas que dieron a conocer la marca.',
      sub: `Campaña de alcance para que más personas conozcan ${BRAND}.`,
      metric: 'reach', one: 'persona alcanzada', many: 'personas alcanzadas', tag: 'Alcance', rest: 'Otras piezas de reconocimiento',
      match: ad => ad.group === 'Reconocimiento',
    },
  ];

  function sums(ads) {
    const total = Object.fromEntries(METRICS.map(field => [field, 0]));
    ads.forEach(ad => METRICS.forEach(field => { total[field] += ad[field]; }));
    total.cpm = divide(total.spend * 1000, total.impressions);
    total.cpc = divide(total.spend, total.clicks);
    total.frequency = divide(total.impressions, total.reach);
    total.roas = divide(total.revenue, total.spend);
    return total;
  }
  const resultOf = (stats, metric) => Number(stats[metric]) || 0;

  function adStats(ad, metric) {
    const result = resultOf(ad, metric);
    return {
      ...ad,
      result,
      cost: divide(ad.spend, result),
      roas: divide(ad.revenue, ad.spend),
      frequency: divide(ad.impressions, ad.reach),
      // La descarga de Meta no trae el formato de la pieza. Solo se afirma "Video" cuando hay ThruPlays,
      // que unicamente los mide un video; sin ellos no se inventa "Imagen", porque el dato no esta.
      format: ad.thruplays > 0 ? 'Video' : '',
    };
  }

  function buildSection(spec, month) {
    const ads = month.ads.filter(spec.match).filter(ad => ad.spend > 0 || ad.impressions > 0);
    if (!ads.length) return null;
    const cur = sums(ads);
    if (!cur.spend) return null;
    const ranked = ads.map(ad => adStats(ad, spec.metric))
      .sort((left, right) => right.result - left.result || right.spend - left.spend);
    // Una misma pieza puede correr en dos conjuntos de la misma lamina (el "40% OFF" en remarketing y en
    // publico amplio): entonces el nombre lleva su publico, como en el modelo, para no verse repetido.
    const veces = ranked.reduce((count, ad) => ({ ...count, [ad.name]: (count[ad.name] || 0) + 1 }), {});
    ranked.forEach(ad => {
      ad.label = veces[ad.name] > 1 ? `${ad.name} · ${audienceLabel(ad.adSet).split(' · ')[0]}` : ad.name;
      // El nombre con el que se nombra la pieza en toda la lamina (tarjetas, barras y textos).
      ad.name = ad.label;
    });
    const results = resultOf(cur, spec.metric);
    return {
      ...spec,
      cur,
      results,
      cost: divide(cur.spend, results),
      ads: ranked,
      sets: adSets(ads, spec.metric),
      share: divide(ranked[0] ? ranked[0].result : 0, results),
    };
  }

  // Los conjuntos de anuncios de una lamina, de mayor a menor inversion: en Ventas son los publicos
  // (remarketing y publico amplio) que el modelo compara por ROAS.
  function adSets(ads, metric) {
    const map = new Map();
    ads.forEach(ad => {
      const name = ad.adSet || 'Sin conjunto';
      if (!map.has(name)) map.set(name, { name, ads: [] });
      map.get(name).ads.push(ad);
    });
    return [...map.values()]
      .map(set => {
        const cur = sums(set.ads);
        return { name: set.name, cur, result: resultOf(cur, metric), roas: cur.roas, cost: divide(cur.spend, resultOf(cur, metric)) };
      })
      .filter(set => set.cur.spend > 0)
      .sort((left, right) => right.cur.spend - left.cur.spend);
  }

  // El nombre del publico como lo lee el cliente: "Conjunto de ventas - Ropa para niños - Remarketing"
  // se dice "Remarketing · Ropa para niños".
  function audienceLabel(name) {
    const clean = String(name || '').replace(/^conjunto( de)?\s*/i, '').replace(/\s*-\s*/g, ' · ').replace(/\s+/g, ' ').trim();
    if (!clean) return 'Sin conjunto';
    // "Conjunto de ventas - Ropa para niños - Remarketing" se lee "Remarketing · Ropa para niños": lo que
    // distingue al publico va primero y las palabras del objetivo, que ya dice el titulo, se caen.
    const parts = clean.split(' · ').filter(part => !/^(ventas?|mensajes?|reconocimiento|alcance)$/i.test(part.trim()));
    if (!parts.length) return clean;
    const kind = parts.find(part => /remarketing|retargeting|amplio|abierto|lookalike|similar|interes/i.test(part));
    if (kind && parts.length > 1) return [kind, ...parts.filter(part => part !== kind)].join(' · ');
    return parts.join(' · ');
  }

  function buildReport(month) {
    const totals = sums(month.ads);
    const keys = [...GROUP_ORDER, ...new Set(month.ads.map(ad => ad.group).filter(key => !GROUP_ORDER.includes(key)))];
    const objectives = keys.map(key => {
      const group = GROUPS[key] || otherGroup(key);
      const ads = month.ads.filter(ad => ad.group === key);
      if (!ads.length) return null;
      const cur = sums(ads);
      if (!cur.spend) return null;
      const results = resultOf(cur, group.metric);
      return { group, cur, results, cost: group.key === 'Reconocimiento' ? cur.cpm : divide(cur.spend, results), share: divide(cur.spend, totals.spend) };
    }).filter(Boolean).sort((left, right) => right.cur.spend - left.cur.spend);
    const sections = SECTIONS.map(spec => buildSection(spec, month)).filter(Boolean);
    // Con una sola campaña de mensajes no hace falta distinguirla del publico local.
    const whatsapp = sections.find(section => section.key === 'whatsapp');
    if (whatsapp && !sections.some(section => section.key === 'tienda')) {
      whatsapp.title = 'Mensajes WhatsApp';
      whatsapp.sub = 'Conversaciones por WhatsApp iniciadas desde los anuncios.';
    }
    const first = Number(month.firstDay.slice(8, 10));
    const last = Number(month.lastDay.slice(8, 10));
    const monthName = MONTHS[month.index];
    const shortMonth = SHORT[month.index];
    const range = `${first} – ${last} ${shortMonth} ${month.year}`;
    return {
      month, totals, objectives, sections,
      labels: {
        cover: `${cap(monthName)} ${month.year} · Periodo ${first} – ${last} ${shortMonth}`,
        chip: range,
        range,
        monthName,
        source: `Fuente: ${CHANNEL} · ${first} – ${last} ${shortMonth} ${month.year}`,
        footer: `${BRAND} · Reporte ${CHANNEL} · ${cap(monthName)} ${month.year}`,
        file: `${SLUG}-Reporte-${CHANNEL.replace(/\s+/g, '-')}-${cap(monthName)}-${month.year}`,
        period: `${first} – ${last} de ${monthName} de ${month.year}${first === 1 && month.closed ? ' (mes completo)' : ''}`,
      },
    };
  }

  // ── Textos propuestos (lo que se puede afirmar con los numeros) ────────
  const sectionByKey = (report, key) => report.sections.find(section => section.key === key);

  function suggestIntro(report) {
    const names = report.objectives.map(objective => ({
      Mensajes: 'conversaciones por WhatsApp', Ventas: 'ventas en la web', Reconocimiento: 'reconocimiento de marca',
    }[objective.group.key] || objective.group.label.toLowerCase()));
    const count = { 1: 'un objetivo', 2: 'dos objetivos', 3: 'tres objetivos', 4: 'cuatro objetivos' }[names.length] || `${names.length} objetivos`;
    return `${BRAND} trabajó ${count} en Meta: ${listOf(names)}. Cada canal cumple una función dentro del embudo.`;
  }

  function suggestResumenDestacado(report) {
    const best = report.objectives[0];
    if (!best) return '';
    if (best.group.key === 'Mensajes') {
      const tienda = sectionByKey(report, 'tienda');
      const detail = tienda ? ' — WhatsApp general y mensajes a tienda (radio 3 km)' : '';
      return `La campaña de **mensajes** generó ${num(best.results)} conversaciones a ${cost(best.cost)} cada una${detail}: es el canal que más contacto directo trae con el cliente.`;
    }
    if (best.group.key === 'Ventas') {
      return `La campaña de **ventas** se llevó ${pct(best.share * 100)} de la inversión y cerró ${num(best.results)} compras por ${money(best.cur.revenue)} (ROAS ${ratio2(best.cur.roas)}).`;
    }
    return `**${best.group.label}** concentró ${pct(best.share * 100)} de la inversión del mes con ${money(best.cur.spend)}.`;
  }

  function suggestResumenAnalisis(report) {
    const top = report.objectives[0];
    const ventas = report.objectives.find(objective => objective.group.key === 'Ventas');
    const reco = report.objectives.find(objective => objective.group.key === 'Reconocimiento');
    const parts = [];
    if (top) parts.push(`**Qué pasó:** el presupuesto se concentró en ${top.group.lower} (${pct(top.share * 100)}), el canal con mejor costo por resultado`);
    if (ventas) parts.push(`las ventas web aportaron ${num(ventas.results)} ${ventas.results === 1 ? 'compra' : 'compras'} con ROAS ${ratio2(ventas.cur.roas)}`);
    if (reco) parts.push(`el reconocimiento llevó la marca a ${thousands(reco.cur.reach)} personas a un CPM de ${money2(reco.cur.cpm)}`);
    const action = top && top.group.key === 'Mensajes'
      ? ' **Acción:** sostener WhatsApp como motor de contacto y reforzar remarketing para convertir conversaciones en más ventas.'
      : ' **Acción:** sostener lo que mejor costo por resultado trae y reforzar remarketing para cerrar más ventas.';
    return `${parts.join('; ')}.${action}`;
  }

  function suggestDistribucion(report) {
    const top = report.objectives[0];
    if (!top) return '';
    const rest = report.objectives.slice(1).map(objective => objective.group.lower);
    const half = top.share >= 0.5 ? 'Más de la mitad del presupuesto' : 'La mayor parte del presupuesto';
    return `${half} (${pct(top.share * 100)}) fue a **${top.group.lower}**, el canal de ${top.group.role}.${rest.length ? ` ${cap(listOf(rest))} ${rest.length > 1 ? 'completan' : 'completa'} el embudo.` : ''}`;
  }

  function suggestAnalisis(section, report) {
    const { cur, results, cost: unit } = section;
    const best = section.ads[0];
    if (section.key === 'ventas') {
      // Sin compras no hay CPA ni ROAS que leer: la lamina dice lo que si se puede afirmar.
      if (!results) {
        const lines = [`**Qué pasó:** la campaña de ventas invirtió ${money(cur.spend)} sin compras atribuidas en el periodo.`];
        if (cur.addToCart > 0) lines.push(`**Dónde quedó:** ${num(cur.addToCart)} añadidos al carrito y ${num(cur.checkouts)} pagos iniciados: hay interés que todavía no se cierra.`);
        lines.push('**Qué revisar:** la oferta, las piezas y el paso de pago de la web.');
        return lines.join(' ');
      }
      const lines = [`**Qué pasó: ${num(results)} ${results === 1 ? 'compra' : 'compras'}** por ${money(cur.spend)}, ROAS ${ratio2(cur.roas)} y CPA ${cost(unit)}.`];
      if (best && best.result > 0) lines.push(`**Qué lo trajo:** la pieza **"${best.name}"** convirtió a CPA ${cost(best.cost)} (ROAS ${ratio2(best.roas)}) con ${money(best.spend)} de inversión.`);
      const sinCompras = section.ads.filter(ad => !ad.result).reduce((total, ad) => total + ad.spend, 0);
      if (sinCompras > 0) lines.push(`**Por qué sube el CPA:** el resto del catálogo gastó ${money(sinCompras)} sin compras y subió el promedio.`);
      if (cur.addToCart > 0) lines.push(`**Fuga del embudo:** la caída **carrito → pago** (${num(cur.addToCart)} → ${num(cur.checkouts)} → ${num(cur.purchases)}) es la mayor pérdida: recuperar carritos.`);
      return lines.join(' ');
    }
    if (section.key === 'whatsapp' || section.key === 'tienda') {
      const otra = report.sections.find(other => other.key === (section.key === 'whatsapp' ? 'tienda' : 'whatsapp'));
      const lines = [`**Qué pasó: ${num(results)} ${results === 1 ? 'conversación' : 'conversaciones'}** por ${money(cur.spend)} a ${cost(unit)} c/u${section.key === 'tienda' ? ', con segmentación local: radio de 3 km alrededor de la tienda' : ''}.`];
      if (section.key === 'tienda') {
        lines.push(`**Por qué cuesta más:** el público local es pequeño, por eso la frecuencia sube (${ratio2(cur.frequency)})${otra ? ` y el costo por conversación es mayor que en WhatsApp general (${cost(otra.cost)})` : ''}. Es el precio de apuntar solo a la zona cercana.`);
        lines.push('**Qué aporta:** acerca clientes del barrio a la **tienda física** y da a conocer el local.');
      } else {
        lines.push(`**Por qué el costo es bajo:** el público general es amplio y la llamada directa a WhatsApp convierte sin fricción.${best && best.result ? ` "${best.name}" trajo ${num(best.result)} de las ${num(results)} conversaciones a ${cost(best.cost)}.` : ''}`);
        lines.push(`**Qué escalar:** ${best ? `la línea de **"${best.name}"**${best.format ? ` y su formato ${best.format.toLowerCase()}` : ''}` : 'las piezas con mejor costo por conversación'}. Dar seguimiento comercial a las conversaciones para cerrar ventas.`);
      }
      return lines.join(' ');
    }
    if (section.key === 'reconocimiento') {
      const second = section.ads[1];
      const lines = [`**Qué pasó: ${thousands(cur.reach)} personas** (${thousands(cur.impressions)} impresiones) a CPM ${money2(cur.cpm)} y frecuencia ${ratio2(cur.frequency)}.`];
      lines.push(`**Por qué el CPM es tan bajo:** objetivo de alcance + público amplio + frecuencia controlada (${ratio2(cur.frequency)} veces por persona) = impresiones baratas sin saturar.`);
      if (best && second && second.clicks > 0) lines.push(`**Qué pieza ganó: "${best.name}"** generó ${num(best.clicks)} clics frente a ${num(second.clicks)} de la siguiente. Este público alimenta el remarketing.`);
      else if (best) lines.push(`**Qué pieza ganó: "${best.name}"**, con ${compact(best.reach)} de alcance y ${num(best.clicks)} clics.`);
      return lines.join(' ');
    }
    return `**Qué pasó:** ${num(results)} ${section.many} por ${money(cur.spend)} a ${cost(unit)} cada ${section.one}.`;
  }

  function suggestDestacado(section, report) {
    const best = section.ads[0];
    if (section.key === 'ventas') {
      return best && best.result
        ? `La pieza **"${best.name}"** concentró ${num(best.result)} de las ${num(section.results)} compras del mes con ROAS ${ratio2(best.roas)}.`
        : `La campaña de ventas invirtió ${money(section.cur.spend)} sin cerrar compras: revisar oferta, piezas y paso de pago.`;
    }
    if (section.key === 'whatsapp') {
      return best && section.share
        ? `Una sola pieza trajo el **${pct(section.share * 100)} de las conversaciones** de WhatsApp a ${cost(best.cost)}: la línea creativa a escalar.`
        : `${num(section.results)} conversaciones de WhatsApp a ${cost(section.cost)} cada una.`;
    }
    if (section.key === 'tienda') {
      const otra = sectionByKey(report, 'whatsapp');
      return `El público local cuesta más por conversación (${cost(section.cost)}${otra ? ` frente a ${cost(otra.cost)} en WhatsApp general` : ''}), pero acerca clientes del barrio a la tienda.`;
    }
    if (section.key === 'reconocimiento') {
      return `El CPM de **${money2(section.cur.cpm)}** es el costo más eficiente del mes${best ? `; "${best.name}" fue la pieza que más público alcanzó` : ''}.`;
    }
    return `${num(section.results)} ${section.many} por ${money(section.cur.spend)}.`;
  }

  // Una conclusion por objetivo (no por lamina): las dos campañas de mensajes dejan una sola lectura,
  // como en el modelo.
  const CONCLUSION_ICONS = { Mensajes: 'chat', Ventas: 'cart', Reconocimiento: 'eye' };
  function suggestConclusion(objective, report) {
    const { group, cur, results } = objective;
    if (group.key === 'Mensajes') {
      const tienda = sectionByKey(report, 'tienda');
      const whatsapp = sectionByKey(report, 'whatsapp');
      const detail = tienda && whatsapp ? `, en WhatsApp general (${num(whatsapp.results)}) y mensajes a tienda (${num(tienda.results)}, radio 3 km)` : '';
      const best = (whatsapp || tienda || { ads: [] }).ads[0];
      return {
        title: 'WhatsApp es el motor de contacto',
        text: `${num(results)} conversaciones a ${cost(objective.cost)}${detail}.${best ? ` "${best.name}" es la línea creativa a escalar.` : ''}`,
      };
    }
    if (group.key === 'Ventas') {
      const ventas = sectionByKey(report, 'ventas');
      const best = ventas && ventas.ads[0];
      const remarketing = ventas && ventas.sets.find(set => /remarketing|retarget/i.test(set.name));
      return {
        title: remarketing ? 'El remarketing cierra las ventas' : 'Las ventas vienen de la oferta',
        text: `${num(results)} compras con ROAS ${ratio2(cur.roas)}${remarketing ? `; el remarketing rindió ${ratio2(remarketing.roas)} con ${num(remarketing.result)} de ellas` : ''}.${best ? ` Las piezas "${best.name}" concentraron las ventas del mes.` : ''}`,
      };
    }
    if (group.key === 'Reconocimiento') {
      return {
        title: 'Marca con alcance eficiente',
        text: `${thousands(cur.reach)} personas a CPM ${money2(cur.cpm)}. Ese público nuevo alimenta las campañas de ventas y conversaciones del siguiente periodo.`,
      };
    }
    return { title: group.label, text: `${num(results)} ${group.plural} por ${money(cur.spend)}.` };
  }

  function suggestSteps(report) {
    const ventas = sectionByKey(report, 'ventas');
    const whatsapp = sectionByKey(report, 'whatsapp') || sectionByKey(report, 'tienda');
    const steps = [];
    const creativa = whatsapp && whatsapp.ads[0] ? `"${whatsapp.ads[0].name}"` : '';
    const oferta = ventas && ventas.ads[0] ? `"${ventas.ads[0].name}"` : '';
    steps.push({
      icon: 'star',
      title: `Escalar ${creativa ? `la línea de ${creativa}` : 'las piezas con mejor costo'}${oferta ? ` y las piezas ${oferta}` : ''}`,
      text: `Crear nuevas variaciones de ${creativa || 'la pieza que mejor rinde'} y mantener las piezas de oferta que generaron las compras del mes.`,
    });
    steps.push({
      icon: 'users',
      title: 'Reforzar remarketing hacia carrito y conversaciones',
      text: `Reactivar a ${ventas && ventas.cur.addToCart ? `los ${num(ventas.cur.addToCart)} usuarios que agregaron al carrito y a ` : ''}las conversaciones iniciadas para cerrar más ventas.`,
    });
    return steps;
  }

  // ── Notas del equipo ───────────────────────────────────────────────────
  function readNotes() {
    try {
      const saved = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch { return {}; }
  }
  function writeNotes(notes) {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* sin storage dura hasta recargar */ }
  }
  function saveNote(periodId, key, value) {
    const notes = readNotes();
    notes[periodId] = { ...(notes[periodId] || {}), [key]: value };
    writeNotes(notes);
  }
  function resetNotes(periodId) {
    const notes = readNotes();
    delete notes[periodId];
    writeNotes(notes);
  }
  // Texto editable sobre la lamina: al hacer clic se ve con sus ** y al salir vuelve a negrita.
  function editable(key, text, tag = 'p', className = '') {
    return `<${tag} class="rp-edit ${className}" data-note="${esc(key)}" data-raw="${esc(text)}" title="Clic para editar · **texto** va en negrita">${rich(text)}</${tag}>`;
  }
  const pick = (notes, key, fallback) => (notes[key] != null ? notes[key] : fallback);

  // ── Piezas de las laminas ──────────────────────────────────────────────
  // Una tarjeta de KPI: rotulo, cifra y pie. Con texto en vez de cifra (el nombre de una campaña) la
  // tipografia baja para que entre en una linea.
  const kpi = (label, value, foot, text = false) => `
    <div class="rp-card rp-kpi${text ? ' rp-kpi-text' : ''}">
      <span class="rp-kpi-label">${esc(label)}</span>
      <strong>${value}</strong>
      <span class="rp-delta muted">${esc(foot)}</span>
    </div>`;

  const head = (title, sub, chip) => `
    <header class="rp-head">
      <div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
      ${chip ? `<span class="rp-chip">${icon('calendar')}${esc(chip)}</span>` : ''}
    </header>`;

  const footer = (left, report, page, total) => `
    <footer class="rp-foot">
      <span>${esc(left)}</span>
      <span class="rp-foot-right"><img src="${LOGO}" alt=""><b>Lima Retail</b>${esc(report.labels.footer)} · ${pageNumber(page)} / ${pageNumber(total)}</span>
    </footer>`;

  const insight = (label, key, text) => `
    <div class="rp-insight">
      <span class="rp-insight-icon">${icon('bulb')}</span>
      <div>
        <span class="rp-insight-label">${esc(label)}</span>
        ${editable(key, text)}
      </div>
    </div>`;

  const panel = (iconName, title, sub, body, className = '') => `
    <div class="rp-panel ${className}">
      <div class="rp-panel-head">
        <span class="rp-icon">${icon(iconName)}</span>
        <div><div class="rp-panel-title">${esc(title)}</div>${sub ? `<div class="rp-panel-sub">${esc(sub)}</div>` : ''}</div>
      </div>
      <div class="rp-panel-body">${body}</div>
    </div>`;

  // Barras de desglose: etiqueta, barra proporcional con su cifra dentro y el detalle a la derecha.
  function bars(rows) {
    const top = Math.max(...rows.map(row => row.value), 1);
    return `<div class="rp-bars">${rows.map((row, index) => `
      <div class="rp-bar-row">
        <span class="rp-bar-label" title="${esc(row.label)}">${esc(row.label)}</span>
        <span class="rp-bar-track"><span class="rp-bar-fill${index && !row.color ? ' soft' : ''}" style="width:${Math.max(6, Math.round((row.value / top) * 100))}%${row.color ? `;background:${row.color}` : ''}">${esc(row.inside || '')}</span></span>
        <span class="rp-bar-value">${esc(row.right || '')}</span>
      </div>`).join('')}</div>`;
  }

  // La dona de la distribucion: un arco por objetivo, en el orden de la tabla.
  function donut(report) {
    const radius = 86;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const arcs = report.objectives.map(objective => {
      const share = objective.share || 0;
      const length = circumference * share;
      const arc = `<circle cx="116" cy="116" r="${radius}" fill="none" stroke="${objective.group.color}" stroke-width="34" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"></circle>`;
      offset += length;
      return arc;
    }).join('');
    return `
      <div class="rp-donut">
        <svg viewBox="0 0 232 232" role="img" aria-label="Distribución de la inversión por objetivo">${arcs}</svg>
        <span class="rp-donut-center"><strong>${money(report.totals.spend)}</strong><span>inversión</span></span>
      </div>`;
  }

  // Tarjetas de los mejores anuncios: la pieza, su formato y tres o cuatro cifras, como en el modelo.
  function bestAds(section) {
    const ads = section.ads.filter(ad => ad.spend > 0);
    if (!ads.length) return '';
    const dominant = section.share != null && section.share >= DOMINANT && ads.length > 2;
    const shown = ads.slice(0, dominant ? 1 : TOP_ADS);
    const rest = ads.slice(shown.length);
    const title = { ventas: 'Mejores anuncios · por compras y ROAS', whatsapp: 'Mejor anuncio · por conversaciones', tienda: 'Mejores anuncios · por conversaciones', reconocimiento: 'Mejores anuncios · por alcance' }[section.key] || 'Mejores anuncios';
    const figures = ad => {
      if (section.key === 'ventas') return [['Inversión', money(ad.spend)], ['Compras', num(ad.result), true], ['ROAS', ratio2(ad.roas), true], ['CPA', cost(ad.cost)]];
      if (section.key === 'reconocimiento') return [['Inversión', money(ad.spend)], ['Alcance', compact(ad.reach), true], ['Clics', num(ad.clicks)], ['Frecuencia', ratio2(ad.frequency)]];
      return [['Inversión', money(ad.spend)], ['Conversac.', num(ad.result), true], ['Costo/conv.', cost(ad.cost)], ['Alcance', compact(ad.reach)]];
    };
    const card = (ad, index) => `
      <article class="rp-best-card${index === 0 ? ' best' : ''}">
        <div class="rp-best-body">
          <div class="rp-best-top">
            <span class="rp-best-name" title="${esc(ad.label || ad.name)}">${esc(ad.label || ad.name)}</span>
            <span class="rp-best-tag">${esc(ad.format ? `${ad.format} · ${section.tag}` : section.tag)}</span>
          </div>
          <dl class="rp-best-figs">${figures(ad).map(([label, value, mark]) => `<div><dt>${esc(label)}</dt><dd${mark ? ' class="mark"' : ''}>${value}</dd></div>`).join('')}</dl>
        </div>
      </article>`;
    const note = rest.length ? `
      <div class="rp-best-note">
        <b>${esc(section.rest || 'Otras piezas')}</b>
        <span>${esc(rest.slice(0, 3).map(ad => ad.label || ad.name).join(', '))}${rest.length > 3 ? ` y ${rest.length - 3} más` : ''} · ${num(rest.reduce((total, ad) => total + ad.result, 0))} ${esc(section.many)} con ${money(rest.reduce((total, ad) => total + ad.spend, 0))} de inversión.</span>
      </div>` : '';
    return `
      <div class="rp-best">
        <div class="rp-best-head">${icon('star')}${esc(title)}</div>
        <div class="rp-best-grid">${shown.map(card).join('')}${dominant ? note : ''}</div>
      </div>`;
  }

  // El panel derecho de cada lamina: el embudo y los publicos en ventas, el desglose por pieza en
  // mensajes, el contexto local en la campaña de tienda y el alcance por pieza en reconocimiento.
  function sidePanel(section, report) {
    if (section.key === 'ventas') {
      const { cur } = section;
      // Un mes que todavia solo tiene las filas de la API no trae el embudo: tres ceros se leerian como
      // que nadie agrego al carrito, y lo que pasa es que el dato no esta. La lamina lo dice.
      const funnel = report.month.missing.includes('embudo')
        ? `<p class="rp-empty">El embudo llega con la exportación del mes. Las filas de la API traen la inversión, las compras y su valor, pero no las visitas a la web, los artículos agregados al carrito ni los pagos iniciados.</p>`
        : bars([
          { label: 'Agregados al carrito', value: cur.addToCart, inside: num(cur.addToCart), color: BLUE },
          { label: 'Pagos iniciados', value: cur.checkouts, inside: num(cur.checkouts), color: '#0ea5e9' },
          { label: 'Compras', value: cur.purchases, inside: num(cur.purchases), color: TEAL },
        ]);
      const audiences = section.sets.slice(0, 2).map((set, index) => `
        <div class="rp-aud-card${index === 0 ? ' best' : ''}">
          <div class="rp-aud-head">
            <span class="rp-aud-name">${esc(audienceLabel(set.name))}</span>
            <span class="rp-aud-roas">${set.cur.revenue > 0 ? `ROAS ${ratio2(set.roas)}` : 'Sin compras'}</span>
          </div>
          <dl class="rp-aud-figs">
            <div><dt>Inversión</dt><dd>${money(set.cur.spend)}</dd></div>
            <div><dt>Compras</dt><dd>${num(set.cur.purchases)}</dd></div>
            <div><dt>Valor</dt><dd>${money(set.cur.revenue)}</dd></div>
          </dl>
        </div>`).join('');
      const sets = section.sets.slice(0, 2);
      return panel('cart', 'Embudo y públicos de venta', 'Atribución Meta', `${funnel}${audiences ? `<div class="rp-aud${sets.length < 2 ? ' one' : ''}">${audiences}</div>` : ''}`);
    }
    if (section.key === 'tienda') {
      const { cur } = section;
      const rows = [
        { label: 'Alcance local', value: 1, inside: '', right: `${compact(cur.reach)} personas`, color: TEAL },
        { label: 'Frecuencia', value: 0.62, inside: '', right: `${ratio2(cur.frequency)} veces`, color: '#0ea5e9' },
        { label: 'Clics al enlace', value: 0.45, inside: '', right: `${num(cur.clicks)} clics`, color: BLUE },
      ];
      return panel('pin', 'Contexto del público local', 'Radio de 3 km alrededor de la tienda', bars(rows));
    }
    if (section.key === 'reconocimiento') {
      const rows = section.ads.slice(0, 3).map((ad, index) => ({
        label: ad.label || ad.name, value: ad.reach, inside: '', right: `${compact(ad.reach)} · ${num(ad.clicks)} clics`, color: index === 0 ? AMBER : '',
      }));
      return panel('eye', 'Alcance por pieza', 'Personas alcanzadas y clics', bars(rows));
    }
    // En mensajes, como el modelo: la pieza que manda y el resto junto, para que se vea el reparto real.
    const shown = section.ads.length > 3 ? section.ads.slice(0, 2) : section.ads.slice(0, 3);
    const others = section.ads.slice(shown.length);
    const rows = shown.map((ad, index) => ({
      label: ad.label || ad.name, value: ad.result, inside: '', right: `${num(ad.result)} · ${cost(ad.cost)}`, color: index === 0 ? BLUE : '',
    }));
    if (others.length) {
      const result = others.reduce((total, ad) => total + ad.result, 0);
      rows.push({ label: `Otras ${others.length} piezas`, value: result, inside: '', right: `${num(result)} conv.` });
    }
    return panel('chat', 'Desglose de conversaciones', 'Qué pieza las generó', bars(rows));
  }

  // ── Laminas ────────────────────────────────────────────────────────────
  function coverPage(report) {
    return `
      <section class="rp-page rp-cover">
        <div class="rp-brand"><img src="${LOGO}" alt="Lima Retail"><div><b>Lima Retail</b><span>Data Driven Marketing</span></div></div>
        <div class="rp-cover-body">
          <span class="rp-cover-mark" aria-hidden="true">${esc(BRAND.split(/\s+/).pop().charAt(0).toUpperCase())}</span>
          <h1>Reporte de Publicidad</h1>
          <p class="rp-cover-client">Cliente: <b>${esc(BRAND)}</b></p>
          <p class="rp-cover-period">${esc(report.labels.cover)}&nbsp; | &nbsp;${esc(CHANNEL)}</p>
        </div>
        <footer class="rp-foot">
          <span>${AGENCY_LINE}</span>
          <span class="rp-foot-right"><img src="${LOGO}" alt=""><b>Lima Retail</b>Emitido el ${esc(issuedLabel())}</span>
        </footer>
      </section>`;
  }

  function contentsPage(report, pages, total) {
    const items = [
      { title: 'Resumen ejecutivo', desc: 'Inversión, resultados por objetivo y aporte de cada canal.', icon: 'briefcase', page: pages.summary },
      { title: 'Distribución de inversión', desc: 'Cómo se repartió el presupuesto entre los objetivos.', icon: 'layers', page: pages.distribution },
      ...report.sections.map((section, index) => ({ title: section.short, desc: section.toc, icon: section.icon, page: pages.firstSection + index })),
      { title: 'Conclusiones', desc: 'Qué funcionó y próximos pasos.', icon: 'flag', page: pages.conclusions },
    ];
    return `
      <section class="rp-page">
        ${head('Contenido del reporte', 'Qué encontrarás en cada sección de este informe.')}
        <div class="rp-body rp-contents">
          ${items.map((item, index) => `
            <div class="rp-card rp-toc">
              <div class="rp-toc-top"><span class="rp-icon">${icon(item.icon)}</span><span class="rp-toc-num">${pageNumber(index + 1)}</span></div>
              <h3>${esc(item.title)}</h3>
              <p>${esc(item.desc)}</p>
              <span class="rp-toc-page">Página ${pageNumber(item.page)}</span>
            </div>`).join('')}
        </div>
        ${footer(report.labels.source, report, 2, total)}
      </section>`;
  }

  function summaryPage(report, notes, page, total) {
    const { totals, objectives, labels } = report;
    const mensajes = objectives.find(objective => objective.group.key === 'Mensajes');
    const ventas = objectives.find(objective => objective.group.key === 'Ventas');
    const reco = objectives.find(objective => objective.group.key === 'Reconocimiento');
    const tiles = [kpi('Inversión', money(totals.spend), `${CHANNEL} · ${report.month.closed ? 'mes completo' : 'mes en curso'}`)];
    if (mensajes) tiles.push(kpi('Conversaciones', num(mensajes.results), `WhatsApp · ${cost(mensajes.cost)} c/u`));
    if (ventas) {
      tiles.push(kpi('Compras web', num(ventas.results), `Atribución Meta · ROAS ${ratio2(ventas.cur.roas)}`));
      tiles.push(kpi('Valor compras', money(ventas.cur.revenue), 'Atribución Meta'));
    }
    if (reco) tiles.push(kpi('Alcance recon.', thousands(reco.cur.reach), `suma diaria · CPM ${money2(reco.cur.cpm)}`));
    tiles.push(kpi('Clics al enlace', num(totals.clicks), 'Hacia WhatsApp y web'));

    const resultLabel = objective => {
      if (objective.group.key === 'Reconocimiento') return `<b>${compact(objective.cur.reach)}</b> alcance`;
      return `<b>${num(objective.results)}</b> ${esc(objective.group.unit)}`;
    };
    const costLabel = objective => (objective.group.key === 'Reconocimiento' ? `${money2(objective.cur.cpm)} CPM` : cost(objective.cost));
    return `
      <section class="rp-page">
        ${head('Resumen ejecutivo', pick(notes, 'intro', suggestIntro(report)), labels.chip)}
        <div class="rp-body">
          <div class="rp-grid-kpis">${tiles.join('')}</div>
          <div class="rp-split">
            <div class="rp-card rp-table-card">
              <div class="rp-card-title">Resultado por objetivo</div>
              <div class="rp-card-sub">Inversión y resultado principal de cada campaña</div>
              <table class="rp-table">
                <colgroup><col style="width:40%"><col style="width:19%"><col style="width:23%"><col style="width:18%"></colgroup>
                <thead><tr><th>Objetivo</th><th class="num">Inversión</th><th class="num">Resultado</th><th class="num">Costo</th></tr></thead>
                <tbody>
                  ${objectives.map((objective, index) => `
                    <tr${index === 0 ? ' class="rp-top"' : ''}>
                      <td class="rp-name"><i class="rp-dot" style="background:${objective.group.color}"></i>${esc(objective.group.label)}</td>
                      <td class="num">${money(objective.cur.spend)}</td>
                      <td class="num">${resultLabel(objective)}</td>
                      <td class="num">${costLabel(objective)}</td>
                    </tr>`).join('')}
                  <tr class="rp-total"><td>Total · ${objectives.length} ${objectives.length === 1 ? 'objetivo' : 'objetivos'}</td><td class="num">${money(totals.spend)}</td><td class="num">—</td><td class="num">—</td></tr>
                </tbody>
              </table>
            </div>
            <div class="rp-pile">
              ${insight('Destacado', 'destacado', pick(notes, 'destacado', suggestResumenDestacado(report)))}
              ${panel('chart', 'Análisis', '', editable('analisis', pick(notes, 'analisis', suggestResumenAnalisis(report))))}
            </div>
          </div>
        </div>
        ${footer(`${labels.source} · valores de compra = atribución de Meta`, report, page, total)}
      </section>`;
  }

  function distributionPage(report, notes, page, total) {
    const { totals, objectives, labels } = report;
    const top = objectives[0];
    const tiles = [kpi('Inversión total', money(totals.spend), `${objectives.length} ${objectives.length === 1 ? 'campaña activa' : 'campañas activas'}`)];
    if (top) tiles.push(kpi('Mayor inversión', esc(top.group.short), `${pct(top.share * 100)} · ${top.group.role}`, true));
    objectives.slice(1, 3).forEach(objective => tiles.push(kpi(objective.group.key, pct(objective.share * 100), objective.group.key === 'Reconocimiento' ? objective.group.role : 'del presupuesto')));
    const resultLabel = objective => {
      if (objective.group.key === 'Ventas') return `${num(objective.results)} compras · ${money(objective.cur.revenue)}`;
      if (objective.group.key === 'Reconocimiento') return `${compact(objective.cur.reach)} alcance`;
      return `${num(objective.results)} ${objective.group.plural}`;
    };
    return `
      <section class="rp-page">
        ${head('Distribución de inversión', 'El presupuesto se repartió entre los objetivos según su función en el embudo: captar contacto, vender y dar a conocer la marca.', labels.chip)}
        <div class="rp-body">
          <div class="rp-grid-kpis">${tiles.join('')}</div>
          <div class="rp-card">
            <div class="rp-panel-head">
              <span class="rp-icon">${icon('layers')}</span>
              <div><div class="rp-panel-title">Inversión por campaña</div><div class="rp-panel-sub">Cada objetivo con su participación y resultado principal</div></div>
            </div>
            <div class="rp-dist">
              ${donut(report)}
              <table class="rp-table">
                <colgroup><col style="width:34%"><col style="width:18%"><col style="width:14%"><col style="width:34%"></colgroup>
                <thead><tr><th>Campaña</th><th class="num">Inversión</th><th class="num">% inv.</th><th class="num">Resultado</th></tr></thead>
                <tbody>
                  ${objectives.map((objective, index) => `
                    <tr${index === 0 ? ' class="rp-top"' : ''}>
                      <td class="rp-name"><i class="rp-dot" style="background:${objective.group.color}"></i>${esc(objective.group.campaign)}</td>
                      <td class="num">${money(objective.cur.spend)}</td>
                      <td class="num">${pct(objective.share * 100)}</td>
                      <td class="num">${esc(resultLabel(objective))}</td>
                    </tr>`).join('')}
                  <tr class="rp-total"><td>Total · ${objectives.length} ${objectives.length === 1 ? 'campaña' : 'campañas'}</td><td class="num">${money(totals.spend)}</td><td class="num">100%</td><td class="num">—</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          ${insight('Destacado', 'distribucion', pick(notes, 'distribucion', suggestDistribucion(report)))}
        </div>
        ${footer(report.labels.source, report, page, total)}
      </section>`;
  }

  function sectionTiles(section) {
    const { cur, results } = section;
    if (section.key === 'ventas') {
      return [
        kpi('Inversión', money(cur.spend), 'Campaña de ventas'),
        kpi('Compras', num(results), 'Atribución Meta'),
        kpi('Costo por compra', cost(section.cost), 'Inversión ÷ compras'),
        kpi('Valor de compras', money(cur.revenue), 'Atribución Meta'),
        kpi('ROAS Meta', ratio2(cur.roas), 'Valor ÷ inversión'),
      ].join('');
    }
    if (section.key === 'reconocimiento') {
      return [
        kpi('Inversión', money(cur.spend), 'Campaña de alcance'),
        kpi('Alcance', thousands(cur.reach), 'Suma diaria de alcance'),
        kpi('Impresiones', thousands(cur.impressions), 'Veces mostrado'),
        kpi('Frecuencia', ratio2(cur.frequency), 'Impresiones ÷ alcance'),
        kpi('CPM', money2(cur.cpm), 'Costo por mil impres.'),
      ].join('');
    }
    const local = section.key === 'tienda';
    return [
      kpi('Inversión', money(cur.spend), local ? 'Mensajes a tienda' : 'Mensajes WhatsApp'),
      kpi('Conversaciones', num(results), local ? 'Público local · 3 km' : 'Iniciadas por WhatsApp'),
      kpi('Costo por conv.', cost(section.cost), 'Inversión ÷ conversaciones'),
      kpi(local ? 'Alcance local' : 'Alcance', compact(cur.reach), `Suma diaria · frec. ${ratio2(cur.frequency)}`),
      kpi('Clics al enlace', num(cur.clicks), local ? 'Hacia WhatsApp' : 'Hacia WhatsApp y web'),
    ].join('');
  }

  function sectionPage(section, report, notes, page, total) {
    const analysisKey = `analisis:${section.key}`;
    const destacadoKey = `destacado:${section.key}`;
    const subKey = `sub:${section.key}`;
    // En ventas el panel de la derecha lleva el embudo y los publicos y ocupa toda la columna, como en el
    // modelo; en los demas objetivos comparte la columna con el destacado.
    const right = section.key === 'ventas'
      ? sidePanel(section, report)
      : `<div class="rp-pile">${sidePanel(section, report)}${insight('Destacado', destacadoKey, pick(notes, destacadoKey, suggestDestacado(section, report)))}</div>`;
    return `
      <section class="rp-page">
        ${head(section.title, pick(notes, subKey, section.sub), report.labels.chip)}
        <div class="rp-body">
          <div class="rp-grid-kpis">${sectionTiles(section)}</div>
          <div class="rp-split">
            ${panel('chart', 'Análisis', '', editable(analysisKey, pick(notes, analysisKey, suggestAnalisis(section, report))))}
            ${right}
          </div>
          ${bestAds(section)}
        </div>
        ${footer(section.key === 'ventas' ? `${report.labels.source} · valores de compra = atribución de Meta` : report.labels.source, report, page, total)}
      </section>`;
  }

  function conclusionsPage(report, notes, page, total) {
    const cards = report.objectives.slice(0, 3).map((objective, index) => {
      const suggested = suggestConclusion(objective, report);
      return `
        <div class="rp-card rp-conclusion">
          <div class="rp-toc-top"><span class="rp-icon framed">${icon(CONCLUSION_ICONS[objective.group.key] || 'chart')}</span><span class="rp-concl-num">${pageNumber(index + 1)}</span></div>
          ${editable(`concl:${index}:title`, pick(notes, `concl:${index}:title`, suggested.title), 'h3')}
          ${editable(`concl:${index}:text`, pick(notes, `concl:${index}:text`, suggested.text))}
        </div>`;
    }).join('');
    const steps = suggestSteps(report).map((step, index) => `
      <div class="rp-step${index === 0 ? ' first' : ''}">
        <span class="rp-icon">${icon(step.icon)}</span>
        <div class="rp-step-body">
          ${editable(`paso:${index}:title`, pick(notes, `paso:${index}:title`, step.title), 'h3')}
          ${editable(`paso:${index}:text`, pick(notes, `paso:${index}:text`, step.text))}
        </div>
      </div>`).join('');
    return `
      <section class="rp-page">
        ${head('Conclusiones y próximos pasos', `Qué funcionó en ${report.labels.monthName} y qué se hará en las próximas semanas.`)}
        <div class="rp-body">
          <div class="rp-grid-3 rp-conclusions">${cards}</div>
          <div class="rp-card">
            <div class="rp-panel-head"><span class="rp-icon">${icon('flag')}</span><div class="rp-panel-title">Próximos pasos</div></div>
            <div class="rp-steps">${steps}</div>
          </div>
          <div class="rp-note">${rich(`**Periodo:** ${report.labels.period}. Los valores de compra corresponden a la atribución de Meta Ads.`)}</div>
        </div>
        ${footer(`Fuente: análisis Lima Retail sobre ${CHANNEL} · ${BRAND} · ${report.labels.monthName} ${report.month.year}`, report, page, total)}
      </section>`;
  }

  const closingPage = () => `
    <section class="rp-page rp-closing">
      <img src="${LOGO}" alt="Lima Retail">
      <b>Lima Retail</b>
      <span class="rp-closing-tag">Data Driven Marketing</span>
      <span>Power KPI · Digital Analytics</span>
    </section>`;

  // ── Pintado ────────────────────────────────────────────────────────────
  function fitDeck() {
    const host = document.getElementById('week-report');
    if (!host || !host.clientWidth) return;
    host.style.setProperty('--rp-scale', String(Math.min(1, host.clientWidth / PAGE_WIDTH)));
  }

  function wireEditables(host, periodId) {
    host.querySelectorAll('[data-note]').forEach(node => {
      try { node.contentEditable = 'plaintext-only'; } catch { node.contentEditable = 'true'; }
      node.spellcheck = false;
      node.addEventListener('focus', () => { node.textContent = node.dataset.raw; });
      node.addEventListener('input', () => {
        node.dataset.raw = node.innerText.replace(/\n+$/, '');
        saveNote(periodId, node.dataset.note, node.dataset.raw);
      });
      node.addEventListener('blur', () => { node.innerHTML = rich(node.dataset.raw); });
    });
  }

  function render() {
    const host = document.getElementById('week-report');
    const select = document.getElementById('week-select');
    if (!host || !data) return;
    const months = data.months;
    if (!months.length) {
      if (select) select.innerHTML = '<option value="">Sin meses con datos</option>';
      host.innerHTML = '<div class="panel"><div class="empty-state"><strong>Todavía no hay datos para el reporte</strong><span>El reporte se arma con las descargas de Meta Ads de la carpeta de Drive. En cuanto haya un mes con entregas, aparece aquí.</span></div></div>';
      return;
    }
    if (!months.some(month => month.id === selected)) selected = months[0].id;
    const month = months.find(item => item.id === selected);
    if (select) {
      select.innerHTML = months.map(item => {
        const first = Number(item.firstDay.slice(8, 10));
        const last = Number(item.lastDay.slice(8, 10));
        return `<option value="${esc(item.id)}"${item.id === selected ? ' selected' : ''}>${esc(`${item.name} ${item.year} · ${first} – ${last} ${SHORT[item.index]}`)}${item.closed ? '' : ' · mes en curso'}</option>`;
      }).join('');
    }

    const report = buildReport(month);
    const notes = readNotes()[month.id] || {};
    const pages = { summary: 3, distribution: 4, firstSection: 5, conclusions: 5 + report.sections.length };
    const total = pages.conclusions + 1;
    host.innerHTML = `
      <div class="rp-deck" id="week-doc">
        ${coverPage(report)}
        ${contentsPage(report, pages, total)}
        ${summaryPage(report, notes, pages.summary, total)}
        ${distributionPage(report, notes, pages.distribution, total)}
        ${report.sections.map((section, index) => sectionPage(section, report, notes, pages.firstSection + index, total)).join('')}
        ${conclusionsPage(report, notes, pages.conclusions, total)}
        ${closingPage()}
      </div>`;
    fitDeck();
    wireEditables(host, month.id);
  }

  async function renderModel() {
    const host = document.getElementById('week-model');
    if (!host) return;
    const model = await global.ReportsArchive?.latestReport?.();
    host.innerHTML = model
      ? `Modelo: <a href="${esc(model.viewUrl)}" target="_blank" rel="noopener">${esc(model.title)}</a> (último reporte subido a la carpeta)`
      : 'Modelo: el formato estándar de la agencia, igual para todas las marcas';
  }

  // El nombre del PDF lo pone el navegador con el titulo del documento: se cambia solo mientras imprime.
  function printReport() {
    if (!selected || !data) return;
    const month = data.months.find(item => item.id === selected);
    if (!month) return;
    document.activeElement?.blur?.();
    const title = document.title;
    document.title = buildReport(month).labels.file;
    const restore = () => { document.title = title; global.removeEventListener('afterprint', restore); };
    global.addEventListener('afterprint', restore);
    global.print();
    global.setTimeout(restore, 2000);
  }

  async function init() {
    const host = document.getElementById('week-report');
    if (!wired) {
      wired = true;
      document.getElementById('week-select')?.addEventListener('change', event => { selected = event.target.value; render(); });
      document.getElementById('week-print')?.addEventListener('click', printReport);
      document.getElementById('week-reset')?.addEventListener('click', () => {
        if (selected && global.confirm('Se descartan los textos editados de este mes y vuelven los propuestos. ¿Continuar?')) { resetNotes(selected); render(); }
      });
      if (host && typeof global.ResizeObserver === 'function') {
        resizeObserver = new global.ResizeObserver(fitDeck);
        resizeObserver.observe(host);
      }
      // Una sincronizacion con Drive trae datos nuevos: se vuelven a leer al abrir otra vez el generador.
      global.addEventListener('tlm:data-updated', () => { data = null; });
    }
    renderModel();
    if (data) { render(); return; }
    if (host) host.innerHTML = '<div class="panel"><div class="week-empty">Cargando los datos del mes...</div></div>';
    try {
      await load();
      render();
    } catch (error) {
      if (host) host.innerHTML = `<div class="panel"><div class="week-empty">No se pudieron cargar los datos de Meta Ads (${esc(error.message)}).</div></div>`;
    }
  }

  global.TLMReportWeek = { init };
})(window);

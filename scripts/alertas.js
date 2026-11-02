#!/usr/bin/env node
/* ============================================================
   scripts/alertas.js — Alerta semanal de Meta Ads de The Little Market.

   Sale los lunes a las 7:00 a. m. de Lima (ALERTA_MOTIVO=lunes, una vez por semana) y despues de
   cada barrido de Drive (ALERTA_MOTIVO=datos: solo si cambiaron las cifras del mes).

   Lee:
     data/tlm-ads-2026.json    → el mismo archivo que publica el tablero
     data/alertas-config.json  → remitente y destinatarios por defecto
     Destinatarios: si existen TLM_ALERTAS_URL y TLM_ALERTAS_TOKEN, la lista que guarde el tablero;
     si no, los de alertas-config.json.

   Envia email HTML por el correo del hosting (SMTP) o, si no esta configurado, por Resend.
   Registra el envio en data/alertas-envios.json (idempotencia).

   A diferencia de las alertas de Google Ads (Aquarius, Tierra Films, Hers), aqui no hay presupuesto
   en los datos: el contraste es contra el ritmo del propio mes y contra el mes anterior.

   Uso:
     node scripts/alertas.js --dry-run     simula y muestra el correo que saldria
     node scripts/alertas.js --preview x   escribe el HTML en un archivo, sin enviar
     node scripts/alertas.js --force       reenvia aunque la semana ya este registrada
   ============================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const readJson = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run') || process.env.DRY_RUN === 'true';
const FORCE = ARGS.includes('--force');
const PREVIEW = ARGS.includes('--preview') ? ARGS[ARGS.indexOf('--preview') + 1] : null;
const MOTIVO = process.env.ALERTA_MOTIVO || 'manual';

const limaDate = () => new Date(Date.now() - 5 * 3600 * 1000);

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-W${String(Math.ceil(((date - start) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

// ── Formato ──────────────────────────────────────────────────
const money = v => `S/. ${Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const moneyCorto = v => `S/. ${Math.round(Number(v || 0)).toLocaleString('es-PE')}`;
const count = v => Number(v || 0).toLocaleString('es-PE');
const signedPct = v => (v > 0 ? '+' : '') + Math.round(v) + '%';
const ratio = (a, b) => (b ? a / b : null);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Cargar archivos ──────────────────────────────────────────
const data = readJson('data/tlm-ads-2026.json');
const config = readJson('data/alertas-config.json');
if (process.env.DASHBOARD_URL) config.url_dashboard = process.env.DASHBOARD_URL;
const enviosPath = path.join(ROOT, 'data/alertas-envios.json');
const enviosData = readJson('data/alertas-envios.json');

const lima = limaDate();
const weekKey = isoWeek(lima);
const fechaLabel = lima.toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

// ── Estado del mes ───────────────────────────────────────────
// Los meses vienen en orden; interesa el ultimo con inversion, y el anterior con inversion para
// comparar. Un mes sin kpis todavia no tiene datos.
const meses = (Array.isArray(data.months) ? data.months : Object.values(data.months || {}))
  .filter(m => m && m.kpis && Number(m.kpis.spend) > 0);

console.log(`\n▶ Alerta de Meta Ads ${weekKey}${DRY_RUN ? ' [DRY-RUN]' : ''}`);
console.log(`  Fecha Lima : ${fechaLabel}`);
console.log(`  Datos      : data/tlm-ads-2026.json${data.syncedAt ? ` (barrido ${String(data.syncedAt).slice(0, 10)})` : ''}`);

if (!meses.length) {
  console.log('\n⏭  Todavía no hay un mes con inversión: no hay alerta que enviar.\n');
  process.exit(0);
}

const mes = meses[meses.length - 1];
const previo = meses.length > 1 ? meses[meses.length - 2] : null;

// Dias transcurridos del mes y dias que tiene: con eso se proyecta el cierre al ritmo actual.
const dia = n => (typeof n === 'string' ? Number(n.slice(8, 10)) : null);
const diasCorridos = dia(mes.lastDay) || 1;
const [anio, numMes] = (mes.firstDay || '').split('-').map(Number);
const diasMes = anio && numMes ? new Date(anio, numMes, 0).getDate() : 30;
const completo = diasCorridos >= diasMes;
const proyectar = v => (completo ? Number(v || 0) : (Number(v || 0) / diasCorridos) * diasMes);

const K = mes.kpis;
const P = previo ? previo.kpis : null;
const grupos = mes.spendByGroup || {};
const campanas = mes.campaigns || [];

// Un bloque por objetivo, con la cifra que de verdad lo mide.
const BLOQUES = [
  {
    grupo: 'Ventas', etiqueta: 'Ventas', unidad: 'compras',
    valor: K.purchases, previo: P && P.purchases,
    extra: () => {
      const roas = ratio(K.revenue, grupos.Ventas);
      return roas == null ? '—' : `ROAS ${roas.toFixed(2)}`;
    },
    costo: () => ratio(grupos.Ventas, K.purchases),
  },
  {
    grupo: 'Mensajes', etiqueta: 'Mensajes', unidad: 'conversaciones',
    valor: K.conversations, previo: P && P.conversations,
    extra: () => `${count(K.clicks)} clics`,
    costo: () => ratio(grupos.Mensajes, K.conversations),
  },
  {
    grupo: 'Reconocimiento', etiqueta: 'Reconocimiento', unidad: 'ThruPlays',
    valor: K.thruplays, previo: P && P.thruplays,
    extra: () => `${count(K.reach)} de alcance`,
    costo: () => ratio(grupos.Reconocimiento * 1000, K.impressions),
  },
].filter(b => Number(grupos[b.grupo] || 0) > 0);

const gastoCierre = proyectar(K.spend);
const roasReal = ratio(K.revenue, grupos.Ventas);
const roasPrevio = previo && previo.kpis ? ratio(previo.kpis.revenue, (previo.spendByGroup || {}).Ventas) : null;
const costoConv = ratio(grupos.Mensajes, K.conversations);
const costoConvPrevio = previo && previo.kpis ? ratio((previo.spendByGroup || {}).Mensajes, previo.kpis.conversations) : null;

// ── Avisos y nivel ───────────────────────────────────────────
// Rojo manda sobre ambar, y ambar sobre azul: el nivel del correo es el peor de los avisos.
const avisos = [];
avisos.push({ tone: 'blue', titulo: `Semana ${Math.ceil(diasCorridos / 7)} del mes`, cuerpo: `Datos al día ${diasCorridos} de ${diasMes}. Al ritmo de ahora, ${mes.name} cierra en ${moneyCorto(gastoCierre)}.` });

if (grupos.Ventas > 0 && roasReal != null && roasReal < 1) {
  avisos.push({ tone: 'red', titulo: `El ROAS va en ${roasReal.toFixed(2)}: las ventas no cubren la inversión`, cuerpo: `${money(grupos.Ventas)} en Ventas han devuelto ${money(K.revenue)}.` });
} else if (roasReal != null && roasPrevio != null && roasReal < roasPrevio * 0.7) {
  avisos.push({ tone: 'amber', titulo: `El ROAS cae de ${roasPrevio.toFixed(2)} a ${roasReal.toFixed(2)}`, cuerpo: `Comparado con ${previo.name}.` });
}

if (costoConv != null && costoConvPrevio != null && costoConv > costoConvPrevio * 1.3) {
  avisos.push({ tone: 'amber', titulo: `El costo por conversación sube ${signedPct((costoConv / costoConvPrevio - 1) * 100)}`, cuerpo: `De ${money(costoConvPrevio)} en ${previo.name} a ${money(costoConv)}.` });
}

// Una campaña que se lleva parte del gasto y no devuelve nada es lo primero que hay que mirar.
campanas
  .filter(c => Number(c.spend) > Number(K.spend) * 0.1)
  .filter(c => !Number(c.purchases) && !Number(c.conversations) && !Number(c.thruplays))
  .forEach(c => avisos.push({ tone: 'red', titulo: `«${c.name}» gasta sin resultados`, cuerpo: `${money(c.spend)} sin compras, conversaciones ni ThruPlays.` }));

const NIVELES = { red: { txt: '🚨 Riesgo', label: 'Riesgo' }, amber: { txt: '⚠️ Atención', label: 'Atención' }, blue: { txt: '✅ En marcha', label: 'En marcha' } };
const nivel = avisos.some(a => a.tone === 'red') ? 'red' : avisos.some(a => a.tone === 'amber') ? 'amber' : 'blue';

// ── Idempotencia ─────────────────────────────────────────────
const huella = crypto.createHash('sha256').update(JSON.stringify({
  mes: mes.name, dias: diasCorridos, kpis: K,
  campanas: campanas.map(c => [c.name, c.spend, c.purchases, c.conversations]),
})).digest('hex').slice(0, 16);

console.log(`  Mes        : ${mes.name} · día ${diasCorridos} de ${diasMes}${completo ? ' (completo)' : ''}`);
console.log(`  Motivo     : ${MOTIVO}`);
if (!FORCE && !DRY_RUN && !PREVIEW) {
  if (MOTIVO === 'datos' && enviosData.ultimaHuella === huella) {
    console.log('\n⏭  Las cifras del mes no cambiaron desde el último envío.\n');
    process.exit(0);
  }
  if (MOTIVO !== 'datos' && enviosData.enviados[weekKey]) {
    console.log(`\n⏭  Semana ${weekKey} ya registrada (${enviosData.enviados[weekKey]}). Usa --force para reenviar.\n`);
    process.exit(0);
  }
}

console.log(`\n📊 ${mes.name}:`);
console.log(`   Invertido   : ${money(K.spend)} → cierre ${money(gastoCierre)}`);
BLOQUES.forEach(b => console.log(`   ${b.etiqueta.padEnd(14)}: ${money(grupos[b.grupo])} · ${count(b.valor)} ${b.unidad} · ${b.extra()}`));
console.log(`   Nivel       : ${NIVELES[nivel].label}`);
avisos.forEach(a => console.log(`   · [${a.tone}] ${a.titulo}`));

// ── Email ────────────────────────────────────────────────────
// Misma estetica del tablero: fondo claro, tarjetas blancas de borde fino, Inter y pildoras de color.
const C = { bg: '#f6fbff', card: '#ffffff', border: '#dbeafe', text: '#0f172a', muted: '#64748b', brand: '#2563eb', red: '#dc2626', amber: '#b45309', green: '#15803d' };
const FONT = "Inter,-apple-system,'Segoe UI',sans-serif";
// El tono de un aviso se dice con la tarjeta entera —fondo suave y borde fino del mismo color en los
// cuatro lados—, como en el correo de Aquarius. Nada de barras de acento al costado: estan prohibidas
// en Lima Retail.
const TONO = {
  red:   { fg: '#b91c1c', bd: '#fecaca', box: '#fef2f2' },
  amber: { fg: '#b45309', bd: '#fde68a', box: '#fffbeb' },
  blue:  { fg: '#1d4ed8', bd: '#bfdbfe', box: '#eff6ff' },
};
const REPORTE_URL = config.url_dashboard.replace(/#.*$/, '').replace(/\/?$/, '/');

const tarjeta = (rotulo, valor, sub) => `
  <td width="33%" valign="top" style="padding:0 6px;">
    <table role="presentation" width="100%" style="border:1px solid ${C.border};border-radius:12px;border-collapse:separate;">
      <tr><td style="padding:14px 16px;font-family:${FONT};">
        <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};font-weight:700;">${esc(rotulo)}</div>
        <div style="font-size:22px;font-weight:700;color:${C.text};padding-top:4px;">${esc(valor)}</div>
        <div style="font-size:11px;color:${C.muted};padding-top:2px;">${esc(sub)}</div>
      </td></tr>
    </table>
  </td>`;

const filaBloque = b => {
  const costo = b.costo();
  const delta = b.previo ? signedPct((Number(b.valor) / Number(b.previo) - 1) * 100) : '—';
  return `<tr>
    <td style="padding:9px 12px;border-top:1px solid ${C.border};font-family:${FONT};font-size:13px;color:${C.text};font-weight:600;">${esc(b.etiqueta)}</td>
    <td align="right" style="padding:9px 12px;border-top:1px solid ${C.border};font-family:${FONT};font-size:13px;color:${C.text};">${money(grupos[b.grupo])}</td>
    <td align="right" style="padding:9px 12px;border-top:1px solid ${C.border};font-family:${FONT};font-size:13px;color:${C.text};">${count(b.valor)} <span style="color:${C.muted};font-size:11px;">${esc(b.unidad)}</span></td>
    <td align="right" style="padding:9px 12px;border-top:1px solid ${C.border};font-family:${FONT};font-size:13px;color:${C.muted};">${costo == null ? '—' : money(costo)}</td>
    <td align="right" style="padding:9px 12px;border-top:1px solid ${C.border};font-family:${FONT};font-size:12px;color:${C.muted};">${esc(delta)}</td>
  </tr>`;
};

const avisoHTML = a => {
  const t = TONO[a.tone] || TONO.blue;
  return `
  <tr><td style="padding:0 0 10px;">
    <table role="presentation" width="100%" style="border:1px solid ${t.bd};border-radius:10px;border-collapse:separate;background:${t.box};">
      <tr><td style="padding:12px 14px;font-family:${FONT};">
        <div style="font-size:13px;font-weight:700;color:${t.fg};">${esc(a.titulo)}</div>
        <div style="font-size:12px;color:${C.muted};padding-top:3px;line-height:1.5;">${esc(a.cuerpo)}</div>
      </td></tr>
    </table>
  </td></tr>`;
};

const htmlEmail = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:${C.bg};">
<table role="presentation" width="100%" style="background:${C.bg};"><tr><td align="center" style="padding:26px 12px;">
<table role="presentation" width="620" style="max-width:620px;">

  <tr><td style="padding:0 0 16px;font-family:${FONT};">
    <div style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:${C.muted};font-weight:700;">Lima Retail · Meta Ads</div>
    <div style="font-size:21px;font-weight:700;color:${C.text};padding-top:3px;">The Little Market · ${esc(mes.name)}</div>
    <div style="font-size:12px;color:${C.muted};padding-top:3px;">Datos al día ${diasCorridos} de ${diasMes}${completo ? ' · mes completo' : ''} · ${esc(NIVELES[nivel].label)}</div>
  </td></tr>

  <tr><td style="padding:0 0 14px;"><table role="presentation" width="100%"><tr>
    ${tarjeta('Inversión', money(K.spend), completo ? 'mes cerrado' : `cierre ${moneyCorto(gastoCierre)}`)}
    ${tarjeta('Compras', count(K.purchases), roasReal == null ? 'sin ventas' : `ROAS ${roasReal.toFixed(2)}`)}
    ${tarjeta('Conversaciones', count(K.conversations), costoConv == null ? '—' : `${money(costoConv)} c/u`)}
  </tr></table></td></tr>

  <tr><td style="padding:0 0 16px;">
    <table role="presentation" width="100%" style="border:1px solid ${C.border};border-radius:12px;border-collapse:separate;background:${C.card};">
      <tr>
        <td style="padding:11px 12px;font-family:${FONT};font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.muted};font-weight:700;">Objetivo</td>
        <td align="right" style="padding:11px 12px;font-family:${FONT};font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.muted};font-weight:700;">Inversión</td>
        <td align="right" style="padding:11px 12px;font-family:${FONT};font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.muted};font-weight:700;">Resultado</td>
        <td align="right" style="padding:11px 12px;font-family:${FONT};font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.muted};font-weight:700;">Costo</td>
        <td align="right" style="padding:11px 12px;font-family:${FONT};font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.muted};font-weight:700;">vs ${esc(previo ? previo.name.slice(0, 3) : '—')}</td>
      </tr>
      ${BLOQUES.map(filaBloque).join('')}
    </table>
  </td></tr>

  ${avisos.map(avisoHTML).join('')}

  <tr><td align="center" style="padding:18px 0 8px;">
    <a href="${REPORTE_URL}" style="display:inline-block;background:${C.brand};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:14px;font-weight:600;font-family:${FONT};">Ver el tablero de The Little Market</a>
  </td></tr>
  <tr><td align="center" style="padding:8px 0 0;font-size:11px;line-height:1.6;color:${C.muted};font-family:${FONT};">
    ${esc(config.workspace)} · alerta automática (${weekKey}): los lunes a las 7:00 a. m. y cada vez que entran datos nuevos.<br>
    Descargas de Meta Ads de la carpeta de Drive de The Little Market; el cierre proyectado usa el ritmo del mes.
  </td></tr>

</table></td></tr></table></body></html>`;

if (PREVIEW) {
  fs.writeFileSync(PREVIEW, htmlEmail, 'utf8');
  console.log(`\n🖼  Vista previa escrita en ${PREVIEW} (sin envío).\n`);
  process.exit(0);
}

const subject = `${NIVELES[nivel].txt} · ${mes.name} · ${count(K.purchases)} compras y ${count(K.conversations)} conversaciones · ${moneyCorto(K.spend)} · Lima Retail`;

// ── Destinatarios ────────────────────────────────────────────
async function destinatarios() {
  const url = process.env.TLM_ALERTAS_URL;
  const token = process.env.TLM_ALERTAS_TOKEN;
  const porDefecto = { lista: config.destinatarios || [], fuente: 'data/alertas-config.json' };
  if (!url || !token) return porDefecto;
  try {
    const res = await fetch(`${url}?token=${encodeURIComponent(token)}`);
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);
    if (!Array.isArray(body.destinatarios)) return { ...porDefecto, fuente: 'data/alertas-config.json (el tablero todavía no guardó una lista)' };
    return { lista: body.destinatarios, fuente: 'configuración del tablero' };
  } catch (error) {
    console.warn(`::warning::No se pudo leer la lista del tablero (${error.message}); se usa data/alertas-config.json`);
    return porDefecto;
  }
}

function registrarEnvio() {
  if (MOTIVO !== 'datos') enviosData.enviados[weekKey] = new Date().toISOString();
  enviosData.ultimaHuella = huella;
  enviosData.ultimoEnvio = { fecha: new Date().toISOString(), motivo: MOTIVO, mes: mes.name };
  fs.writeFileSync(enviosPath, JSON.stringify(enviosData, null, 2) + '\n', 'utf8');
  console.log(`📝 Registrado en alertas-envios.json: ${MOTIVO === 'datos' ? 'datos actualizados' : weekKey}\n`);
}

// El remitente es la misma cuenta que se autentica: los hostings rechazan un "From" de otra cuenta.
async function enviarSmtp(toList) {
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT) || 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const from = /@/.test(process.env.SMTP_USER) ? process.env.SMTP_USER : config.from_email;
  const info = await transporter.sendMail({ from: `${config.from_name} <${from}>`, to: toList, subject, html: htmlEmail });
  return info.messageId || '(sin id)';
}

(async () => {
  const { lista, fuente: fuenteLista } = await destinatarios();
  const para = lista.map(d => (d.nombre ? `${d.nombre} <${d.email}>` : d.email)).join(', ');

  if (DRY_RUN) {
    console.log('\n─────────────────────────────────────────');
    console.log('[DRY-RUN] Email que se enviaría:');
    console.log('  Asunto :', subject);
    console.log('  Para   :', para || '(nadie)', `· ${fuenteLista}`);
    console.log('  Tamaño :', Math.round(htmlEmail.length / 1024), 'KB');
    console.log('[DRY-RUN] Sin envíos reales. FIN.\n');
    return;
  }

  if (!lista.length) {
    console.log(`\n⏭  La lista de destinatarios está vacía (${fuenteLista}): no se envía.\n`);
    return;
  }

  const toList = lista.map(d => d.email);
  const smtp = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].every(name => process.env[name]);
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!smtp && !RESEND_KEY) {
    console.error('\n❌ Falta la configuración de envío: SMTP_HOST, SMTP_USER y SMTP_PASS, o RESEND_API_KEY.\n');
    process.exit(1);
  }

  console.log(`\n📧 Enviando a: ${para} (${fuenteLista})`);
  console.log(`   Asunto: ${subject}`);

  if (smtp) {
    const id = await enviarSmtp(toList);
    console.log(`\n✅ Email enviado por el correo del hosting (${process.env.SMTP_HOST}). ID: ${id}`);
    registrarEnvio();
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${config.from_name} <${config.from_email}>`, to: toList, subject, html: htmlEmail }),
  });
  const body = await res.json().catch(() => res.text());
  if (!res.ok) {
    console.error(`\n❌ Error Resend ${res.status}:`, JSON.stringify(body, null, 2));
    process.exit(1);
  }
  console.log(`\n✅ Email enviado. Resend ID: ${body.id || '(desconocido)'}`);
  registrarEnvio();
})().catch(error => {
  console.error('\n❌ Error fatal:', error.message);
  process.exit(1);
});

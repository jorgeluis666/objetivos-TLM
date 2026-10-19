(function () {
  // Catalogo de la carpeta de reportes de Drive, que regenera el workflow sync-ads-data.yml
  // (scripts/update-reports-catalog.py). Expone window.ReportsArchive = { init, latestReport }.
  const DATA_URL = 'data/tlm-drive-reports.json';
  const MONTHS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  // "mar" y "may" solo cuentan pegados al ano, para no confundirlos con palabras ("The Little Market").
  const MONTH_PATTERNS = [
    { index: 0, re: /\bene(?:ro)?\b/ },
    { index: 1, re: /\bfeb(?:rero)?\b/ },
    { index: 2, re: /\b(?:marzo|mar(?= 20\d{2}\b))/ },
    { index: 3, re: /\babr(?:il)?\b/ },
    { index: 4, re: /\b(?:mayo|may(?= 20\d{2}\b))/ },
    { index: 5, re: /\bjun(?:io)?\b/ },
    { index: 6, re: /\bjul(?:io)?\b/ },
    { index: 7, re: /\bago(?:sto)?\b/ },
    { index: 8, re: /\b(?:sep|set)(?:t?iembre)?\b/ },
    { index: 9, re: /\boct(?:ubre)?\b/ },
    { index: 10, re: /\bnov(?:iembre)?\b/ },
    { index: 11, re: /\bdic(?:iembre)?\b/ },
  ];
  const TYPES = {
    weekly: { id: 'weekly', label: 'Reporte semanal', tone: 'green' },
    monthly: { id: 'monthly', label: 'Reporte mensual', tone: 'blue' },
    partial: { id: 'partial', label: 'Reporte parcial', tone: 'amber' },
    proposal: { id: 'proposal', label: 'Propuesta', tone: 'violet' },
    audiovisual: { id: 'audiovisual', label: 'Material audiovisual', tone: 'green' },
    recommendations: { id: 'recommendations', label: 'Recomendaciones', tone: 'rose' },
    other: { id: 'other', label: 'Otros documentos', tone: 'slate' },
  };

  const state = {
    ready: false,
    loading: null,
    folder: null,
    syncedAt: '',
    reports: [],
    filters: { search: '', type: 'all', period: 'all', latestOnly: false },
    sort: 'recent',
    lastFocus: null,
  };

  const els = {};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  const EXTENSION_RE = /\.(pdf|mp4|mov|avi|png|jpe?g|gif|xlsx?|csv|docx?|pptx?|zip)$/i;

  // Los archivos nativos de Google no tienen extension en el titulo ni se descargan
  // por /uc?export=download: se exportan a PDF desde su propia app.
  const GOOGLE_NATIVE = {
    'application/vnd.google-apps.presentation': { slug: 'presentation', label: 'SLIDES', exportPath: 'export/pdf' },
    'application/vnd.google-apps.document': { slug: 'document', label: 'DOCS', exportPath: 'export?format=pdf' },
    'application/vnd.google-apps.spreadsheet': { slug: 'spreadsheets', label: 'SHEETS', exportPath: 'export?format=pdf' },
  };

  function stripExtension(title) {
    let value = String(title || '');
    while (EXTENSION_RE.test(value)) value = value.replace(EXTENSION_RE, '');
    return value;
  }

  // "The-Little-Market-Reporte-Ads-1-4-Octubre-2026" -> "Reporte Ads 1-4 Octubre 2026"
  function prettyName(title) {
    return stripExtension(title)
      .replace(/^the[-_ ]little[-_ ]market[-_ ]*/i, '')
      .replace(/(\d)-(\d)/g, '$1~$2')
      .replace(/[-_]+/g, ' ')
      .replace(/~/g, '-')
      .replace(/(\d)(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)/gi, '$1 $2')
      .replace(/([a-z])(20\d{2})\b/gi, '$1 $2')
      .replace(/\s{2,}/g, ' ')
      .trim() || stripExtension(title);
  }

  function cleanText(title) {
    // Sin el nombre de la marca: "Market" no debe leerse como "mar".
    return normalize(stripExtension(title))
      .replace(/the[-_ ]little[-_ ]market/g, ' ')
      .replace(/[_.-]+/g, ' ')
      .replace(/(\d)([a-z])/g, '$1 $2')
      .replace(/([a-z])(\d)/g, '$1 $2');
  }

  function detectPeriod(title) {
    const text = cleanText(title);
    const yearMatch = text.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const monthHit = MONTH_PATTERNS.find(pattern => pattern.re.test(text));
    if (!monthHit || !year) return null;
    const label = `${MONTHS[monthHit.index].charAt(0).toUpperCase()}${MONTHS[monthHit.index].slice(1)} ${year}`;
    return { key: `${year}-${String(monthHit.index + 1).padStart(2, '0')}`, label, year, month: monthHit.index + 1 };
  }

  // "1-4 Octubre" (los guiones del nombre ya se volvieron espacios: "1 4 octubre 2026").
  function detectRange(title) {
    const raw = normalize(stripExtension(title)).replace(/the[-_ ]little[-_ ]market/g, ' ');
    const match = raw.match(/(?:^|[^\d])(\d{1,2})\s*[-_]\s*(\d{1,2})(?=\s*[-_ ]?\s*[a-z])/);
    if (!match || Number(match[1]) > Number(match[2])) return null;
    return `Del ${Number(match[1])} al ${Number(match[2])}`;
  }

  function detectType(title, mimeType, range) {
    const text = normalize(title);
    if (String(mimeType).startsWith('video/')) return TYPES.audiovisual;
    if (text.includes('propuesta')) return TYPES.proposal;
    if (text.includes('recomendacion')) return TYPES.recommendations;
    if (text.includes('semanal') || text.includes('semana')) return TYPES.weekly;
    if (range) return TYPES.partial;
    if (text.includes('reporte') || detectPeriod(title)) return TYPES.monthly;
    return TYPES.other;
  }

  function formatSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '--';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function toDate(iso) {
    const value = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? `${iso}T12:00:00` : iso;
    return new Date(value);
  }

  function formatDate(iso) {
    const date = toDate(iso);
    if (Number.isNaN(date.getTime())) return '--';
    return `${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)} ${date.getFullYear()}`;
  }

  function formatLongDate(iso) {
    const date = toDate(iso);
    if (Number.isNaN(date.getTime())) return '--';
    return `${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
  }

  function buildReports(files) {
    const reports = (files || []).filter(file => DRIVE_ID_RE.test(file.id || '')).map(file => {
      const range = detectRange(file.title);
      const period = detectPeriod(file.title);
      const type = detectType(file.title, file.mimeType, range);
      const isVideo = String(file.mimeType).startsWith('video/');
      const native = GOOGLE_NATIVE[file.mimeType] || null;
      const extension = (stripExtension(file.title) === file.title ? '' : file.title.split('.').pop() || '').toUpperCase();

      return {
        id: file.id,
        title: file.title,
        mimeType: file.mimeType,
        name: prettyName(file.title).replace(/\s*\(\d+\)\s*$/, '').trim(),
        type,
        period,
        range,
        format: extension || (isVideo ? 'MP4' : native ? native.label : 'PDF'),
        isVideo,
        sizeBytes: Number(file.sizeBytes) || 0,
        modifiedTime: file.modifiedTime,
        createdTime: file.createdTime,
        viewUrl: `https://drive.google.com/file/d/${file.id}/view`,
        previewUrl: native
          ? `https://docs.google.com/${native.slug}/d/${file.id}/preview`
          : `https://drive.google.com/file/d/${file.id}/preview`,
        downloadUrl: native
          ? `https://docs.google.com/${native.slug}/d/${file.id}/${native.exportPath}`
          : `https://drive.google.com/uc?export=download&id=${file.id}`,
        latest: true,
      };
    });

    // Varias subidas comparten nombre en Drive: solo la mas reciente queda marcada como vigente.
    const groups = new Map();
    reports.forEach(report => {
      const key = `${report.type.id}|${report.period ? report.period.key : 'sin-periodo'}|${normalize(report.name)}|${report.range || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(report);
    });
    groups.forEach(group => {
      group.sort((a, b) => toDate(b.modifiedTime) - toDate(a.modifiedTime));
      group.forEach((report, index) => {
        report.latest = index === 0;
        report.versions = group.length;
      });
    });

    return reports.sort((a, b) => toDate(b.modifiedTime) - toDate(a.modifiedTime));
  }

  function visibleReports() {
    const search = normalize(state.filters.search).trim();
    const list = state.reports.filter(report => {
      if (state.filters.type !== 'all' && report.type.id !== state.filters.type) return false;
      if (state.filters.period !== 'all') {
        const key = report.period ? report.period.key : 'sin-periodo';
        if (key !== state.filters.period) return false;
      }
      if (state.filters.latestOnly && !report.latest) return false;
      if (!search) return true;
      return normalize(`${report.title} ${report.name} ${report.type.label} ${report.period ? report.period.label : ''}`).includes(search);
    });

    const sorters = {
      recent: (a, b) => toDate(b.modifiedTime) - toDate(a.modifiedTime),
      oldest: (a, b) => toDate(a.modifiedTime) - toDate(b.modifiedTime),
      name: (a, b) => a.name.localeCompare(b.name, 'es'),
      size: (a, b) => b.sizeBytes - a.sizeBytes,
    };
    return list.sort(sorters[state.sort] || sorters.recent);
  }

  function renderKpis() {
    if (!els.kpis) return;
    const total = state.reports.length;
    const campaignReports = state.reports.filter(report => ['weekly', 'monthly', 'partial'].includes(report.type.id)).length;
    const latest = state.reports.filter(report => report.latest).length;
    const newest = state.reports[0];
    const weight = state.reports.reduce((sum, report) => sum + report.sizeBytes, 0);

    const cards = [
      { label: 'Archivos en la carpeta', value: String(total), hint: `${latest} vigentes + ${total - latest} versiones anteriores` },
      { label: 'Reportes de campana', value: String(campaignReports), hint: 'Semanales, mensuales y parciales' },
      { label: 'Ultimo documento', value: newest ? formatDate(newest.modifiedTime) : '--', hint: newest ? newest.name : 'Sin registros' },
      { label: 'Peso del archivo', value: formatSize(weight), hint: 'Total almacenado en Drive' },
    ];

    els.kpis.innerHTML = cards.map(card => `
      <div class="kpi-pill">
        <span>${esc(card.label)}</span>
        <strong>${esc(card.value)}</strong>
        <small>${esc(card.hint)}</small>
      </div>
    `).join('');
  }

  function renderFilterOptions() {
    if (els.typeFilter) {
      const used = [];
      state.reports.forEach(report => {
        if (!used.some(type => type.id === report.type.id)) used.push(report.type);
      });
      els.typeFilter.innerHTML = ['<option value="all">Todos los tipos</option>']
        .concat(used.map(type => `<option value="${type.id}"${state.filters.type === type.id ? ' selected' : ''}>${esc(type.label)}</option>`))
        .join('');
    }

    if (els.periodFilter) {
      const periods = [];
      state.reports.forEach(report => {
        const key = report.period ? report.period.key : 'sin-periodo';
        const label = report.period ? report.period.label : 'Sin periodo';
        if (!periods.some(period => period.key === key)) periods.push({ key, label });
      });
      periods.sort((a, b) => (a.key === 'sin-periodo' ? 1 : b.key === 'sin-periodo' ? -1 : b.key.localeCompare(a.key)));
      els.periodFilter.innerHTML = ['<option value="all">Todos los periodos</option>']
        .concat(periods.map(period => `<option value="${period.key}"${state.filters.period === period.key ? ' selected' : ''}>${esc(period.label)}</option>`))
        .join('');
    }
  }

  function renderTable() {
    if (!els.body) return;
    const rows = visibleReports();

    els.count.textContent = rows.length === state.reports.length
      ? `${state.reports.length} ${state.reports.length === 1 ? 'documento sincronizado' : 'documentos sincronizados'} el ${formatLongDate(state.syncedAt)}`
      : `${rows.length} de ${state.reports.length} documentos`;

    if (!state.reports.length) {
      els.body.innerHTML = '<tr><td class="table-empty" colspan="7">La carpeta de reportes todavia no tiene documentos.</td></tr>';
      return;
    }
    if (!rows.length) {
      els.body.innerHTML = '<tr><td class="table-empty" colspan="7">No hay documentos que coincidan con el filtro.</td></tr>';
      return;
    }

    els.body.innerHTML = rows.map(report => `
      <tr>
        <td class="report-name-col">
          <span class="report-name">${esc(report.name)}</span>
          <span class="report-file">${esc(report.title)}</span>
        </td>
        <td><span class="type-pill ${report.type.tone}">${esc(report.type.label)}</span></td>
        <td class="date-col">${report.period ? esc(report.period.label) : '<span class="no-data">Sin periodo</span>'}${report.range ? `<span class="report-range">${esc(report.range)}</span>` : ''}</td>
        <td><span class="format-tag ${report.isVideo ? 'video' : 'pdf'}">${esc(report.format)}</span></td>
        <td class="num">${formatSize(report.sizeBytes)}</td>
        <td class="date-col">${formatDate(report.modifiedTime)}${report.latest ? '<span class="version-flag current">Version vigente</span>' : '<span class="version-flag old">Version anterior</span>'}</td>
        <td>
          <div class="report-actions">
            <button type="button" class="report-btn primary" data-preview="${esc(report.id)}">Ver</button>
            <a class="report-btn" href="${esc(report.viewUrl)}" target="_blank" rel="noopener">Drive</a>
            <a class="report-btn" href="${esc(report.downloadUrl)}" target="_blank" rel="noopener">Descargar</a>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function render() {
    renderKpis();
    renderFilterOptions();
    renderTable();
  }

  function openPreview(reportId) {
    const report = state.reports.find(item => item.id === reportId);
    if (!report || !els.modal) return;
    state.lastFocus = document.activeElement;
    els.modalTitle.textContent = report.name;
    els.modalSub.textContent = `${report.type.label}${report.period ? ` | ${report.period.label}` : ''} | ${report.format} | ${formatSize(report.sizeBytes)}`;
    els.modalLink.href = report.viewUrl;
    els.modalDownload.href = report.downloadUrl;
    els.modalFrame.src = report.previewUrl;
    els.modal.classList.add('visible');
    els.modal.removeAttribute('aria-hidden');
    document.querySelector('.shell')?.setAttribute('inert', '');
    document.body.classList.add('modal-open');
    els.modal.querySelector('[data-close-preview]')?.focus();
  }

  function closePreview() {
    if (!els.modal || !els.modal.classList.contains('visible')) return;
    els.modal.classList.remove('visible');
    els.modal.setAttribute('aria-hidden', 'true');
    els.modalFrame.src = 'about:blank';
    document.querySelector('.shell')?.removeAttribute('inert');
    document.body.classList.remove('modal-open');
    state.lastFocus?.focus?.();
  }

  function bindEvents() {
    els.search?.addEventListener('input', event => {
      state.filters.search = event.target.value;
      renderTable();
    });
    els.typeFilter?.addEventListener('change', event => {
      state.filters.type = event.target.value;
      renderTable();
    });
    els.periodFilter?.addEventListener('change', event => {
      state.filters.period = event.target.value;
      renderTable();
    });
    els.sortFilter?.addEventListener('change', event => {
      state.sort = event.target.value;
      renderTable();
    });
    els.latestOnly?.addEventListener('change', event => {
      state.filters.latestOnly = event.target.checked;
      renderTable();
    });
    els.body?.addEventListener('click', event => {
      const button = event.target.closest('[data-preview]');
      if (button) openPreview(button.dataset.preview);
    });
    els.modal?.addEventListener('click', event => {
      if (event.target === els.modal || event.target.closest('[data-close-preview]')) closePreview();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closePreview();
      // El foco no sale del modal mientras esta abierto.
      if (event.key === 'Tab' && els.modal?.classList.contains('visible')) {
        const focusable = [...els.modal.querySelectorAll('a[href], button, iframe')];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
  }

  async function loadData() {
    if (window.TLM_DRIVE_REPORTS) return window.TLM_DRIVE_REPORTS;
    const response = await fetch(`${DATA_URL}?cb=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  // Carga el catalogo una sola vez (lo comparten la tabla y el Generador de reporte).
  function ensureData() {
    if (!state.loading) {
      state.loading = loadData().then(data => {
        state.folder = data.folder || null;
        state.syncedAt = data.syncedAt || '';
        state.reports = buildReports(data.files);
        return state.reports;
      });
      state.loading.catch(() => { state.loading = null; });
    }
    return state.loading;
  }

  // El ultimo reporte de campana subido: es el modelo del Generador de reporte semanal.
  async function latestReport() {
    const reports = await ensureData().catch(() => []);
    return reports.find(report => report.latest && ['weekly', 'monthly', 'partial'].includes(report.type.id) && report.format === 'PDF') || null;
  }

  async function init() {
    if (state.ready) return;
    els.kpis = document.getElementById('reports-kpis');
    els.body = document.getElementById('reports-body');
    els.count = document.getElementById('reports-count');
    els.search = document.getElementById('reports-search');
    els.typeFilter = document.getElementById('reports-type');
    els.periodFilter = document.getElementById('reports-period');
    els.sortFilter = document.getElementById('reports-sort');
    els.latestOnly = document.getElementById('reports-latest-only');
    els.folderLink = document.getElementById('reports-folder-link');
    els.modal = document.getElementById('reports-modal');
    els.modalTitle = document.getElementById('reports-modal-title');
    els.modalSub = document.getElementById('reports-modal-sub');
    els.modalFrame = document.getElementById('reports-modal-frame');
    els.modalLink = document.getElementById('reports-modal-link');
    els.modalDownload = document.getElementById('reports-modal-download');

    try {
      await ensureData();
      if (state.ready) return;
      if (els.folderLink && DRIVE_ID_RE.test(state.folder?.id || '')) els.folderLink.href = `https://drive.google.com/drive/folders/${state.folder.id}`;
      bindEvents();
      render();
      state.ready = true;
    } catch (error) {
      if (els.body) {
        els.body.innerHTML = `<tr><td class="table-empty" colspan="7">No se pudo cargar el archivo de reportes (${esc(error.message)}).</td></tr>`;
      }
    }
  }

  window.ReportsArchive = { init, latestReport };
})();

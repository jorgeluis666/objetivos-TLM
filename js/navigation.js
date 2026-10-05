(function () {
  const VIEW_KEY = 'tlm-active-view';
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  // La fecha de corte sale de los datos sincronizados (cambia con cada sincronizacion con Drive).
  function snapshot() {
    return window.TLMObjectives?.snapshot?.() || null;
  }
  function cutoffLabel() {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(snapshot()?.cutoff || '');
    return match ? `${Number(match[3])} de ${MONTHS[Number(match[2]) - 1]}` : '...';
  }
  function lastClosedLabel() {
    const closed = (snapshot()?.months || []).filter(month => month.status === 'cerrado');
    const last = closed[closed.length - 1];
    return last ? `Cierre de ${last.name.toLowerCase()}` : 'Sin meses cerrados';
  }
  const VIEW_META = {
    'view-obj': {
      title: 'Gasto publicitario 2026',
      caption: 'Agencia Lima Retail',
      status: () => `Datos al ${cutoffLabel()}`,
      source: 'Fuente: Meta Ads / exportaciones mensuales en Google Drive',
      footer: 'Sincronizado por Agencia Lima Retail',
    },
    'view-messages': {
      title: 'Proyecciones',
      caption: 'Cierre del mes en curso en Meta Ads',
      status: () => `Proyección sobre datos al ${cutoffLabel()}`,
      source: 'Fuente: Gasto publicitario / The Little Market',
      footer: 'Proyección lineal según el ritmo diario del mes',
    },
    'view-history': {
      title: 'Histórico de Campañas',
      caption: 'Campañas de meses cerrados',
      status: lastClosedLabel,
      source: 'Fuente: Meta Ads / Histórico consolidado',
      footer: 'Solo meses cerrados',
    },
    'view-log': {
      title: 'Bitácora',
      caption: 'Checklist de cambios, comentarios y decisiones',
      status: 'Editable',
      source: 'Fuente: registro de Agencia Lima Retail',
      footer: 'Las ediciones quedan como borrador hasta exportar y publicar el archivo',
    },
  };

  function storedView() {
    try {
      const value = window.localStorage.getItem(VIEW_KEY);
      return VIEW_META[value] ? value : 'view-obj';
    } catch {
      return 'view-obj';
    }
  }

  function saveView(viewId) {
    try {
      window.localStorage.setItem(VIEW_KEY, viewId);
    } catch {
      // La navegación sigue funcionando aunque localStorage no esté disponible.
    }
  }

  function showView(viewId) {
    const meta = VIEW_META[viewId] || VIEW_META['view-obj'];
    document.querySelectorAll('.view').forEach(view => {
      view.classList.toggle('visible', view.id === viewId);
    });
    document.querySelectorAll('[data-view-target]').forEach(button => {
      const active = button.dataset.viewTarget === viewId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });

    document.getElementById('topbar-title').textContent = meta.title;
    document.getElementById('topbar-caption').textContent = meta.caption;
    document.getElementById('topbar-status').textContent = typeof meta.status === 'function' ? meta.status() : meta.status;
    document.getElementById('footer-source').textContent = meta.source;
    document.getElementById('footer-status').textContent = meta.footer;
    saveView(viewId);

    if (viewId === 'view-messages') {
      window.TLMProjections?.init();
      window.setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
    }
    if (viewId === 'view-obj') window.setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
    if (viewId === 'view-history') window.TLMObjectives?.renderHistory?.();
    if (viewId === 'view-log') window.TLMBitacora?.init();
  }

  function initNavigation() {
    document.querySelectorAll('[data-view-target]').forEach(button => {
      button.addEventListener('click', () => showView(button.dataset.viewTarget));
    });
    showView(storedView());
    // Los datos llegan despues de la navegacion (y cambian al sincronizar): refresca la fecha de corte.
    window.addEventListener('tlm:data-updated', () => {
      const meta = VIEW_META[storedView()];
      if (typeof meta?.status === 'function') document.getElementById('topbar-status').textContent = meta.status();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavigation);
  } else {
    initNavigation();
  }
})();

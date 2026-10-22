(function () {
  const VIEW_KEY = 'tlm-active-view';
  const VIEW_META = {
    'view-obj': {
      title: 'Gasto publicitario 2026',
      source: 'Fuente: Meta Ads / exportaciones mensuales en Google Drive',
      footer: 'Sincronizado por Agencia Lima Retail',
    },
    'view-messages': {
      title: 'Proyecciones',
      source: 'Fuente: Gasto publicitario / The Little Market',
      footer: 'Proyección lineal según el ritmo diario del mes',
    },
    'view-history': {
      title: 'Histórico de Campañas',
      source: 'Fuente: Meta Ads / Histórico consolidado',
      footer: 'Solo meses cerrados',
    },
    'view-reports': {
      title: 'Archivo de Reportes',
      source: 'Fuente: carpeta de reportes en Google Drive / Meta Ads por día',
      footer: 'Sincronizado por Agencia Lima Retail',
    },
    'view-log': {
      title: 'Bitácora',
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
    // La bajada repite la descripcion del modulo en el panel lateral, como en Royal Baby.
    const desc = document.querySelector(`[data-view-target="${viewId}"] .s-desc-nav`);
    document.getElementById('topbar-caption').textContent = desc ? desc.textContent.trim() : '';
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
    if (viewId === 'view-reports') showReportsTab(storedReportsTab());
  }

  // Archivo de Reportes: pestanas Documentos y Generar reporte semanal.
  const REPORTS_TAB_KEY = 'tlm-reports-tab';
  function storedReportsTab() {
    try {
      return window.localStorage.getItem(REPORTS_TAB_KEY) === 'week' ? 'week' : 'docs';
    } catch {
      return 'docs';
    }
  }
  function showReportsTab(tab) {
    document.querySelectorAll('[data-reports-tab]').forEach(button => {
      const active = button.dataset.reportsTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      document.getElementById(button.getAttribute('aria-controls')).hidden = !active;
    });
    try {
      window.localStorage.setItem(REPORTS_TAB_KEY, tab);
    } catch {
      // Sin localStorage la pestana vuelve a Documentos al recargar.
    }
    window.ReportsArchive?.init();
    if (tab === 'week') window.TLMReportWeek?.init();
  }

  function initNavigation() {
    document.querySelectorAll('[data-view-target]').forEach(button => {
      button.addEventListener('click', () => showView(button.dataset.viewTarget));
    });
    const tabs = [...document.querySelectorAll('[data-reports-tab]')];
    tabs.forEach((button, index) => {
      button.addEventListener('click', () => showReportsTab(button.dataset.reportsTab));
      button.addEventListener('keydown', event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        showReportsTab(next.dataset.reportsTab);
        next.focus();
      });
    });
    // La pildora de sincronizacion de la barra superior la maneja js/objectives.js (es la misma en todas las vistas).
    showView(storedView());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavigation);
  } else {
    initNavigation();
  }
})();

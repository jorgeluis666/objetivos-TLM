/**
 * auth-login.js — Pantalla de acceso reutilizable
 */
(function (global) {
  'use strict';
  const CSS = `
    #rb-auth-overlay{position:fixed;inset:0;z-index:99999;display:flex;overflow:hidden;background:#0f172a}
    #rb-auth-overlay.rb-auth-hidden{display:none}
    #rb-auth-panel{width:400px;max-width:100%;flex-shrink:0;background:#fff;display:flex;align-items:center;justify-content:center;padding:48px 44px;box-sizing:border-box;overflow-y:auto}
    #rb-auth-inner{width:100%;max-width:312px}
    #rb-auth-brand{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--rb-accent,#2563eb);margin-bottom:16px;font-family:inherit}
    #rb-auth-title{font-size:38px;font-weight:700;line-height:1.1;letter-spacing:-.02em;color:#0f172a;margin-bottom:28px;white-space:pre-line;font-family:inherit}
    #rb-auth-divider{width:40px;height:3px;background:var(--rb-accent,#2563eb);border-radius:2px;margin-bottom:36px}
    #rb-auth-form{display:flex;flex-direction:column;gap:12px}
    #rb-auth-input{width:100%;padding:12px 16px;border-radius:8px;border:1.5px solid #dce3ef;background:#e8f0fe;color:#0f172a;font-size:14px;outline:none;transition:border-color .15s;font-family:inherit;box-sizing:border-box}
    #rb-auth-input::placeholder{color:#64748b}#rb-auth-input:focus{border-color:var(--rb-accent,#2563eb)}
    #rb-auth-btn{width:100%;padding:12px;border-radius:8px;border:none;background:var(--rb-accent,#2563eb);color:#fff;font-size:14px;font-weight:600;cursor:pointer;letter-spacing:.02em;transition:background .15s;font-family:inherit}
    #rb-auth-btn:hover{background:var(--rb-accent-dark,#1d4ed8)}
    #rb-auth-error{display:none;margin-top:12px;font-size:12px;color:#dc2626;font-family:inherit}
    /* El degradado es la capa de respaldo: si la imagen falta o falla, el panel
       derecho sigue siendo opaco y nunca deja ver el dashboard detras. */
    #rb-auth-bg{flex:1;min-width:0;align-self:stretch;background-color:#0f172a;background-image:linear-gradient(140deg,var(--rb-accent,#2563eb) 0%,var(--rb-accent-dark,#1d4ed8) 38%,#0f172a 100%);background-size:cover;background-position:center;background-repeat:no-repeat;filter:grayscale(20%)}
    @media (max-width:768px){
      #rb-auth-panel{width:100%;padding:32px 24px}
      #rb-auth-inner{max-width:360px}
      #rb-auth-title{font-size:30px;margin-bottom:22px}
      #rb-auth-divider{margin-bottom:26px}
      #rb-auth-bg{display:none}
    }
    @media (max-height:520px){
      #rb-auth-panel{align-items:flex-start;padding:24px}
      #rb-auth-title{font-size:26px;margin-bottom:18px}
      #rb-auth-divider{margin-bottom:20px}
    }
  `;
  // Oscurece un hex #rrggbb el porcentaje indicado; se usa para el hover del boton.
  function darken(hex, amount) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!match) return hex;
    const value = parseInt(match[1], 16);
    const channel = shift => Math.round(((value >> shift) & 255) * (1 - amount));
    return `#${[channel(16), channel(8), channel(0)].map(n => n.toString(16).padStart(2, '0')).join('')}`;
  }
  function init(opts) {
    opts = opts || {};
    const PASSWORD = opts.password || 'RB2026';
    const BG_IMAGE = opts.bgImage || 'login-bg.jpg';
    const BRAND = opts.brand || 'Lima Retail';
    const TITLE = opts.title || 'Centro de\nControl';
    const SESSION_KEY = opts.sessionKey || 'rb_auth';
    // Azul de LR Suite: el mismo en todas las pantallas de acceso.
    const ACCENT = opts.accent || '#2563eb';
    const ACCENT_DARK = opts.accentDark || (opts.accent ? darken(ACCENT, .18) : '#1d4ed8');
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const overlay = document.createElement('div');
    overlay.id = 'rb-auth-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Acceso');
    overlay.innerHTML = `<div id="rb-auth-panel"><div id="rb-auth-inner"><div id="rb-auth-brand">${BRAND}</div><div id="rb-auth-title">${TITLE}</div><div id="rb-auth-divider"></div><form id="rb-auth-form" autocomplete="off"><input id="rb-auth-input" type="password" placeholder="Contraseña" aria-label="Contraseña" autocomplete="new-password" autofocus /><button type="submit" id="rb-auth-btn">Ingresar</button></form><div id="rb-auth-error" role="alert">Contraseña incorrecta</div></div></div><div id="rb-auth-bg"></div>`;
    overlay.style.setProperty('--rb-accent', ACCENT);
    overlay.style.setProperty('--rb-accent-dark', ACCENT_DARK);
    document.body.insertBefore(overlay, document.body.firstChild);
    // La imagen solo se aplica cuando termino de cargar; si da 404 queda el degradado.
    const background = new Image();
    background.onload = function () {
      document.getElementById('rb-auth-bg').style.backgroundImage = `url('${BG_IMAGE}')`;
    };
    background.src = BG_IMAGE;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    function unlock() {
      overlay.classList.add('rb-auth-hidden');
      document.documentElement.style.overflow = previousOverflow;
      sessionStorage.setItem(SESSION_KEY, '1');
    }
    if (sessionStorage.getItem(SESSION_KEY) === '1') { unlock(); return; }
    document.getElementById('rb-auth-form').addEventListener('submit', function (event) {
      event.preventDefault();
      const input = document.getElementById('rb-auth-input');
      const error = document.getElementById('rb-auth-error');
      if (input.value === PASSWORD) { error.style.display = 'none'; unlock(); }
      else { input.value = ''; error.style.display = 'block'; input.focus(); }
    });
  }
  global.AuthLogin = { init };
})(window);

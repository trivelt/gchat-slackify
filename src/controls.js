// @ts-check
/*
 * controls.js — injects self-owned "Hide meetings" switches into Google Chat's Home filter row and
 * the Direct messages sidebar header. Both flip prefs.features.hidemeetings in chrome.storage.sync
 * — exactly what the popup writes — so apply.js's existing storage listener reacts and the generated
 * CSS hides/shows meeting rows. No new permissions (storage only), no network. The popup toggle
 * keeps working unchanged; these are just in-context entry points.
 *
 * PERFORMANCE / SAFETY CONTRACT (CLAUDE.md — "host app must never break", lightweight doctrine):
 *   - Self-owned nodes only. We NEVER mutate Google's internals — we insert our controls beside
 *     Chat's own header/filter nodes, and remove only our own nodes.
 *   - The MutationObserver callback is O(1): set a dirty flag + schedule. All real work runs in
 *     requestIdleCallback, throttled to one pass per idle slot.
 *   - Steady-state cost is only `isConnected` checks: when controls are already in place the idle
 *     pass does not search for their anchors.
 *   - Anchor lookups (the only layout reads) run ONLY when a control is missing — i.e. first paint
 *     and view/sidebar navigation, not while both controls are already mounted.
 *   - Everything is try/caught. If an anchor can't be found (other view, non-English UI, Google
 *     reshuffle) we simply don't inject that control — the host is untouched. Fail-safe by construction.
 */
;(function () {
  const C = globalThis.SLACKIFY_CONFIG;
  if (!C) return;

  const TAG = 'meetings-toggle';
  const FEAT = 'hidemeetings';

  // ---- preferences mirror (kept in sync with chrome.storage.sync) ----
  /** @type {{ enabled: boolean, features: Record<string, boolean> }} */
  let prefs = { enabled: C.DEFAULT_PREFS.enabled, features: Object.assign({}, C.DEFAULT_PREFS.features) };
  /** @param {() => void} [cb] */
  function readPrefs(cb) {
    try {
      chrome.storage.sync.get('prefs', (res) => {
        const d = C.DEFAULT_PREFS;
        const saved = /** @type {Partial<SfPrefs>} */ ((res && res.prefs) || {});
        prefs = {
          enabled: saved.enabled !== undefined ? saved.enabled : d.enabled,
          features: Object.assign({}, d.features, saved.features || {}),
        };
        if (cb) cb();
      });
    } catch (e) { if (cb) cb(); }   // not an extension context → keep defaults
  }
  // Read-modify-write so we never clobber other prefs (theme, other features) written elsewhere.
  /** @param {boolean} on */
  function writeFeat(on) {
    prefs.features[FEAT] = on;
    try {
      chrome.storage.sync.get('prefs', (res) => {
        const p = /** @type {Partial<SfPrefs>} */ (Object.assign({}, (res && res.prefs) || {}));
        p.features = Object.assign({}, p.features || {}, { [FEAT]: on });
        try { chrome.storage.sync.set({ prefs: p }); } catch (e) {}
      });
    } catch (e) {}
  }

  // ---- self-owned styles (injected once) ----
  const STYLE_ID = 'slackify-controls-style';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    // Neutral palette that reads on both light & dark headers: label inherits the header's text
    // color; the track is a theme-agnostic translucent grey; the "on" accent is Google blue.
    st.textContent =
      `[data-slackify="${TAG}"]{display:inline-flex;align-items:center;gap:7px;margin:0 10px;font:inherit;color:inherit;white-space:nowrap;-webkit-user-select:none;user-select:none;}` +
      `[data-slackify="${TAG}"][data-sf-place="sidebar"]{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:42px;min-width:42px;height:32px;flex:0 0 42px;margin:0 14px 0 0!important;gap:0;position:relative;z-index:2;background-color:transparent!important;opacity:1!important;visibility:visible!important;}` +
      `[data-slackify="${TAG}"] .sf-mt-label{font-size:13px;opacity:.92;}` +
      `[data-slackify="${TAG}"][data-sf-place="sidebar"] .sf-mt-label{display:none!important;}` +
      `[data-slackify="${TAG}"] .sf-mt-sw{display:block!important;position:relative;width:34px;height:18px;border-radius:9px;border:none;padding:0;margin:0;cursor:pointer;background-color:rgba(128,128,128,.45)!important;transition:background-color .15s ease;flex:0 0 auto;appearance:none;-webkit-appearance:none;opacity:1!important;visibility:visible!important;}` +
      `[data-slackify="${TAG}"] .sf-mt-sw:focus-visible{outline:2px solid #1a73e8;outline-offset:2px;}` +
      `[data-slackify="${TAG}"] .sf-mt-sw[aria-checked="true"]{background-color:#1a73e8!important;}` +
      `[data-slackify="${TAG}"] .sf-mt-knob{display:block!important;position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background-color:#fff!important;transition:transform .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.3);pointer-events:none;opacity:1!important;visibility:visible!important;}` +
      `[data-slackify="${TAG}"] .sf-mt-sw[aria-checked="true"] .sf-mt-knob{transform:translateX(16px);}` +
      `[data-slackify="meetings-tooltip"]{position:fixed;z-index:2147483647;max-width:260px;padding:6px 8px;border-radius:4px;background-color:#1f1f1f!important;color:#fff!important;font:500 12px/1.35 var(--sf-font,Arial,sans-serif);box-shadow:0 4px 14px rgba(0,0,0,.24);pointer-events:none;opacity:0;transform:translate(-50%,4px);transition:opacity .08s ease,transform .08s ease;white-space:normal;}` +
      `[data-slackify="meetings-tooltip"][data-sf-show]{opacity:1;transform:translate(-50%,0);}`;
    st.textContent +=
      `html[data-sf-on][data-sf-feat-sidebar] [data-slackify="rail"] [data-slackify="${TAG}"][data-sf-place="sidebar"] button.sf-mt-sw{background-color:rgba(209,210,211,.35)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)!important;}` +
      `html[data-sf-on][data-sf-feat-sidebar] [data-slackify="rail"] [data-slackify="${TAG}"][data-sf-place="sidebar"] button.sf-mt-sw[aria-checked="true"]{background-color:#1a73e8!important;box-shadow:none!important;}` +
      `html[data-sf-on][data-sf-feat-sidebar] [data-slackify="rail"] [data-slackify="${TAG}"][data-sf-place="sidebar"] .sf-mt-knob{background-color:#fff!important;}`;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- build controls once; the same nodes are re-inserted across re-renders ----
  /** @type {Record<string, { el: HTMLElement, btn: HTMLButtonElement }>} */
  const controls = {};
  const helpText = {
    home: 'Hide meeting/calendar conversations from Home and Direct messages.',
    sidebar: 'Hide meeting/calendar conversations from Direct messages.',
  };
  /** @type {HTMLElement|null} */
  let tooltip = null;
  function getTooltip() {
    if (tooltip && tooltip.isConnected) return tooltip;
    tooltip = document.createElement('div');
    tooltip.id = 'slackify-meetings-tooltip';
    tooltip.setAttribute('data-slackify', 'meetings-tooltip');
    tooltip.setAttribute('role', 'tooltip');
    (document.body || document.documentElement).appendChild(tooltip);
    return tooltip;
  }
  function showTooltip(place, anchor) {
    injectStyle();
    const tip = getTooltip();
    tip.textContent = helpText[place] || helpText.home;
    const r = anchor.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 8, r.bottom + 8);
    const left = Math.max(136, Math.min(window.innerWidth - 136, r.left + r.width / 2));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
    tip.setAttribute('data-sf-show', '');
  }
  function hideTooltip() {
    if (tooltip) tooltip.removeAttribute('data-sf-show');
  }
  function getControl(place) {
    if (controls[place]) return controls[place];
    const wrap = document.createElement('div');
    wrap.setAttribute('data-slackify', TAG);
    wrap.setAttribute('data-sf-place', place);
    const label = document.createElement('span');
    label.className = 'sf-mt-label';
    label.textContent = 'Hide meetings';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sf-mt-sw';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', place === 'sidebar' ? 'Hide meetings from Direct messages' : 'Hide meetings from Home');
    btn.setAttribute('aria-describedby', 'slackify-meetings-tooltip');
    btn.setAttribute('aria-checked', 'false');
    const knob = document.createElement('span');
    knob.className = 'sf-mt-knob';
    btn.appendChild(knob);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const on = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(on));
      writeFeat(on);
    });
    wrap.addEventListener('mouseenter', () => showTooltip(place, wrap));
    wrap.addEventListener('mouseleave', hideTooltip);
    wrap.addEventListener('focusin', () => showTooltip(place, wrap));
    wrap.addEventListener('focusout', hideTooltip);
    wrap.appendChild(label);
    wrap.appendChild(btn);
    controls[place] = { el: wrap, btn };
    return controls[place];
  }
  function reflect() {
    const on = String(!!(prefs.features && prefs.features[FEAT]));
    for (const c of Object.values(controls)) c.btn.setAttribute('aria-checked', on);
  }
  function removeControls() {
    for (const c of Object.values(controls)) if (c.el.isConnected) c.el.remove();
  }

  // The left sidebar ALSO has per-section unread-filter switches ("Direct messages", "Spaces"),
  // whose aria-labels also match /unread/. We must anchor to the HOME HEADER's Unread filter only,
  // so we exclude anything inside the sidebar. Bonus: this naturally limits the control to the Home
  // view (no Home filter row elsewhere → no Home-control injection).
  function sidebarRoot() {
    const dm = C.firstMatchEl('dmList') || C.firstMatchEl('convRow');
    if (!dm) return null;
    const main = document.querySelector('[role="main"]');
    const maxW = (window.innerWidth || 1280) * 0.5;
    let el = dm, root = null;
    while (el && el !== document.documentElement) {
      if (main && el.contains(main)) break;
      const w = el.getBoundingClientRect().width;
      if (w > 0 && w < maxW) root = el;
      el = el.parentElement;
    }
    return root;
  }
  // ---- locate the VISIBLE Unread switch in the Home header (Chat keeps hidden duplicate headers) ----
  function findUnreadSwitch() {
    const sidebar = sidebarRoot();
    for (const s of (C.SELECTORS.unreadToggle || [])) {
      try {
        for (const node of document.querySelectorAll(s)) {
          if (/** @type {HTMLElement} */ (node).offsetParent === null || node.getBoundingClientRect().width <= 0) continue;
          if (sidebar && sidebar.contains(node)) continue;   // skip sidebar section toggles
          return node;
        }
      } catch (e) {}
    }
    return null;
  }
  function findHomeAnchorCell() {
    const sw = findUnreadSwitch();
    if (!sw) return null;                                    // not on Home → bail before any getComputedStyle
    let row = null, n = sw;
    for (let i = 0; i < 6 && n.parentElement; i++) {
      const p = n.parentElement;
      const cs = getComputedStyle(p);
      if (cs.display.indexOf('flex') !== -1 && p.children.length >= 2 && p.getBoundingClientRect().width > 150) { row = p; break; }
      n = p;
    }
    if (!row) return null;
    return Array.prototype.find.call(row.children, (c) => c.contains(sw)) || null;
  }

  function isVisible(node) {
    const el = /** @type {HTMLElement} */ (node);
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.offsetParent !== null;
  }
  function directChildOf(parent, node) {
    let n = node;
    while (n && n.parentElement && n.parentElement !== parent) n = n.parentElement;
    return n && n.parentElement === parent ? n : null;
  }
  function findDmUnreadSwitch(rail, list) {
    const listTop = list.getBoundingClientRect().top;
    let best = null, bestDist = Infinity;
    for (const s of (C.SELECTORS.unreadToggle || [])) {
      try {
        for (const node of rail.querySelectorAll(s)) {
          if (!isVisible(node)) continue;
          const r = node.getBoundingClientRect();
          if (r.top > listTop) continue;
          const dist = listTop - r.bottom;
          if (dist >= 0 && dist < bestDist) { best = node; bestDist = dist; }
        }
      } catch (e) {}
    }
    return best;
  }
  function findDmHeaderRow(anchor, rail) {
    let n = anchor;
    const railRect = rail.getBoundingClientRect();
    for (let i = 0; i < 6 && n.parentElement; i++) {
      const p = n.parentElement;
      const r = p.getBoundingClientRect();
      if (r.width >= 120 && r.height > 0 && r.height <= 64 && r.left >= railRect.left - 2 && r.right <= railRect.right + 80) {
        const cs = getComputedStyle(p);
        if (cs.display.indexOf('flex') !== -1 || p.children.length >= 2) return p;
      }
      n = p;
    }
    return anchor.parentElement || null;
  }
  function findDmAnchor() {
    const rail = sidebarRoot();
    if (!rail) return null;
    const list = C.firstMatchEl('dmList', rail);
    if (!list || !isVisible(list)) return null;
    const unreadSwitch = findDmUnreadSwitch(rail, list);
    if (unreadSwitch) {
      const row = findDmHeaderRow(unreadSwitch, rail);
      if (row) {
        const child = directChildOf(row, unreadSwitch);
        return { type: 'before', node: child || unreadSwitch };
      }
    }
    return null;
  }

  function insertControl(place, anchor) {
    injectStyle();
    const c = getControl(place);
    reflect();
    if (anchor.type === 'after') anchor.node.insertAdjacentElement('afterend', c.el);
    else if (anchor.node.parentElement) anchor.node.parentElement.insertBefore(c.el, anchor.node);
  }

  // ---- inject/remove decision; cheap early-return once the control is in place ----
  function sync() {
    if (!prefs.enabled) { removeControls(); return; }           // skin disabled → no controls
    if (!controls.home || !controls.home.el.isConnected) {
      const cell = findHomeAnchorCell();                        // only reached when the Home control is missing
      if (cell) insertControl('home', { type: 'after', node: cell });
    }
    if (!controls.sidebar || !controls.sidebar.el.isConnected) {
      const anchor = findDmAnchor();                            // only reached when the sidebar control is missing
      if (anchor) insertControl('sidebar', anchor);
    }
  }

  // ---- scheduling: O(1) observer → dirty flag → throttled idle pass ----
  const ric = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ didTimeout: true, timeRemaining: () => 0 }), 250));
  let scheduled = false, dirty = true;
  function pass() { scheduled = false; if (!dirty) return; dirty = false; try { sync(); } catch (e) {} }
  function schedule() { if (scheduled) return; scheduled = true; ric(pass, { timeout: 1000 }); }

  readPrefs(() => { dirty = true; schedule(); });
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.prefs) readPrefs(() => { reflect(); dirty = true; schedule(); });
    });
  } catch (e) {}

  // observer is O(1): flag + schedule. All DOM work happens in the throttled idle pass above.
  const mo = new MutationObserver(() => { dirty = true; schedule(); });
  try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
})();

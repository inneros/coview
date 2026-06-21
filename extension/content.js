// coview — docks a chat panel into every page. You talk; it reaches your Claude
// Code session via the local bridge; replies poll back in. Alt-click any element
// to "pin" it so Claude knows exactly which thing you mean.
//
// Theme: ships with the DEFAULTS below; override per-instance via the bridge
// (COVIEW_DIR/theme.json or $COVIEW_THEME) without editing this file. See README.
(() => {
  if (window.__coview) return;
  window.__coview = true;

  // Injected at document_idle by the extension; may run at document_start when
  // injected another way. Defer DOM work until the document exists.
  const boot = async () => {
  // Neutral defaults; override per-instance via the bridge (COVIEW_DIR/theme.json
  // or $COVIEW_THEME) so a brand never ships in the repo. See README → Theming.
  const DEFAULTS = { bg: '#FBF8F0', ink: '#1A1814', accent: '#D4A84B', line: '#e7e0cf' };
  let override = {};
  try { const t = await chrome.runtime.sendMessage({ type: 'theme' }); if (t && t.ok) override = t.data.theme || {}; } catch {}
  const C = { ...DEFAULTS, ...override };
  let seen = 0;
  let pinned = '';

  // ---- selector for a pinned element (short + good enough to locate) ----
  const selectorFor = (el) => {
    if (!el || el === document.body) return 'body';
    if (el.id) return `#${el.id}`;
    const parts = [];
    let n = el;
    for (let depth = 0; n && n.nodeType === 1 && depth < 4; depth++) {
      let s = n.tagName.toLowerCase();
      const cls = (n.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0];
      if (cls) s += `.${CSS.escape(cls)}`;
      const sibs = n.parentNode ? [...n.parentNode.children].filter((c) => c.tagName === n.tagName) : [];
      if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(n) + 1})`;
      parts.unshift(s);
      if (n.id) { parts[0] = `#${n.id}`; break; }
      n = n.parentNode;
    }
    return parts.join(' > ');
  };

  // ---- UI ----
  const root = document.createElement('div');
  root.id = 'coview-root';
  root.attachShadow({ mode: 'open' });
  root.shadowRoot.innerHTML = `
    <style>
      :host { all: initial; }
      .bubble {
        position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
        width: 52px; height: 52px; border-radius: 50%; background: ${C.ink};
        color: ${C.accent}; font: 600 22px/52px Inter, system-ui; text-align: center;
        cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.25);
      }
      .panel {
        position: fixed; bottom: 84px; right: 20px; z-index: 2147483647;
        width: 360px; height: 480px; max-height: 80vh; display: none; flex-direction: column;
        background: ${C.bg}; border: 1px solid ${C.line}; border-radius: 16px;
        box-shadow: 0 12px 40px rgba(0,0,0,.22); overflow: hidden;
        font-family: Inter, system-ui; color: ${C.ink};
      }
      .panel.open { display: flex; }
      .hd { padding: 12px 14px; font-weight: 600; border-bottom: 1px solid ${C.line};
            display: flex; justify-content: space-between; align-items: center; }
      .hd small { font-weight: 400; opacity: .6; }
      .hd-r { display: flex; align-items: center; gap: 8px; }
      #min { border: 0; background: none; color: ${C.ink}; font-size: 20px; line-height: 1;
             cursor: pointer; opacity: .5; padding: 0 2px; }
      #min:hover { opacity: 1; }
      .log { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
      .m { padding: 9px 12px; border-radius: 12px; max-width: 80%; white-space: pre-wrap; font-size: 14px; line-height: 1.45; }
      .you { background: ${C.ink}; color: ${C.bg}; align-self: flex-end; }
      .claude { background: ${C.bg}; border: 1px solid ${C.line}; align-self: flex-start; }
      .pin { margin: 0 12px; font-size: 12px; color: ${C.ink}; opacity: .75;
             display: none; align-items: center; gap: 6px; }
      .pin.show { display: flex; }
      .pin code { background: ${C.bg}; border: 1px solid ${C.line}; padding: 1px 5px; border-radius: 5px; }
      .pin button { border: 0; background: none; cursor: pointer; opacity: .6; }
      .ft { display: flex; gap: 8px; padding: 10px; border-top: 1px solid ${C.line}; }
      .ft input { flex: 1; padding: 10px; border: 1px solid ${C.line}; border-radius: 10px; font-size: 14px; }
      .ft button { padding: 0 16px; border: 0; border-radius: 10px; background: ${C.accent};
                   color: ${C.ink}; font-weight: 600; cursor: pointer; }
      .hint { font-size: 11px; opacity: .5; padding: 0 12px 8px; }
    </style>
    <div class="bubble" title="Talk to Claude">◆</div>
    <div class="panel">
      <div class="hd"><span>Claude · live</span><span class="hd-r"><small id="st">connecting…</small><button id="min" title="Minimize">–</button></span></div>
      <div class="log" id="log"></div>
      <div class="pin" id="pin"><span>pinned <code id="pinsel"></code></span><button id="unpin">✕</button></div>
      <div class="hint">Alt-click any element on the page to pin it.</div>
      <div class="ft"><input id="t" placeholder="What do you see?" autocomplete="off"><button id="send">Send</button></div>
    </div>`;
  document.documentElement.appendChild(root);

  // Some frameworks (e.g. Next.js App Router) render <html>/<body> via React; if
  // the panel is appended before hydration finishes, reconciliation strips this
  // foreign node. Re-append it whenever that happens (idle once it settles).
  new MutationObserver(() => {
    if (!document.documentElement.contains(root)) document.documentElement.appendChild(root);
  }).observe(document.documentElement, { childList: true });
  const sr = root.shadowRoot;
  const $ = (s) => sr.querySelector(s);

  const add = (text, who) => {
    const d = document.createElement('div');
    d.className = `m ${who}`;
    d.textContent = text;
    $('#log').appendChild(d);
    $('#log').scrollTop = $('#log').scrollHeight;
  };

  $('.bubble').onclick = () => $('.panel').classList.toggle('open');
  $('#unpin').onclick = () => { pinned = ''; $('#pin').classList.remove('show'); };

  // minimize: collapse the panel back to the bubble (don't let it start a drag)
  $('#min').addEventListener('pointerdown', (e) => e.stopPropagation());
  $('#min').onclick = (e) => { e.stopPropagation(); $('.panel').classList.remove('open'); };

  // drag the panel anywhere by its header
  (() => {
    const panel = $('.panel');
    const hd = $('.hd');
    hd.style.cursor = 'move';
    hd.style.userSelect = 'none';
    let drag = null;
    hd.addEventListener('pointerdown', (e) => {
      const r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
      hd.setPointerCapture(e.pointerId);
    });
    hd.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const w = panel.offsetWidth, h = panel.offsetHeight;
      panel.style.left = Math.min(Math.max(0, e.clientX - drag.dx), innerWidth - w) + 'px';
      panel.style.top = Math.min(Math.max(0, e.clientY - drag.dy), innerHeight - h) + 'px';
    });
    hd.addEventListener('pointerup', () => { drag = null; });
  })();

  const send = async () => {
    const inp = $('#t');
    const text = inp.value.trim();
    if (!text) return;
    add(text, 'you');
    inp.value = '';
    const payload = { text, pageUrl: location.href, selector: pinned };
    pinned = ''; $('#pin').classList.remove('show');
    const r = await chrome.runtime.sendMessage({ type: 'send', payload });
    $('#st').textContent = r && r.ok ? 'sent ✓' : 'bridge offline';
  };
  $('#send').onclick = send;
  $('#t').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  // alt-click to pin an element
  document.addEventListener('click', (e) => {
    if (!e.altKey) return;
    if (root.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    pinned = selectorFor(e.target);
    $('#pinsel').textContent = pinned.length > 42 ? pinned.slice(0, 42) + '…' : pinned;
    $('#pin').classList.add('show');
    $('.panel').classList.add('open');
    const el = e.target;
    const o = el.style.outline; el.style.outline = `2px solid ${C.accent}`;
    setTimeout(() => { el.style.outline = o; }, 1200);
  }, true);

  // poll for replies
  setInterval(async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'poll', after: seen });
      if (!r || !r.ok) { $('#st').textContent = 'bridge offline'; return; }
      $('#st').textContent = 'live';
      for (const m of r.data.messages) { add(m.text, 'claude'); seen = m.id; }
    } catch { $('#st').textContent = 'bridge offline'; }
  }, 1500);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

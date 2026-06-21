// Service worker: fetches the local bridge on behalf of the content script.
// A page's CSP can block a content-script fetch to localhost; a background fetch
// is not subject to the page CSP, so all bridge traffic is funneled through here.
//
// BASE must match the bridge port (COVIEW_PORT, default 7777). If you change the
// bridge port, change it here too and reload the extension.
const BASE = 'http://127.0.0.1:7777';

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  (async () => {
    try {
      if (req.type === 'send') {
        const r = await fetch(`${BASE}/msg`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.payload),
        });
        sendResponse({ ok: true, data: await r.json() });
      } else if (req.type === 'poll') {
        const r = await fetch(`${BASE}/poll?after=${req.after || 0}`);
        sendResponse({ ok: true, data: await r.json() });
      } else if (req.type === 'theme') {
        const r = await fetch(`${BASE}/theme`);
        sendResponse({ ok: true, data: await r.json() });
      } else {
        sendResponse({ ok: false, error: 'unknown' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // async
});

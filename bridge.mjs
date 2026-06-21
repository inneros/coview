// coview bridge — local-only transport between the browser panel and your Claude
// Code session. Zero dependencies (Node stdlib only).
//
//   browser  --POST /msg-->   inbox.jsonl   --(watch.sh wakes Claude)
//   browser  <-GET /poll--    outbox.jsonl  <--(Claude posts /reply)
//
// All local, no auth. Do NOT expose this port to the network.
//
// Env:
//   COVIEW_PORT   bridge port (default 7777 — must match extension/background.js)
//   COVIEW_DIR    state dir   (default ~/.coview)

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.COVIEW_PORT || 7777);
const DIR = process.env.COVIEW_DIR || path.join(os.homedir(), '.coview');
const INBOX = path.join(DIR, 'inbox.jsonl');
const OUTBOX = path.join(DIR, 'outbox.jsonl');

fs.mkdirSync(DIR, { recursive: true });
for (const f of [INBOX, OUTBOX]) if (!fs.existsSync(f)) fs.writeFileSync(f, '');

const append = (file, obj) => fs.appendFileSync(file, JSON.stringify(obj) + '\n');
const lines = (file) =>
  fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l, i) => {
    try { return { id: i + 1, ...JSON.parse(l) }; } catch { return { id: i + 1, text: l }; }
  });

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};
const json = (res, code, obj) => {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const body = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  // browser -> session
  if (req.method === 'POST' && url.pathname === '/msg') {
    const { text = '', pageUrl = '', selector = '' } = await body(req);
    if (!text.trim()) return json(res, 400, { ok: false, error: 'empty' });
    append(INBOX, { ts: Date.now(), text, pageUrl, selector });
    return json(res, 200, { ok: true, id: lines(INBOX).length });
  }

  // session -> browser
  if (req.method === 'POST' && url.pathname === '/reply') {
    const { text = '' } = await body(req);
    append(OUTBOX, { ts: Date.now(), text });
    return json(res, 200, { ok: true, id: lines(OUTBOX).length });
  }

  // browser polls for replies
  if (req.method === 'GET' && url.pathname === '/poll') {
    const after = Number(url.searchParams.get('after') || 0);
    return json(res, 200, { messages: lines(OUTBOX).filter((m) => m.id > after) });
  }

  // panel theme override — read by content.js on boot. Source order:
  //   1. $COVIEW_DIR/theme.json   2. $COVIEW_THEME (JSON env)   3. {} (neutral default)
  // Keeps your brand out of the committed repo.
  if (req.method === 'GET' && url.pathname === '/theme') {
    let theme = {};
    try { theme = JSON.parse(fs.readFileSync(path.join(DIR, 'theme.json'), 'utf8')); }
    catch { try { theme = JSON.parse(process.env.COVIEW_THEME || '{}'); } catch {} }
    return json(res, 200, { theme });
  }

  // fallback chat page (works even without the extension): open http://localhost:7777
  if (req.method === 'GET' && url.pathname === '/') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(FALLBACK_HTML);
  }

  json(res, 404, { ok: false });
});

server.listen(PORT, '127.0.0.1', () =>
  console.log(`[coview] bridge on http://127.0.0.1:${PORT}  dir=${DIR}`)
);

const FALLBACK_HTML = `<!doctype html><meta charset=utf8>
<title>coview</title>
<style>
 body{font-family:Inter,system-ui;margin:0;background:#FBF8F0;color:#1A1814}
 #log{padding:16px;height:calc(100vh - 70px);overflow:auto}
 .m{margin:8px 0;padding:10px 12px;border-radius:12px;max-width:70%;white-space:pre-wrap}
 .you{background:#1A1814;color:#FBF8F0;margin-left:auto}
 .claude{background:#fff;border:1px solid #e7e0cf}
 form{position:fixed;bottom:0;left:0;right:0;display:flex;gap:8px;padding:12px;background:#FBF8F0;border-top:1px solid #e7e0cf}
 input{flex:1;padding:12px;border:1px solid #e7e0cf;border-radius:10px;font-size:15px}
 button{padding:0 18px;border:0;border-radius:10px;background:#D4A84B;color:#1A1814;font-weight:600;cursor:pointer}
</style>
<div id=log></div>
<form id=f><input id=t placeholder="Tell Claude what you see..." autocomplete=off><button>Send</button></form>
<script>
 let seen=0; const log=document.getElementById('log');
 const add=(t,c)=>{const d=document.createElement('div');d.className='m '+c;d.textContent=t;log.appendChild(d);log.scrollTop=log.scrollHeight};
 document.getElementById('f').onsubmit=async e=>{e.preventDefault();const t=document.getElementById('t');const v=t.value.trim();if(!v)return;add(v,'you');t.value='';
   await fetch('/msg',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:v,pageUrl:'fallback-page'})});};
 setInterval(async()=>{const r=await(await fetch('/poll?after='+seen)).json();for(const m of r.messages){add(m.text,'claude');seen=m.id}},1200);
</script>`;

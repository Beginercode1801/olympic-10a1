function connect(hello, onState) {
  let ws, off = 0;
  const api = { send: o => ws && ws.readyState === 1 && ws.send(JSON.stringify(o)) };
  function open() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', ...hello }));
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.type === 'state') { off = m.now - Date.now(); api.state = m.state; onState(m.state); }
      else if (m.type === 'error') alert(m.msg);
    };
    ws.onclose = () => setTimeout(open, 1000);
  }
  api.now = () => Date.now() + off;
  open();
  return api;
}
const fmt = t => t == null ? '' : (t / 1000).toFixed(2) + 's';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function remaining(s, api) {
  if (s.phase === 'running') return Math.max(0, s.seconds - (api.now() - s.startedAt) / 1000);
  if (s.phase === 'ready') return s.seconds;
  return s.phase === 'ended' ? 0 : null;
}
const BASE_CSS = `
*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#0b1530;color:#fff}
button{font:inherit;cursor:pointer;border:0;border-radius:10px;padding:10px 16px;background:#2f5bff;color:#fff}
button:disabled{opacity:.4;cursor:not-allowed}
input,select,textarea{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid #456;background:#12204a;color:#fff}
.muted{opacity:.6}`;

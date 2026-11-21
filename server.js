const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PASS = process.env.HOST_PASS || 'olympia';
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(PUB, path.normalize(p));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});

const wss = new WebSocketServer({ server });

// ---------- Trạng thái trận đấu ----------
const state = {
  players: [1, 2, 3, 4].map(() => ({ name: '', score: 0 })),
  round: 'Khởi động',
  mode: 'buzz',        // 'buzz' = bấm chuông | 'answer' = nhập đáp án
  text: '',
  visible: false,      // câu hỏi đã hiện lên màn hình chưa
  phase: 'idle',       // idle | ready | running | ended
  seconds: 15,
  startedAt: 0,
  buzz: [],            // [{slot, t}]
  answers: {},         // slot -> {text, t, correct}
  out: [],             // thí sinh bị loại quyền trả lời ở câu này
  revealed: false,
};
let timer = null;

function startTimer() {
  clearTimeout(timer);
  state.phase = 'running';
  state.startedAt = Date.now();
  timer = setTimeout(() => { state.phase = 'ended'; broadcast(); }, state.seconds * 1000 + 300);
}

function viewFor(ws) {
  const role = ws.role;
  const v = JSON.parse(JSON.stringify(state));
  const online = new Set();
  wss.clients.forEach(c => { if (c.role === 'player' && c.slot) online.add(c.slot); });
  v.players.forEach((p, i) => { p.online = online.has(i + 1); });
  if (role !== 'host' && !state.visible) v.text = '';
  if (role !== 'host' && !state.revealed) {
    const hidden = {};
    for (const s in state.answers) {
      hidden[s] = (role === 'player' && ws.slot == s) ? state.answers[s] : { answered: true, t: null };
    }
    v.answers = hidden;
  }
  v.me = role === 'player' ? ws.slot : null;
  return v;
}

function broadcast() {
  wss.clients.forEach(c => {
    if (c.readyState === 1 && c.role) c.send(JSON.stringify({ type: 'state', now: Date.now(), state: viewFor(c) }));
  });
}

// ---------- Xử lý lệnh MC ----------
function host(m) {
  switch (m.type) {
    case 'question':
      state.round = m.round || state.round;
      state.mode = m.mode === 'answer' ? 'answer' : 'buzz';
      state.text = String(m.text || '').slice(0, 1000);
      state.seconds = Math.max(3, Math.min(120, +m.seconds || 15));
      state.visible = true; state.phase = 'ready';
      state.buzz = []; state.answers = {}; state.out = []; state.revealed = false;
      clearTimeout(timer);
      break;
    case 'start': if (state.phase === 'ready') startTimer(); break;
    case 'end': clearTimeout(timer); state.phase = 'ended'; break;
    case 'reopen': // mở lại chuông sau khi có người trả lời sai
      state.buzz = []; startTimer(); break;
    case 'reveal': state.revealed = true; if (state.phase === 'running') { clearTimeout(timer); state.phase = 'ended'; } break;
    case 'hide': state.visible = false; break;
    case 'judge': { // m.slot, m.correct, m.points
      const p = state.players[m.slot - 1]; if (!p) break;
      if (m.correct) p.score += +m.points || 0;
      else if (state.mode === 'buzz') { state.out.push(m.slot); state.buzz = state.buzz.filter(b => b.slot !== m.slot); }
      if (state.answers[m.slot]) state.answers[m.slot].correct = !!m.correct;
      break;
    }
    case 'score': { const p = state.players[m.slot - 1]; if (p) p.score += +m.delta || 0; break; }
    case 'rename': { const p = state.players[m.slot - 1]; if (p) p.name = String(m.name || '').slice(0, 30); break; }
    case 'resetScores': state.players.forEach(p => p.score = 0); break;
  }
  broadcast();
}

function player(ws, m) {
  const slot = ws.slot, now = Date.now();
  if (state.phase !== 'running' || state.out.includes(slot)) return;
  const t = now - state.startedAt;
  if (m.type === 'buzz' && state.mode === 'buzz' && !state.buzz.some(b => b.slot === slot)) {
    state.buzz.push({ slot, t });
  } else if (m.type === 'answer' && state.mode === 'answer' && !state.answers[slot]) {
    state.answers[slot] = { text: String(m.text || '').slice(0, 200), t, correct: null };
  } else return;
  broadcast();
}

wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'hello') {
      if (m.role === 'host') {
        if (m.pass !== PASS) { ws.send(JSON.stringify({ type: 'error', msg: 'Sai mật khẩu MC' })); return ws.close(); }
        ws.role = 'host';
      } else if (m.role === 'player') {
        const slot = +m.slot;
        if (!(slot >= 1 && slot <= 4)) return;
        ws.role = 'player'; ws.slot = slot;
        if (m.name) state.players[slot - 1].name = String(m.name).slice(0, 30);
      } else ws.role = 'display';
      return broadcast();
    }
    if (ws.role === 'host') host(m);
    else if (ws.role === 'player') player(ws, m);
  });
  ws.on('close', () => setTimeout(broadcast, 50));
});

server.listen(PORT, () => {
  console.log(`Olympia quiz chạy tại http://localhost:${PORT}  (mật khẩu MC: ${PASS})`);
});

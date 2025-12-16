// Utilities
const BASE_W = 900;
const BASE_H = 600;
const palette = ["#7eff7a", "#ff7ad1", "#7cf4ff", "#ffda7c", "#ffa57a", "#b07cff", "#7affd0"];

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let W = 0, H = 0;
let scale = 1, offsetX = 0, offsetY = 0;
let zoomFactor = 1;

let socket = null;
let myId = null;
let myName = "";
let isOwner = false;
let countdownTimer = null;
let countdownRunning = false;
let isFrozen = false;
const STOP_EPS = 0.2;

let game = {
  phase: "waiting",
  players: [],
  goal: { x: BASE_W * 0.8, y: BASE_H * 0.5 },
  obstacles: [],
  items: [],
  freeze: { active: false, by: null, until: 0, frozen: [] },
  reverse: { active: false, by: null, until: 0 }
};

const RENDER_WS = "wss://twoplayer-1.onrender.com";

function wsUrl() {
  try {
    const loc = window.location;
    const isPages = loc.hostname.endsWith("github.io");
    if (isPages) return RENDER_WS;
    const proto = loc.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${loc.host}`;
  } catch {
    return RENDER_WS;
  }
}

function resize() {
  W = canvas.width = window.innerWidth;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  H = canvas.height = vh;
  const fit = Math.min(W / BASE_W, H / BASE_H);
  scale = fit * 0.95 * zoomFactor;
  scale = Math.max(0.55, Math.min(scale, 1.4));
  offsetX = (W - BASE_W * scale) / 2;
  offsetY = (H - BASE_H * scale) / 2;
}
resize();
window.addEventListener("resize", resize);

// UI helpers
function logToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(logToast._timer);
  logToast._timer = setTimeout(() => t.style.display = "none", 2200);
}
function setHud(texts) {
  if (texts.status) document.getElementById("status").textContent = texts.status, document.getElementById("hudStatus").textContent = texts.status;
  if (texts.you) document.getElementById("you").textContent = texts.you, document.getElementById("hudYou").textContent = texts.you;
  if (texts.turn) document.getElementById("turn").textContent = texts.turn, document.getElementById("hudTurn").textContent = texts.turn;
  if (texts.score) document.getElementById("score").textContent = texts.score, document.getElementById("hudScore").textContent = texts.score;
}
function updateStartButton() {
  const btn = document.getElementById("startOverlay");
  const replay = document.getElementById("replayOverlay");
  btn.style.display = isOwner && game.phase === "waiting" ? "inline-flex" : "none";
  replay.style.display = isOwner && game.phase === "ended" ? "inline-flex" : "none";
}

// Connection
function connect(roomCode) {
  if (!roomCode) { logToast("Code requis"); return; }
  const rawName = document.getElementById("nickname").value.trim();
  const nick = rawName || ("Joueur" + Math.floor(Math.random() * 1000));
  myName = nick.slice(0, 12);
  if (socket && socket.readyState <= 1) socket.close();
  const qs = `/?room=${roomCode}&name=${encodeURIComponent(myName)}`;
  socket = new WebSocket(`${wsUrl()}${qs}`);
  setHud({ status: "Connexion..." });

  socket.onopen = () => {
    setHud({ status: "Connecte" });
    socket.send(JSON.stringify({ type: "join" }));
    document.getElementById("menu").classList.add("hidden");
  };
  socket.onerror = () => setHud({ status: "Erreur WS" });
  socket.onclose = () => setHud({ status: "Deconnecte" });

  socket.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "welcome") {
      myId = msg.player;
      myName = msg.name || myName || myId;
      isOwner = msg.owner ?? isOwner;
      setHud({ you: "Vous: " + myName });
      updateStartButton();
    }
    if (msg.type === "start") {
      startCountdown();
    }
    if (msg.type === "state") {
      applyState(msg.game);
    }
    if (msg.type === "toast") logToast(msg.message);
  };
}

// State
function applyState(g) {
  if (!g.items) g.items = [];
  if (!g.freeze) g.freeze = { active: false, by: null, until: 0, frozen: [] };
  if (!g.reverse) g.reverse = { active: false, by: null, until: 0 };
  game = g;
  const freeze = g.freeze || {};
  const reverse = g.reverse || {};
  isFrozen = freeze.active && freeze.frozen?.includes(myId);
  const freezeRemain = freeze.active ? Math.max(0, Math.ceil((freeze.until - Date.now()) / 1000)) : 0;
  const reverseRemain = reverse.active ? Math.max(0, Math.ceil((reverse.until - Date.now()) / 1000)) : 0;
  const meState = g.players?.find(p => p.id === myId);
  const boostActive = meState ? (meState.boostUntil || 0) > Date.now() : false;
  const itemLabel = document.getElementById("itemLabel");
  if (freeze.active) {
    itemLabel.textContent = isFrozen
      ? `Gele ${freezeRemain}s`
      : `Geles (${freeze.by || "?"}) ${freezeRemain}s`;
  } else if (reverse.active) {
    itemLabel.textContent = `Inverse (${reverse.by || "?"}) ${reverseRemain}s`;
  } else if (boostActive) {
    itemLabel.textContent = "Boost actif";
  } else {
    itemLabel.textContent = "Item: aucun";
  }
  setHud({
    turn: "Phase: " + (g.phase === "waiting" ? "attente" : g.phase === "playing" ? "en cours" : "termine"),
    score: `Joueurs: ${g.players?.length || 0}`
  });
  updateStartButton();
}

// Input
let dragging = false;
let dragStart = null;
function pointerPos(e) {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left - offsetX) / scale;
  const y = (e.clientY - r.top - offsetY) / scale;
  return { x, y };
}

canvas.addEventListener("pointerdown", (e) => {
  if (isFrozen) return logToast("Gele quelques secondes");
  if (game.phase !== "playing") return logToast("La partie n'a pas commence");
  const me = game.players?.find(p => p.id === myId);
  if (!me) return;
  const moving = Math.abs(me.ball?.vx || 0) + Math.abs(me.ball?.vy || 0) > STOP_EPS;
  if (moving) return logToast("Attends que ta balle s'arrete");
  const p = pointerPos(e);
  const dx = p.x - me.ball.x;
  const dy = p.y - me.ball.y;
  if (Math.hypot(dx, dy) > 55) return;
  dragging = true;
  dragStart = { x: me.ball.x, y: me.ball.y, current: p };
  updatePower(p);
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  dragStart.current = pointerPos(e);
  updatePower(dragStart.current);
});

canvas.addEventListener("pointerup", () => {
  if (!dragging) return;
  dragging = false;
  updatePower(null);
  const me = game.players?.find(p => p.id === myId);
  if (!me) return;
  const p = dragStart.current;
  const dx = p.x - dragStart.x;
  const dy = p.y - dragStart.y;
  const dist = Math.hypot(dx, dy);
  const power = Math.min(dist, 50) / 24;
  const norm = Math.max(1, dist);
  const vx = (dx / norm) * power;
  const vy = (dy / norm) * power;
  socket?.send(JSON.stringify({ type: "throw", id: myId, vx, vy }));
});

// Power meter
function updatePower(point) {
  const bar = document.getElementById("powerBar");
  const label = document.getElementById("powerLabel");
  if (!point) {
    bar.style.width = "0%";
    label.textContent = "Puissance: 0%";
    return;
  }
  const me = game.players?.find(p => p.id === myId);
  const ref = me?.ball || { x: 0, y: 0 };
  const dx = point.x - ref.x;
  const dy = point.y - ref.y;
  const dist = Math.hypot(dx, dy);
  const pct = Math.round(Math.min(dist, 50) / 50 * 100);
  bar.style.width = pct + "%";
  label.textContent = `Puissance: ${pct}%`;
}

// Countdown
function startCountdown() {
  const cd = document.getElementById("countdown");
  if (countdownRunning) return;
  countdownRunning = true;
  const seq = ["3", "2", "1", "GO"];
  let idx = 0;
  cd.textContent = seq[idx];
  cd.classList.add("show");
  const step = () => {
    idx++;
    if (idx >= seq.length) {
      cd.classList.remove("show");
      cd.textContent = "";
      countdownRunning = false;
      return;
    }
    cd.textContent = seq[idx];
    countdownTimer = setTimeout(step, 700);
  };
  countdownTimer = setTimeout(step, 700);
}

// Render
function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  const grad = ctx.createLinearGradient(0, 0, BASE_W, BASE_H);
  grad.addColorStop(0, "#0b1328");
  grad.addColorStop(1, "#0a0f1f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, BASE_W, BASE_H);

  // items
  game.items?.forEach((it) => {
    ctx.lineWidth = 3;
    if (it.type === "freeze") {
      ctx.beginPath();
      ctx.arc(it.x, it.y, 18, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(124,244,255,0.18)";
      ctx.strokeStyle = "rgba(124,244,255,0.8)";
      ctx.fill();
      ctx.stroke();
    } else if (it.type === "reverse") {
      ctx.beginPath();
      ctx.moveTo(it.x, it.y - 20);
      ctx.lineTo(it.x - 16, it.y + 14);
      ctx.lineTo(it.x + 16, it.y + 14);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,210,110,0.2)";
      ctx.strokeStyle = "rgba(255,210,110,0.8)";
      ctx.fill();
      ctx.stroke();
    } else if (it.type === "boost") {
      ctx.beginPath();
      ctx.rect(it.x - 16, it.y - 16, 32, 32);
      ctx.fillStyle = "rgba(255,130,200,0.15)";
      ctx.strokeStyle = "rgba(255,130,200,0.8)";
      ctx.fill();
      ctx.stroke();
    }
  });

  // goal
  ctx.beginPath();
  ctx.arc(game.goal.x, game.goal.y, 36, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(124,244,255,0.15)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(124,244,255,0.5)";
  ctx.stroke();

  // obstacles
  ctx.fillStyle = "rgba(255,120,120,0.35)";
  ctx.strokeStyle = "rgba(255,120,120,0.7)";
  game.obstacles?.forEach(o => {
    ctx.beginPath();
    ctx.rect(o.x, o.y, o.w, o.h);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // players
  game.players?.forEach((p, idx) => {
    if (!p.ball) return;
    ctx.beginPath();
    ctx.arc(p.ball.x, p.ball.y, 14, 0, Math.PI * 2);
    const col = palette[idx % palette.length];
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.id === myId ? "#ffffff" : "rgba(255,255,255,0.4)";
    ctx.stroke();
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ffffffcc";
    const label = p.id === myId ? (myName || "toi") : (p.name || p.id);
    ctx.fillText(label, p.ball.x, p.ball.y + 16);
  });

  // drag line
  if (dragging && dragStart?.current) {
    const dx = dragStart.current.x - dragStart.x;
    const dy = dragStart.current.y - dragStart.y;
    const dist = Math.hypot(dx, dy);
    const power = Math.min(dist, 50) / 50; // 0..1
    const hue = 120 - 120 * power; // green -> red
    const color = `hsl(${hue}, 90%, 60%)`;
    ctx.beginPath();
    ctx.moveTo(dragStart.x, dragStart.y);
    ctx.lineTo(dragStart.current.x, dragStart.current.y);
    ctx.strokeStyle = color;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
  requestAnimationFrame(draw);
}
draw();

// UI bindings
document.getElementById("create").onclick = () => {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  document.getElementById("room").value = code;
  isOwner = true;
  connect(code);
};
document.getElementById("join").onclick = () => {
  const code = document.getElementById("room").value.trim().toUpperCase();
  if (!code) return logToast("Code requis");
  isOwner = false;
  connect(code);
};
document.getElementById("play").onclick = () => menu.classList.add("hidden");
document.getElementById("openMenu").onclick = () => menu.classList.remove("hidden");
document.getElementById("startOverlay").onclick = () => {
  if (!isOwner) return logToast("Seul le createur peut demarrer");
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "start" }));
  }
  startCountdown();
};
document.getElementById("replayOverlay").onclick = () => {
  if (!isOwner) return logToast("Seul le createur peut relancer");
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "restart", id: myId }));
  }
  startCountdown();
};
document.getElementById("zoomIn").onclick = () => { zoomFactor = Math.min(1.4, zoomFactor + 0.1); resize(); };
document.getElementById("zoomOut").onclick = () => { zoomFactor = Math.max(0.55, zoomFactor - 0.1); resize(); };

// Init UI
setHud({ status: "Deconnecte", you: "Vous:  -", turn: "Phase: attente", score: "Joueurs: 0" });
updateStartButton();

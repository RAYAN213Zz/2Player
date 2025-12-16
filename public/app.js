// --- Config & state -------------------------------------------------------
const BASE_W = 900;
const BASE_H = 600;
const palette = ["#7eff7a", "#ff7ad1", "#7cf4ff", "#ffda7c", "#ffa57a", "#b07cff", "#7affd0"];

const ui = {
  canvas: document.getElementById("canvas"),
  menu: document.getElementById("menu"),
  toast: document.getElementById("toast"),
  status: document.getElementById("status"),
  hudStatus: document.getElementById("hudStatus"),
  you: document.getElementById("you"),
  hudYou: document.getElementById("hudYou"),
  turn: document.getElementById("turn"),
  hudTurn: document.getElementById("hudTurn"),
  score: document.getElementById("score"),
  hudScore: document.getElementById("hudScore"),
  nickname: document.getElementById("nickname"),
  room: document.getElementById("room"),
  startOverlay: document.getElementById("startOverlay"),
  replayOverlay: document.getElementById("replayOverlay"),
  countdown: document.getElementById("countdown"),
  powerBar: document.getElementById("powerBar"),
  powerLabel: document.getElementById("powerLabel"),
  itemLabel: document.getElementById("itemLabel"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
  openMenu: document.getElementById("openMenu"),
  play: document.getElementById("play"),
  create: document.getElementById("create"),
  join: document.getElementById("join"),
};

const ctx = ui.canvas.getContext("2d");
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

function me(state = game) {
  return state.players?.find((p) => p.id === myId);
}

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

// Utilise l'origine courante en local, sinon le serveur en ligne.
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

function sendMessage(data) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function resize() {
  // Ajuste l'aire de jeu au viewport en conservant l'echelle.
  W = ui.canvas.width = window.innerWidth;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  H = ui.canvas.height = vh;
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
  ui.toast.textContent = msg;
  ui.toast.style.display = "block";
  clearTimeout(logToast._timer);
  logToast._timer = setTimeout(() => ui.toast.style.display = "none", 2200);
}
function setHud(texts) {
  if (texts.status) {
    ui.status.textContent = texts.status;
    ui.hudStatus.textContent = texts.status;
  }
  if (texts.you) {
    ui.you.textContent = texts.you;
    ui.hudYou.textContent = texts.you;
  }
  if (texts.turn) {
    ui.turn.textContent = texts.turn;
    ui.hudTurn.textContent = texts.turn;
  }
  if (texts.score) {
    ui.score.textContent = texts.score;
    ui.hudScore.textContent = texts.score;
  }
}
function updateStartButton() {
  ui.startOverlay.style.display = isOwner && game.phase === "waiting" ? "inline-flex" : "none";
  ui.replayOverlay.style.display = isOwner && game.phase === "ended" ? "inline-flex" : "none";
}

// Connection
function connect(roomCode) {
  if (!roomCode) { logToast("Code requis"); return; }
  const rawName = ui.nickname.value.trim();
  const nick = rawName || ("Joueur" + Math.floor(Math.random() * 1000));
  myName = nick.slice(0, 12);
  if (socket && socket.readyState <= 1) socket.close();
  const qs = `/?room=${roomCode}&name=${encodeURIComponent(myName)}`;
  socket = new WebSocket(`${wsUrl()}${qs}`);
  setHud({ status: "Connexion..." });

  socket.onopen = () => {
    setHud({ status: "Connecte" });
    sendMessage({ type: "join" });
    ui.menu.classList.add("hidden");
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
  // Normalise les champs attendus pour eviter les erreurs de rendu.
  if (!g.items) g.items = [];
  if (!g.freeze) g.freeze = { active: false, by: null, until: 0, frozen: [] };
  if (!g.reverse) g.reverse = { active: false, by: null, until: 0 };
  game = g;
  const freeze = g.freeze || {};
  const reverse = g.reverse || {};
  isFrozen = freeze.active && freeze.frozen?.includes(myId);
  const freezeRemain = freeze.active ? Math.max(0, Math.ceil((freeze.until - Date.now()) / 1000)) : 0;
  const reverseRemain = reverse.active ? Math.max(0, Math.ceil((reverse.until - Date.now()) / 1000)) : 0;
  const meState = me(g);
  const boostActive = meState ? (meState.boostUntil || 0) > Date.now() : false;
  if (freeze.active) {
    ui.itemLabel.textContent = isFrozen
      ? `Gele ${freezeRemain}s`
      : `Geles (${freeze.by || "?"}) ${freezeRemain}s`;
  } else if (reverse.active) {
    ui.itemLabel.textContent = `Inverse (${reverse.by || "?"}) ${reverseRemain}s`;
  } else if (boostActive) {
    ui.itemLabel.textContent = "Boost actif";
  } else {
    ui.itemLabel.textContent = "Item: aucun";
  }
  setHud({
    turn: "Phase: " + (g.phase === "waiting" ? "attente" : g.phase === "playing" ? "en cours" : "termine"),
    score: `Joueurs: ${g.players?.length || 0}`
  });
  updateStartButton();
}

// Input: drag pour viser/lancer
let dragging = false;
let dragStart = null;
function pointerPos(e) {
  const r = ui.canvas.getBoundingClientRect();
  const x = (e.clientX - r.left - offsetX) / scale;
  const y = (e.clientY - r.top - offsetY) / scale;
  return { x, y };
}

ui.canvas.addEventListener("pointerdown", (e) => {
  if (isFrozen) return logToast("Gele quelques secondes");
  if (game.phase !== "playing") return logToast("La partie n'a pas commence");
  const meState = me();
  if (!meState) return;
  const moving = Math.abs(meState.ball?.vx || 0) + Math.abs(meState.ball?.vy || 0) > STOP_EPS;
  if (moving) return logToast("Attends que ta balle s'arrete");
  const p = pointerPos(e);
  const dx = p.x - meState.ball.x;
  const dy = p.y - meState.ball.y;
  if (Math.hypot(dx, dy) > 55) return;
  dragging = true;
  dragStart = { x: meState.ball.x, y: meState.ball.y, current: p };
  updatePower(p);
});

ui.canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  dragStart.current = pointerPos(e);
  updatePower(dragStart.current);
});

ui.canvas.addEventListener("pointerup", () => {
  if (!dragging) return;
  dragging = false;
  updatePower(null);
  const meState = me();
  if (!meState) return;
  const p = dragStart.current;
  const dx = p.x - dragStart.x;
  const dy = p.y - dragStart.y;
  const dist = Math.hypot(dx, dy);
  const power = Math.min(dist, 50) / 24;
  const norm = Math.max(1, dist);
  const vx = (dx / norm) * power;
  const vy = (dy / norm) * power;
  sendMessage({ type: "throw", id: myId, vx, vy });
});

// Power meter
function updatePower(point) {
  if (!point) {
    ui.powerBar.style.width = "0%";
    ui.powerLabel.textContent = "Puissance: 0%";
    return;
  }
  const meState = me();
  const ref = meState?.ball || { x: 0, y: 0 };
  const dx = point.x - ref.x;
  const dy = point.y - ref.y;
  const dist = Math.hypot(dx, dy);
  const pct = Math.round(Math.min(dist, 50) / 50 * 100);
  ui.powerBar.style.width = pct + "%";
  ui.powerLabel.textContent = `Puissance: ${pct}%`;
}

// Countdown
function startCountdown() {
  if (countdownRunning) return;
  countdownRunning = true;
  const seq = ["3", "2", "1", "GO"];
  let idx = 0;
  ui.countdown.textContent = seq[idx];
  ui.countdown.classList.add("show");
  const step = () => {
    idx++;
    if (idx >= seq.length) {
      ui.countdown.classList.remove("show");
      ui.countdown.textContent = "";
      countdownRunning = false;
      return;
    }
    ui.countdown.textContent = seq[idx];
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
ui.create.onclick = () => {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  ui.room.value = code;
  isOwner = true;
  connect(code);
};
ui.join.onclick = () => {
  const code = ui.room.value.trim().toUpperCase();
  if (!code) return logToast("Code requis");
  isOwner = false;
  connect(code);
};
ui.play.onclick = () => ui.menu.classList.add("hidden");
ui.openMenu.onclick = () => ui.menu.classList.remove("hidden");
ui.startOverlay.onclick = () => {
  if (!isOwner) return logToast("Seul le createur peut demarrer");
  sendMessage({ type: "start" });
  startCountdown();
};
ui.replayOverlay.onclick = () => {
  if (!isOwner) return logToast("Seul le createur peut relancer");
  sendMessage({ type: "restart", id: myId });
  startCountdown();
};
ui.zoomIn.onclick = () => { zoomFactor = Math.min(1.4, zoomFactor + 0.1); resize(); };
ui.zoomOut.onclick = () => { zoomFactor = Math.max(0.55, zoomFactor - 0.1); resize(); };

// Init UI
setHud({ status: "Deconnecte", you: "Vous:  -", turn: "Phase: attente", score: "Joueurs: 0" });
updateStartButton();

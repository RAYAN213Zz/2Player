// --- Config & state -------------------------------------------------------
const BASE_W = 900;
const BASE_H = 600;
const BALL_RADIUS = 14;
const GOAL_RADIUS = 38;
const FRICTION = 0.992;
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
};

const ctx = ui.canvas.getContext("2d");
let W = 0, H = 0;
let scale = 1, offsetX = 0, offsetY = 0;
let zoomFactor = 1;
let countdownTimer = null;
let countdownRunning = false;
const STOP_EPS = 0.15;

let game = {
  phase: "waiting",
  players: [],
  goal: { x: BASE_W * 0.8, y: BASE_H * 0.5 },
  obstacles: [],
  winner: false,
};

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

function randomObstacles() {
  const obs = [];
  for (let i = 0; i < 5; i++) {
    const w = 130 + Math.random() * 40;
    const h = 24 + Math.random() * 10;
    const x = 120 + Math.random() * (BASE_W - 240 - w);
    const y = 140 + Math.random() * (BASE_H - 220 - h);
    obs.push({ x, y, w, h });
  }
  return obs;
}

function resetGame() {
  game.goal = { x: BASE_W * 0.8, y: BASE_H * 0.5 };
  game.obstacles = randomObstacles();
  game.players = [{
    id: "P1",
    name: "Joueur",
    ball: {
      x: BASE_W * (0.2 + Math.random() * 0.6),
      y: BASE_H * (0.2 + Math.random() * 0.6),
      vx: 0,
      vy: 0,
    }
  }];
  game.phase = "playing";
  game.winner = false;
  setHud({ status: "Pret", you: "Vous", turn: "Phase: en cours", score: "Joueur: 1" });
  ui.startOverlay.style.display = "none";
  ui.replayOverlay.style.display = "none";
  ui.itemLabel.textContent = "Atteins le trou";
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

function player() {
  return game.players[0];
}

ui.canvas.addEventListener("pointerdown", (e) => {
  if (game.phase !== "playing") return;
  const me = player();
  const moving = Math.abs(me.ball.vx) + Math.abs(me.ball.vy) > STOP_EPS;
  if (moving) return logToast("Attends que la balle s'arrete");
  const p = pointerPos(e);
  const dx = p.x - me.ball.x;
  const dy = p.y - me.ball.y;
  if (Math.hypot(dx, dy) > 55) return;
  dragging = true;
  dragStart = { x: me.ball.x, y: me.ball.y, current: p };
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
  const me = player();
  const p = dragStart.current;
  const dx = p.x - dragStart.x;
  const dy = p.y - dragStart.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return;
  const power = Math.min(dist, 50) / 24;
  const norm = Math.max(1, dist);
  const vx = (dx / norm) * power;
  const vy = (dy / norm) * power;
  me.ball.vx = vx * 4;
  me.ball.vy = vy * 4;
});

// Power meter
function updatePower(point) {
  if (!point) {
    ui.powerBar.style.width = "0%";
    ui.powerLabel.textContent = "Puissance: 0%";
    return;
  }
  const me = player();
  const dx = point.x - me.ball.x;
  const dy = point.y - me.ball.y;
  const dist = Math.hypot(dx, dy);
  const pct = Math.round(Math.min(dist, 50) / 50 * 100);
  ui.powerBar.style.width = pct + "%";
  ui.powerLabel.textContent = `Puissance: ${pct}%`;
}

// Countdown (optionnel au lancement)
function startCountdown(cb) {
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
      cb?.();
      return;
    }
    ui.countdown.textContent = seq[idx];
    countdownTimer = setTimeout(step, 700);
  };
  countdownTimer = setTimeout(step, 700);
}

// Physics & game loop
function updatePhysics() {
  const me = player();
  const b = me.ball;

  b.x += b.vx;
  b.y += b.vy;
  b.vx *= FRICTION;
  b.vy *= FRICTION;

  if (Math.abs(b.vx) < 0.02) b.vx = 0;
  if (Math.abs(b.vy) < 0.02) b.vy = 0;

  if (b.x < BALL_RADIUS) { b.x = BALL_RADIUS; b.vx *= -0.7; }
  if (b.x > BASE_W - BALL_RADIUS) { b.x = BASE_W - BALL_RADIUS; b.vx *= -0.7; }
  if (b.y < BALL_RADIUS) { b.y = BALL_RADIUS; b.vy *= -0.7; }
  if (b.y > BASE_H - BALL_RADIUS) { b.y = BASE_H - BALL_RADIUS; b.vy *= -0.7; }

  for (const o of game.obstacles) {
    const nearestX = Math.max(o.x, Math.min(b.x, o.x + o.w));
    const nearestY = Math.max(o.y, Math.min(b.y, o.y + o.h));
    const dx = b.x - nearestX;
    const dy = b.y - nearestY;
    const dist = Math.hypot(dx, dy);
    if (dist < BALL_RADIUS) {
      const overlap = BALL_RADIUS - dist + 0.5;
      const nx = dist === 0 ? 1 : dx / dist;
      const ny = dist === 0 ? 0 : dy / dist;
      b.x += nx * overlap;
      b.y += ny * overlap;
      const vn = b.vx * nx + b.vy * ny;
      b.vx -= 1.4 * vn * nx;
      b.vy -= 1.4 * vn * ny;
    }
  }

  const dxg = b.x - game.goal.x;
  const dyg = b.y - game.goal.y;
  const distg = Math.hypot(dxg, dyg);
  const stopped = Math.abs(b.vx) + Math.abs(b.vy) < 0.05;
  const inGoal = distg < BALL_RADIUS + GOAL_RADIUS * 0.9;
  if (!game.winner && inGoal && stopped && game.phase === "playing") {
    game.winner = true;
    game.phase = "ended";
    ui.replayOverlay.style.display = "inline-flex";
    setHud({ turn: "Phase: gagne" });
    logToast("GG ! Appuie sur Rejouer");
  }
}

// Render
function draw() {
  updatePhysics();

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  const grad = ctx.createLinearGradient(0, 0, BASE_W, BASE_H);
  grad.addColorStop(0, "#0b1328");
  grad.addColorStop(1, "#0a0f1f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, BASE_W, BASE_H);

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

  // player
  const p = player();
  ctx.beginPath();
  ctx.arc(p.ball.x, p.ball.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = palette[0];
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffffcc";
  ctx.fillText("Toi", p.ball.x, p.ball.y + 16);

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

// UI bindings
ui.play.onclick = () => {
  ui.menu.classList.add("hidden");
  startCountdown(resetGame);
};
ui.openMenu.onclick = () => ui.menu.classList.remove("hidden");
ui.startOverlay.onclick = () => startCountdown(resetGame);
ui.replayOverlay.onclick = () => startCountdown(resetGame);
ui.zoomIn.onclick = () => { zoomFactor = Math.min(1.4, zoomFactor + 0.1); resize(); };
ui.zoomOut.onclick = () => { zoomFactor = Math.max(0.55, zoomFactor - 0.1); resize(); };

// Init UI
resetGame();
draw();

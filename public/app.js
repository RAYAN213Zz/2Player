import { BASE_W, BASE_H, BALL_RADIUS, palette } from "./constants.js";
import { Game } from "./game.js";

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
const game = new Game();
let nextRoundScheduled = false;

function resize() {
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

function pointerPos(e) {
  const r = ui.canvas.getBoundingClientRect();
  const x = (e.clientX - r.left - offsetX) / scale;
  const y = (e.clientY - r.top - offsetY) / scale;
  return { x, y };
}

function updatePower(point) {
  if (!point) {
    ui.powerBar.style.width = "0%";
    ui.powerLabel.textContent = "Puissance: 0%";
    return;
  }
  const b = game.getState().ball;
  const dx = point.x - b.x;
  const dy = point.y - b.y;
  const dist = Math.hypot(dx, dy);
  const pct = Math.round(Math.min(dist, 50) / 50 * 100);
  ui.powerBar.style.width = pct + "%";
  ui.powerLabel.textContent = `Puissance: ${pct}%`;
}

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

function resetAndHud() {
  game.reset();
  setHud({ status: "Pret", you: "Vous", turn: "Phase: en cours", score: "Joueur: 1" });
  ui.startOverlay.style.display = "none";
  ui.replayOverlay.style.display = "none";
  ui.itemLabel.textContent = "Atteins le trou";
}

ui.canvas.addEventListener("pointerdown", (e) => {
  if (countdownRunning) return;
  const res = game.pointerDown(pointerPos(e));
  if (res?.message) logToast(res.message);
  if (res?.ok) updatePower(pointerPos(e)); else updatePower(null);
});

ui.canvas.addEventListener("pointermove", (e) => {
  if (countdownRunning) return;
  game.pointerMove(pointerPos(e));
  const state = game.getState();
  if (state.dragging && state.dragCurrent) updatePower(state.dragCurrent);
});

ui.canvas.addEventListener("pointerup", () => {
  if (countdownRunning) return;
  game.pointerUp();
  updatePower(null);
});

function draw() {
  const won = game.updatePhysics();
  const state = game.getState();

  if (won) {
    setHud({ turn: "Phase: gagne" });
    logToast("Bravo !");
    if (!nextRoundScheduled) {
      nextRoundScheduled = true;
      startCountdown(() => {
        nextRoundScheduled = false;
        resetAndHud();
      });
    }
  }

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  const grad = ctx.createLinearGradient(0, 0, BASE_W, BASE_H);
  grad.addColorStop(0, "#0b1328");
  grad.addColorStop(1, "#0a0f1f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, BASE_W, BASE_H);

  ctx.beginPath();
  ctx.arc(state.goal.x, state.goal.y, 36, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(124,244,255,0.15)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(124,244,255,0.5)";
  ctx.stroke();

  ctx.fillStyle = "rgba(255,120,120,0.35)";
  ctx.strokeStyle = "rgba(255,120,120,0.7)";
  state.obstacles.forEach(o => {
    ctx.beginPath();
    ctx.rect(o.x, o.y, o.w, o.h);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  const b = state.ball;
  ctx.beginPath();
  ctx.arc(b.x, b.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = palette[0];
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffffcc";
  ctx.fillText("Toi", b.x, b.y + 16);

  if (state.dragging && state.dragStart && state.dragCurrent) {
    const dx = state.dragCurrent.x - state.dragStart.x;
    const dy = state.dragCurrent.y - state.dragStart.y;
    const dist = Math.hypot(dx, dy);
    const power = Math.min(dist, 50) / 50;
    const hue = 120 - 120 * power;
    const color = `hsl(${hue}, 90%, 60%)`;
    ctx.beginPath();
    ctx.moveTo(state.dragStart.x, state.dragStart.y);
    ctx.lineTo(state.dragCurrent.x, state.dragCurrent.y);
    ctx.strokeStyle = color;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
  requestAnimationFrame(draw);
}

ui.play.onclick = () => {
  ui.menu.classList.add("hidden");
  startCountdown(resetAndHud);
};
ui.openMenu.onclick = () => ui.menu.classList.remove("hidden");
ui.startOverlay.onclick = () => startCountdown(resetAndHud);
ui.replayOverlay.onclick = () => startCountdown(resetAndHud);
ui.zoomIn.onclick = () => { zoomFactor = Math.min(1.4, zoomFactor + 0.1); resize(); };
ui.zoomOut.onclick = () => { zoomFactor = Math.max(0.55, zoomFactor - 0.1); resize(); };

resetAndHud();
draw();

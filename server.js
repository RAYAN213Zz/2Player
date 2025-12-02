import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";

const PORT = process.env.PORT || 10000;
const TICK = 1000 / 60;
const BALL_RADIUS = 14;
const GOAL_RADIUS = 38;
const WIDTH = 900;
const HEIGHT = 600;
const FRICTION = 0.992;
const TARGET_SCORE = 5;
const OBSTACLE_COUNT = 3;

const wss = new WebSocketServer({ port: PORT });
const rooms = new Map(); // roomCode -> { players: [{id, ws, role}], game, loop }

function makeGame() {
  return {
    ball: { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0 },
    goal: { x: WIDTH * 0.8, y: HEIGHT / 2 },
    turn: "P1",
    scores: { P1: 0, P2: 0 },
    obstacles: [],
    ready: true,
  };
}

function randomObstacles() {
  const obs = [];
  let tries = 0;
  while (obs.length < OBSTACLE_COUNT && tries < 200) {
    tries++;
    const w = 120;
    const h = 24;
    const x = 80 + Math.random() * (WIDTH - 160 - w);
    const y = 80 + Math.random() * (HEIGHT - 160 - h);
    const rect = { x, y, w, h };
    const tooCloseGoal = distanceRectCircle(rect, { x: WIDTH * 0.8, y: HEIGHT / 2, r: GOAL_RADIUS + 60 });
    const tooCloseCenter = distanceRectCircle(rect, { x: WIDTH / 2, y: HEIGHT / 2, r: 140 });
    const overlapOther = obs.some(o => rectsOverlap(o, rect));
    if (!tooCloseGoal && !tooCloseCenter && !overlapOther) {
      obs.push(rect);
    }
  }
  return obs;
}

function rectsOverlap(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

function distanceRectCircle(rect, circle) {
  const cx = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h));
  const dx = circle.x - cx;
  const dy = circle.y - cy;
  return Math.hypot(dx, dy) < circle.r;
}

function startLoop(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.loop) return;
  room.loop = setInterval(() => {
    const g = room.game;
    g.ball.x += g.ball.vx;
    g.ball.y += g.ball.vy;
    g.ball.vx *= FRICTION;
    g.ball.vy *= FRICTION;
    if (Math.abs(g.ball.vx) < 0.02) g.ball.vx = 0;
    if (Math.abs(g.ball.vy) < 0.02) g.ball.vy = 0;

    // murs
    if (g.ball.x < BALL_RADIUS) { g.ball.x = BALL_RADIUS; g.ball.vx *= -0.7; }
    if (g.ball.x > WIDTH - BALL_RADIUS) { g.ball.x = WIDTH - BALL_RADIUS; g.ball.vx *= -0.7; }
    if (g.ball.y < BALL_RADIUS) { g.ball.y = BALL_RADIUS; g.ball.vy *= -0.7; }
    if (g.ball.y > HEIGHT - BALL_RADIUS) { g.ball.y = HEIGHT - BALL_RADIUS; g.ball.vy *= -0.7; }

    // obstacles
    for (const o of g.obstacles) {
      const nearestX = Math.max(o.x, Math.min(g.ball.x, o.x + o.w));
      const nearestY = Math.max(o.y, Math.min(g.ball.y, o.y + o.h));
      const dx = g.ball.x - nearestX;
      const dy = g.ball.y - nearestY;
      const dist = Math.hypot(dx, dy);
      if (dist < BALL_RADIUS) {
        // resolve
        const overlap = BALL_RADIUS - dist + 0.5;
        const nx = dist === 0 ? 1 : dx / dist;
        const ny = dist === 0 ? 0 : dy / dist;
        g.ball.x += nx * overlap;
        g.ball.y += ny * overlap;
        // bounce
        const vn = g.ball.vx * nx + g.ball.vy * ny;
        g.ball.vx -= 1.4 * vn * nx;
        g.ball.vy -= 1.4 * vn * ny;
      }
    }

    // anti-collage murs
    if (g.ball.x <= BALL_RADIUS + 1 && g.ball.vx === 0) g.ball.vx = 0.4;
    if (g.ball.x >= WIDTH - BALL_RADIUS - 1 && g.ball.vx === 0) g.ball.vx = -0.4;
    if (g.ball.y <= BALL_RADIUS + 1 && g.ball.vy === 0) g.ball.vy = 0.4;
    if (g.ball.y >= HEIGHT - BALL_RADIUS - 1 && g.ball.vy === 0) g.ball.vy = -0.4;

    // goal check
    const dx = g.ball.x - g.goal.x;
    const dy = g.ball.y - g.goal.y;
    const dist = Math.hypot(dx, dy);
    const inGoal = dist < BALL_RADIUS + GOAL_RADIUS * 0.9;
    const stopped = Math.abs(g.ball.vx) + Math.abs(g.ball.vy) < 0.05;
    if (inGoal && stopped) {
      const scorer = g.turn === "P1" ? "P2" : "P1";
      g.scores[scorer] += 1;
      g.ball = { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0 };
      g.goal = { x: WIDTH * (0.2 + Math.random() * 0.6), y: HEIGHT * (0.2 + Math.random() * 0.6) };
      g.obstacles = randomObstacles();
      g.turn = g.turn === "P1" ? "P2" : "P1";
      g.ready = true;
      broadcast(roomCode, { type: "toast", message: `${scorer} marque ! (${g.scores.P1}-${g.scores.P2})` });
      if (g.scores[scorer] >= TARGET_SCORE) {
        broadcast(roomCode, { type: "toast", message: `${scorer} gagne la partie !` });
        g.scores = { P1: 0, P2: 0 };
      }
    }
    const speed = Math.abs(g.ball.vx) + Math.abs(g.ball.vy);
    if (!g.ready && speed < 0.05) {
      g.ball.vx = 0;
      g.ball.vy = 0;
      g.ready = true;
    }

    broadcast(roomCode, { type: "state", game: g });
  }, TICK);
}

function broadcast(roomCode, msg) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const data = JSON.stringify(msg);
  room.players.forEach((p) => {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  });
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "/", "http://localhost");
  const roomCode = (url.searchParams.get("room") || "DEFAULT").toUpperCase();
  if (!rooms.has(roomCode)) {
    const g = makeGame();
    g.obstacles = randomObstacles();
    rooms.set(roomCode, { players: [], game: g, loop: null });
  }
  const room = rooms.get(roomCode);

  if (room.players.length >= 2) {
    ws.send(JSON.stringify({ type: "toast", message: "Salle pleine" }));
    ws.close();
    return;
  }

  const id = nanoid(6);
  const role = room.players.length === 0 ? "P1" : "P2";
  room.players.push({ id, ws, role });

  ws.send(JSON.stringify({ type: "welcome", id, player: role }));
  ws.send(JSON.stringify({ type: "state", game: room.game }));
  broadcast(roomCode, { type: "toast", message: `${role} a rejoint` });

  startLoop(roomCode);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const g = room.game;
    if (msg.type === "throw" && g.turn === role) {
      if (!g.ready) {
        try { ws.send(JSON.stringify({ type: "toast", message: "Attends que la balle s'arrete" })); } catch {}
        return;
      }
      g.ready = false;
      g.ball.vx = msg.vx * 4;
      g.ball.vy = msg.vy * 4;
      const speed = Math.hypot(g.ball.vx, g.ball.vy);
      const maxSpeed = 12;
      if (speed > maxSpeed) {
        const k = maxSpeed / speed;
        g.ball.vx *= k;
        g.ball.vy *= k;
      }
      g.turn = g.turn === "P1" ? "P2" : "P1";
      broadcast(roomCode, { type: "state", game: g });
    }
  });

  ws.on("close", () => {
    if (!rooms.has(roomCode)) return;
    const r = rooms.get(roomCode);
    r.players = r.players.filter((p) => p.id !== id);
    broadcast(roomCode, { type: "toast", message: `${role} a quitté` });
    if (r.players.length === 0) {
      clearInterval(r.loop);
      rooms.delete(roomCode);
    }
  });
});

console.log(`WebSocket server running on :${PORT}`);

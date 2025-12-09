import { WebSocketServer } from "ws";
import { createServer } from "http";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

const PORT = process.env.PORT || 5000;
const TICK = 1000 / 60;
const BALL_RADIUS = 14;
const GOAL_RADIUS = 38;
const WIDTH = 900;
const HEIGHT = 600;
const FRICTION = 0.992;
const MAX_PLAYERS = 30;

// roomCode -> { players: [{id, ws, ball}], game, loop }
const rooms = new Map();

const httpServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "/index.html" : url.pathname);
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".html" ? "text/html" :
      ext === ".css" ? "text/css" :
      ext === ".js" ? "application/javascript" :
      ext === ".json" ? "application/json" :
      "text/plain";
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  } catch (e) {
    res.writeHead(404);
    res.end("Not found");
  }
});

const wss = new WebSocketServer({ server: httpServer });

function makeGame() {
  return {
    players: [],
    goal: { x: WIDTH * 0.8, y: HEIGHT * 0.5 },
    obstacles: [],
    phase: "waiting", // waiting | playing | ended
    winner: null,
  };
}

function startLoop(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.loop) return;
  room.loop = setInterval(() => {
    const g = room.game;

    // Physique pour chaque balle
    for (const p of g.players) {
      const b = p.ball;
      b.x += b.vx;
      b.y += b.vy;
      b.vx *= FRICTION;
      b.vy *= FRICTION;
      if (Math.abs(b.vx) < 0.02) b.vx = 0;
      if (Math.abs(b.vy) < 0.02) b.vy = 0;

      // murs
      if (b.x < BALL_RADIUS) { b.x = BALL_RADIUS; b.vx *= -0.7; }
      if (b.x > WIDTH - BALL_RADIUS) { b.x = WIDTH - BALL_RADIUS; b.vx *= -0.7; }
      if (b.y < BALL_RADIUS) { b.y = BALL_RADIUS; b.vy *= -0.7; }
      if (b.y > HEIGHT - BALL_RADIUS) { b.y = HEIGHT - BALL_RADIUS; b.vy *= -0.7; }

      // obstacles (rectangles)
      for (const o of g.obstacles) {
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

      // goal
      const dxg = b.x - g.goal.x;
      const dyg = b.y - g.goal.y;
      const distg = Math.hypot(dxg, dyg);
      const inGoal = distg < BALL_RADIUS + GOAL_RADIUS * 0.9;
      const stopped = Math.abs(b.vx) + Math.abs(b.vy) < 0.05;
      if (inGoal && stopped && !g.winner && g.phase === "playing") {
        g.winner = p.id;
        g.phase = "ended";
        broadcast(roomCode, { type: "toast", message: `${p.id} gagne !` });
      }
    }

    resolvePlayerCollisions(g);

    broadcast(roomCode, { type: "state", game: g });
  }, TICK);
}

function randomObstacles() {
  const obs = [];
  for (let i = 0; i < 3; i++) {
    const w = 150;
    const h = 28;
    const x = 120 + Math.random() * (WIDTH - 240 - w);
    const y = 180 + Math.random() * (HEIGHT - 260 - h);
    obs.push({ x, y, w, h });
  }
  return obs;
}

function resolvePlayerCollisions(game) {
  for (let i = 0; i < game.players.length; i++) {
    for (let j = i + 1; j < game.players.length; j++) {
      const a = game.players[i].ball;
      const b = game.players[j].ball;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minDist = BALL_RADIUS * 2;
      if (dist > 0 && dist < minDist) {
        const overlap = (minDist - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        const avn = a.vx * nx + a.vy * ny;
        const bvn = b.vx * nx + b.vy * ny;
        const dv = bvn - avn;
        a.vx += dv * nx;
        a.vy += dv * ny;
        b.vx -= dv * nx;
        b.vy -= dv * ny;
      }
    }
  }
}

function broadcast(roomCode, msg) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const data = JSON.stringify(msg);
  for (const p of room.players) {
    if (p.ws.readyState === p.ws.OPEN) {
      p.ws.send(data);
    }
  }
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
  if (room.players.length >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: "toast", message: "Salle pleine" }));
    ws.close();
    return;
  }

  const role = `P${room.players.length + 1}`;
  const ball = {
    x: WIDTH * (0.2 + Math.random() * 0.6),
    y: HEIGHT * (0.2 + Math.random() * 0.6),
    vx: 0,
    vy: 0,
  };
  room.players.push({ id: role, ws, role, ball });
  room.game.players = room.players.map(p => ({ id: p.role, ball: p.ball }));

  ws.send(JSON.stringify({ type: "welcome", player: role, owner: role === "P1" }));
  ws.send(JSON.stringify({ type: "state", game: room.game }));
  broadcast(roomCode, { type: "toast", message: `${role} a rejoint` });

  startLoop(roomCode);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const g = room.game;

    if (msg.type === "start") {
      g.phase = "playing";
      g.winner = null;
      broadcast(roomCode, { type: "start" });
      broadcast(roomCode, { type: "state", game: g });
      return;
    }

    if (msg.type === "throw") {
      const player = room.players.find(p => p.role === msg.id);
      if (!player) return;
      if (g.phase !== "playing" || g.winner) return;
      const b = player.ball;
      b.vx = (msg.vx || 0) * 4;
      b.vy = (msg.vy || 0) * 4;
      const speed = Math.hypot(b.vx, b.vy);
      const maxSpeed = 14;
      if (speed > maxSpeed) {
        const k = maxSpeed / speed;
        b.vx *= k;
        b.vy *= k;
      }
      g.players = room.players.map(p => ({ id: p.role, ball: p.ball }));
      broadcast(roomCode, { type: "state", game: g });
      return;
    }
  });

  ws.on("close", () => {
    if (!rooms.has(roomCode)) return;
    const r = rooms.get(roomCode);
    r.players = r.players.filter((p) => p.role !== role);
    r.game.players = r.players.map(p => ({ id: p.role, ball: p.ball }));
    broadcast(roomCode, { type: "toast", message: `${role} a quitté` });
    if (r.players.length === 0) {
      clearInterval(r.loop);
      rooms.delete(roomCode);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`HTTP + WS server on http://localhost:${PORT}`);
});

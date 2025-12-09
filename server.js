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
const ITEM_RADIUS = 18;
const FREEZE_MS = 4000;
const ITEM_RESPAWN_MS = 6000;
const FIRST_ITEM_DELAY_MS = 1200;
const REVERSE_MS = 5000;
const BOOST_MS = 6000;
const START_SPEED_LIMIT = 0.2; // bloque un tir tant que la balle bouge

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
    items: [],
    freeze: { active: false, by: null, until: 0, frozen: [] },
    reverse: { active: false, by: null, until: 0 },
  };
}

function startLoop(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.loop) return;
  room.loop = setInterval(() => {
    const g = room.game;
    const now = Date.now();

    // Fin d'effet freeze
    if (g.freeze.active && now > g.freeze.until) {
      g.freeze = { active: false, by: null, until: 0, frozen: [] };
    }
    if (g.reverse.active && now > g.reverse.until) {
      g.reverse = { active: false, by: null, until: 0 };
    }

    // Physique pour chaque balle
    for (const p of g.players) {
      const b = p.ball;
      const isFrozen = g.freeze.active && g.freeze.frozen.includes(p.id);
      if (isFrozen) { b.vx = 0; b.vy = 0; }
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

      // items pick
      for (const item of [...g.items]) {
        const dx = b.x - item.x;
        const dy = b.y - item.y;
        const dist = Math.hypot(dx, dy);
        if (dist < BALL_RADIUS + ITEM_RADIUS) {
          g.items = g.items.filter((it) => it.id !== item.id);
          if (item.type === "freeze") triggerFreeze(roomCode, p.id);
          if (item.type === "reverse") triggerReverse(roomCode, p.id);
          if (item.type === "boost") giveBoost(roomCode, p.id);
          scheduleNextItem(room);
        }
      }
    }

    resolvePlayerCollisions(g);

    // spawn item
    if (g.items.length === 0 && now >= room.nextItemAt) {
      g.items.push(makeItem(randomItemType()));
      scheduleNextItem(room);
    }

    broadcast(roomCode, { type: "state", game: g });
  }, TICK);
}

function randomObstacles() {
  const obs = [];
  for (let i = 0; i < 5; i++) {
    const w = 130 + Math.random() * 40;
    const h = 24 + Math.random() * 10;
    const x = 120 + Math.random() * (WIDTH - 240 - w);
    const y = 140 + Math.random() * (HEIGHT - 220 - h);
    obs.push({ x, y, w, h });
  }
  return obs;
}

function randomItemType() {
  const pool = ["freeze", "reverse", "boost"];
  return pool[Math.floor(Math.random() * pool.length)];
}

function makeItem(type) {
  return {
    id: nanoid(6),
    type,
    x: 140 + Math.random() * (WIDTH - 280),
    y: 140 + Math.random() * (HEIGHT - 200),
  };
}

function scheduleNextItem(room) {
  room.nextItemAt = Date.now() + ITEM_RESPAWN_MS;
}

function triggerFreeze(roomCode, byId) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const g = room.game;
  const frozen = (g.players || []).map((p) => p.id).filter((id) => id !== byId);
  const byName = room.players.find(p => p.role === byId)?.name || byId;
  g.freeze = { active: true, by: byName, until: Date.now() + FREEZE_MS, frozen };
  for (const p of g.players) {
    if (p.id !== byId) {
      p.ball.vx = 0;
      p.ball.vy = 0;
    }
  }
  broadcast(roomCode, { type: "toast", message: `${byName} a gelé tout le monde !` });
}

function triggerReverse(roomCode, byId) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const g = room.game;
  const byName = room.players.find(p => p.role === byId)?.name || byId;
  g.reverse = { active: true, by: byName, until: Date.now() + REVERSE_MS };
  for (const p of g.players) {
    p.ball.vx *= -1;
    p.ball.vy *= -1;
  }
  broadcast(roomCode, { type: "toast", message: `${byName} inverse les controles !` });
}

function giveBoost(roomCode, byId) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const target = room.players.find(p => p.role === byId);
  if (!target) return;
  target.boostUntil = Date.now() + BOOST_MS;
  const byName = target.name || byId;
  broadcast(roomCode, { type: "toast", message: `${byName} gagne un boost !` });
}

function resetForStart(room) {
  const g = room.game;
  g.phase = "playing";
  g.winner = null;
  g.items = [];
  g.freeze = { active: false, by: null, until: 0, frozen: [] };
  g.reverse = { active: false, by: null, until: 0 };
  g.obstacles = randomObstacles();
  for (const p of room.players) {
    p.ball.x = WIDTH * (0.2 + Math.random() * 0.6);
    p.ball.y = HEIGHT * (0.2 + Math.random() * 0.6);
    p.ball.vx = 0;
    p.ball.vy = 0;
    p.boostUntil = 0;
  }
  g.players = room.players.map(p => ({ id: p.role, name: p.name, ball: p.ball, boostUntil: p.boostUntil || 0 }));
  room.nextItemAt = Date.now() + FIRST_ITEM_DELAY_MS;
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
  const rawName = (url.searchParams.get("name") || "").trim();
  const safeName = rawName.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 12);

  if (!rooms.has(roomCode)) {
    const g = makeGame();
    g.obstacles = randomObstacles();
    rooms.set(roomCode, { players: [], game: g, loop: null, nextItemAt: Date.now() + FIRST_ITEM_DELAY_MS });
  }

  const room = rooms.get(roomCode);
  if (room.players.length >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: "toast", message: "Salle pleine" }));
    ws.close();
    return;
  }

  const role = `P${room.players.length + 1}`;
  const name = safeName || role;
  const ball = {
    x: WIDTH * (0.2 + Math.random() * 0.6),
    y: HEIGHT * (0.2 + Math.random() * 0.6),
    vx: 0,
    vy: 0,
  };
  room.players.push({ id: role, name, ws, role, ball, boostUntil: 0 });
  room.game.players = room.players.map(p => ({ id: p.role, name: p.name, ball: p.ball, boostUntil: p.boostUntil || 0 }));

  ws.send(JSON.stringify({ type: "welcome", player: role, name, owner: role === "P1" }));
  ws.send(JSON.stringify({ type: "state", game: room.game }));
  broadcast(roomCode, { type: "toast", message: `${role} a rejoint` });

  startLoop(roomCode);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const g = room.game;

    if (msg.type === "start") {
      resetForStart(room);
      broadcast(roomCode, { type: "start" });
      broadcast(roomCode, { type: "state", game: g });
      return;
    }

    if (msg.type === "restart") {
      const owner = room.players[0]?.role;
      if (owner && owner !== msg.id) return;
      resetForStart(room);
      broadcast(roomCode, { type: "toast", message: "Nouvelle manche" });
      broadcast(roomCode, { type: "start" });
      broadcast(roomCode, { type: "state", game: g });
      return;
    }

    if (msg.type === "throw") {
      const player = room.players.find(p => p.role === msg.id);
      if (!player) return;
      if (g.freeze.active && g.freeze.frozen.includes(msg.id)) return;
      if (g.phase !== "playing" || g.winner) return;
      const moving = Math.abs(player.ball.vx) + Math.abs(player.ball.vy) > START_SPEED_LIMIT;
      if (moving) return;
      const boost = Date.now() < (player.boostUntil || 0) ? 1.5 : 1;
      const b = player.ball;
      let vx = (msg.vx || 0) * 4 * boost;
      let vy = (msg.vy || 0) * 4 * boost;
      if (g.reverse.active) { vx *= -1; vy *= -1; }
      b.vx = vx;
      b.vy = vy;
      const speed = Math.hypot(b.vx, b.vy);
      const maxSpeed = 14;
      if (speed > maxSpeed) {
        const k = maxSpeed / speed;
        b.vx *= k;
        b.vy *= k;
      }
      g.players = room.players.map(p => ({ id: p.role, name: p.name, ball: p.ball, boostUntil: p.boostUntil || 0 }));
      broadcast(roomCode, { type: "state", game: g });
      return;
    }
  });

  ws.on("close", () => {
    if (!rooms.has(roomCode)) return;
    const r = rooms.get(roomCode);
    r.players = r.players.filter((p) => p.role !== role);
    r.game.players = r.players.map(p => ({ id: p.role, name: p.name, ball: p.ball, boostUntil: p.boostUntil || 0 }));
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

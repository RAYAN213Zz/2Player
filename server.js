import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";

const PORT = process.env.PORT || 10000;
const TICK = 1000 / 60;
const BALL_RADIUS = 14;
const GOAL_RADIUS = 36;
const WIDTH = 900;
const HEIGHT = 600;
const FRICTION = 0.985;

const wss = new WebSocketServer({ port: PORT });
const rooms = new Map(); // roomCode -> { players: [{id, ws, role}], game, loop }

function makeGame() {
  return {
    ball: { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0 },
    goal: { x: WIDTH * 0.8, y: HEIGHT / 2 },
    turn: "P1",
    scores: { P1: 0, P2: 0 },
  };
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

    // goal check
    const dx = g.ball.x - g.goal.x;
    const dy = g.ball.y - g.goal.y;
    const dist = Math.hypot(dx, dy);
    if (dist < BALL_RADIUS + GOAL_RADIUS * 0.7) {
      const scorer = g.turn === "P1" ? "P2" : "P1";
      g.scores[scorer] += 1;
      g.ball = { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0 };
      g.goal = { x: WIDTH * (0.2 + Math.random() * 0.6), y: HEIGHT * (0.2 + Math.random() * 0.6) };
      g.turn = g.turn === "P1" ? "P2" : "P1";
      broadcast(roomCode, { type: "toast", message: `${scorer} marque !` });
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
    rooms.set(roomCode, { players: [], game: makeGame(), loop: null });
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
      g.ball.vx = msg.vx * 10;
      g.ball.vy = msg.vy * 10;
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

import WebSocket, { WebSocketServer } from "ws";
import { nanoid } from "nanoid";

const PORT = process.env.PORT || 10000;
const wss = new WebSocketServer({ port: PORT });

let rooms = {};

function startGameLoop(room) {
    if (rooms[room].loopRunning) return;
    rooms[room].loopRunning = true;

    const g = rooms[room].game;

    setInterval(() => {

        // Physique
        g.ball.x += g.ball.vx;
        g.ball.y += g.ball.vy;

        g.ball.vx *= 0.97;
        g.ball.vy *= 0.97;

        if (g.ball.x < 20 || g.ball.x > 780) g.ball.vx *= -1;
        if (g.ball.y < 20 || g.ball.y > 580) g.ball.vy *= -1;

        // Envoi aux joueurs
        rooms[room].players.forEach(p => {
            p.ws.send(JSON.stringify({ type: "state", game: g }));
        });

    }, 1000 / 60);
}

wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const room = url.searchParams.get("room");

    if (!rooms[room]) {
        rooms[room] = {
            players: [],
            loopRunning: false,
            game: {
                ball: { x: 400, y: 300, vx: 0, vy: 0 },
                goal: { x: 700, y: 300 },
                turn: "P1",
                scores: { P1: 0, P2: 0 }
            }
        };
    }

    const r = rooms[room];
    const id = nanoid(6);

    const player = r.players.length === 0 ? "P1" : "P2";
    r.players.push({ id, ws, player });

    ws.send(JSON.stringify({ type: "welcome", id, player }));

    startGameLoop(room);

    ws.on("message", raw => {
        const msg = JSON.parse(raw);
        const g = r.game;

        if (msg.type === "throw" && g.turn === player) {
            g.ball.vx = msg.vx * 5;
            g.ball.vy = msg.vy * 5;
            g.turn = (g.turn === "P1" ? "P2" : "P1");
        }
    });

    ws.on("close", () => {
        r.players = r.players.filter(p => p.id !== id);
        if (r.players.length === 0) delete rooms[room];
    });
});

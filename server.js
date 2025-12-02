import WebSocket, { WebSocketServer } from "ws";
import { nanoid } from "nanoid";

const PORT = process.env.PORT || 10000;

const wss = new WebSocketServer({ port: PORT });

let rooms = {};

wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const room = url.searchParams.get("room");

    if (!rooms[room]) rooms[room] = {
        players: [],
        game: null
    };

    const id = nanoid(6);
    const roomData = rooms[room];

    // assignation P1/P2
    const player = roomData.players.length === 0 ? "P1" : "P2";
    roomData.players.push({ id, ws, player });

    // game init si P1
    if (!roomData.game) {
        roomData.game = {
            ball: { x: 400, y: 300, vx: 0, vy: 0 },
            goal: { x: 700, y: 300 },
            turn: "P1",
            scores: { P1: 0, P2: 0 }
        };
    }

    ws.send(JSON.stringify({ type: "welcome", id, player }));

    ws.on("message", raw => {
        const msg = JSON.parse(raw);
        const g = roomData.game;

        if (msg.type === "throw" && g.turn === player) {
            g.ball.vx = msg.vx;
            g.ball.vy = msg.vy;
            g.turn = g.turn === "P1" ? "P2" : "P1";
        }

        // envoyer l'état aux joueurs
        roomData.players.forEach(p => {
            p.ws.send(JSON.stringify({ type: "state", game: g }));
        });
    });

    ws.on("close", () => {
        rooms[room].players = rooms[room].players.filter(p => p.id !== id);
        if (rooms[room].players.length === 0) {
            delete rooms[room];
        }
    });
});

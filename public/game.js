import { BASE_W, BASE_H, BALL_RADIUS, GOAL_RADIUS, FRICTION } from "./constants.js";

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

export class Game {
  constructor() {
    this.dragging = false;
    this.dragStart = null;
    this.dragCurrent = null;
    this.reset();
  }

  reset() {
    this.goal = { x: BASE_W * 0.8, y: BASE_H * 0.5 };
    this.obstacles = randomObstacles();
    this.ball = {
      x: BASE_W * (0.2 + Math.random() * 0.6),
      y: BASE_H * (0.2 + Math.random() * 0.6),
      vx: 0,
      vy: 0,
    };
    this.phase = "playing";
    this.winner = false;
    this.dragging = false;
    this.dragStart = null;
    this.dragCurrent = null;
  }

  isBallMoving() {
    return Math.abs(this.ball.vx) + Math.abs(this.ball.vy) > 0.15;
  }

  pointerDown(pos) {
    if (this.phase !== "playing") return { ok: false, message: "La partie n'a pas commence" };
    if (this.isBallMoving()) return { ok: false, message: "Attends que la balle s'arrete" };
    const dx = pos.x - this.ball.x;
    const dy = pos.y - this.ball.y;
    if (Math.hypot(dx, dy) > 55) return { ok: false };
    this.dragging = true;
    this.dragStart = { x: this.ball.x, y: this.ball.y };
    this.dragCurrent = pos;
    return { ok: true };
  }

  pointerMove(pos) {
    if (!this.dragging) return;
    this.dragCurrent = pos;
  }

  pointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    const p = this.dragCurrent;
    const dx = p.x - this.dragStart.x;
    const dy = p.y - this.dragStart.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    const power = Math.min(dist, 50) / 24;
    const norm = Math.max(1, dist);
    const vx = (dx / norm) * power;
    const vy = (dy / norm) * power;
    this.ball.vx = vx * 4;
    this.ball.vy = vy * 4;
    this.dragStart = null;
    this.dragCurrent = null;
  }

  updatePhysics() {
    if (this.phase !== "playing") return false;
    const b = this.ball;
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

    for (const o of this.obstacles) {
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

    const dxg = b.x - this.goal.x;
    const dyg = b.y - this.goal.y;
    const distg = Math.hypot(dxg, dyg);
    const stopped = Math.abs(b.vx) + Math.abs(b.vy) < 0.05;
    const inGoal = distg < BALL_RADIUS + GOAL_RADIUS * 0.9;
    if (!this.winner && inGoal && stopped && this.phase === "playing") {
      this.winner = true;
      this.phase = "ended";
      return true;
    }
    return false;
  }

  getState() {
    return {
      goal: this.goal,
      obstacles: this.obstacles,
      ball: this.ball,
      dragging: this.dragging,
      dragStart: this.dragStart,
      dragCurrent: this.dragCurrent,
      phase: this.phase,
      winner: this.winner,
    };
  }
}

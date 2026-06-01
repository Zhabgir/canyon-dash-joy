import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Canyon Flyer" },
      { name: "description", content: "Fly the plane through a narrow canyon. Avoid the walls!" },
    ],
  }),
  component: Game,
});

type GameState = "menu" | "playing" | "over";

const W = 800;
const H = 500;
const PLANE_X = 120;
const PLANE_SIZE = 24;
const BASE_SPEED = 3.5;
const MAX_SPEED = 10;
const PLAYER_SPEED = 4.5;

interface Segment {
  topH: number;
  botH: number;
}

function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<GameState>("menu");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);

  const stateRef = useRef(state);
  stateRef.current = state;

  const keys = useRef({ up: false, down: false });
  const planeY = useRef(H / 2);
  const segments = useRef<Segment[]>([]);
  const offset = useRef(0);
  const distance = useRef(0);
  const SEG_W = 20;

  const resetWorld = useCallback(() => {
    planeY.current = H / 2;
    offset.current = 0;
    distance.current = 0;
    segments.current = [];
    const count = Math.ceil(W / SEG_W) + 2;
    let gap = 260;
    let center = H / 2;
    for (let i = 0; i < count; i++) {
      const top = center - gap / 2;
      const bot = H - (center + gap / 2);
      segments.current.push({ topH: top, botH: bot });
    }
    setScore(0);
  }, []);

  const start = () => {
    resetWorld();
    setState("playing");
  };

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") keys.current.up = true;
      if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") keys.current.down = true;
      if (e.key === " " || e.key === "Enter") {
        if (stateRef.current !== "playing") start();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") keys.current.up = false;
      if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") keys.current.down = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const loop = () => {
      if (stateRef.current === "playing") {
        // input
        if (keys.current.up) planeY.current -= PLAYER_SPEED;
        if (keys.current.down) planeY.current += PLAYER_SPEED;

        // dynamic speed — grows with distance
        const speed = Math.min(MAX_SPEED, BASE_SPEED + distance.current / 2500);

        // scroll
        offset.current += speed;
        distance.current += speed;
        while (offset.current >= SEG_W) {
          offset.current -= SEG_W;
          segments.current.shift();
          const last = segments.current[segments.current.length - 1];
          const prevTop = last.topH;
          const prevBot = last.botH;
          const prevGap = H - prevTop - prevBot;
          const prevCenter = prevTop + prevGap / 2;

          const difficulty = Math.min(1, distance.current / 6000);
          const segIndex = Math.floor(distance.current / SEG_W);

          // every ~40 segments spawn a Flappy-style "pipe" chokepoint with random gap height
          const isPipe = segIndex > 0 && segIndex % 40 === 0;
          let newGap: number;
          let newCenter: number;

          if (isPipe) {
            const minPipeGap = 170 - 30 * difficulty;
            newGap = minPipeGap + Math.random() * 40;
            newCenter = 60 + newGap / 2 + Math.random() * (H - 120 - newGap);
          } else {
            const minGap = 260 - 80 * difficulty;
            newGap = Math.max(minGap, prevGap + (Math.random() - 0.5) * 40);
            const drift = 30 + 40 * difficulty;
            newCenter = Math.max(
              newGap / 2 + 20,
              Math.min(H - newGap / 2 - 20, prevCenter + (Math.random() - 0.5) * drift),
            );
          }
          segments.current.push({
            topH: newCenter - newGap / 2,
            botH: H - (newCenter + newGap / 2),
          });
        }

        // collision
        const idx = Math.floor((PLANE_X + offset.current) / SEG_W);
        const seg = segments.current[idx];
        if (seg) {
          const planeTop = planeY.current - PLANE_SIZE / 2;
          const planeBot = planeY.current + PLANE_SIZE / 2;
          if (planeTop < seg.topH || planeBot > H - seg.botH) {
            const d = Math.floor(distance.current / 10);
            setScore(d);
            setBest((b) => Math.max(b, d));
            setState("over");
          }
        }
        if (planeY.current < 0 || planeY.current > H) {
          const d = Math.floor(distance.current / 10);
          setScore(d);
          setBest((b) => Math.max(b, d));
          setState("over");
        }
        setScore(Math.floor(distance.current / 10));
      }

      // draw
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, W, H);

      // canyon walls
      ctx.fillStyle = "#e85d3a";
      for (let i = 0; i < segments.current.length; i++) {
        const x = i * SEG_W - offset.current;
        const s = segments.current[i];
        ctx.fillRect(x, 0, SEG_W + 1, s.topH);
        ctx.fillRect(x, H - s.botH, SEG_W + 1, s.botH);
      }

      // fighter jet
      ctx.save();
      ctx.translate(PLANE_X, planeY.current);

      // afterburner flame
      const flameLen = 10 + Math.random() * 6;
      const grad = ctx.createLinearGradient(-18 - flameLen, 0, -18, 0);
      grad.addColorStop(0, "rgba(255,80,0,0)");
      grad.addColorStop(0.5, "rgba(255,160,40,0.9)");
      grad.addColorStop(1, "rgba(255,230,120,1)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-18, -3);
      ctx.lineTo(-18 - flameLen, 0);
      ctx.lineTo(-18, 3);
      ctx.closePath();
      ctx.fill();

      // rear wings (tail)
      ctx.fillStyle = "#5a6470";
      ctx.beginPath();
      ctx.moveTo(-14, -2);
      ctx.lineTo(-22, -12);
      ctx.lineTo(-10, -2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-14, 2);
      ctx.lineTo(-22, 12);
      ctx.lineTo(-10, 2);
      ctx.closePath();
      ctx.fill();

      // main delta wings
      ctx.fillStyle = "#7a8693";
      ctx.beginPath();
      ctx.moveTo(2, -3);
      ctx.lineTo(-12, -18);
      ctx.lineTo(-16, -18);
      ctx.lineTo(-8, -3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(2, 3);
      ctx.lineTo(-12, 18);
      ctx.lineTo(-16, 18);
      ctx.lineTo(-8, 3);
      ctx.closePath();
      ctx.fill();

      // fuselage
      ctx.fillStyle = "#c8ced6";
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(8, -5);
      ctx.lineTo(-18, -4);
      ctx.lineTo(-18, 4);
      ctx.lineTo(8, 5);
      ctx.closePath();
      ctx.fill();

      // nose tip
      ctx.fillStyle = "#9aa3ad";
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(14, -2);
      ctx.lineTo(14, 2);
      ctx.closePath();
      ctx.fill();

      // cockpit canopy
      ctx.fillStyle = "#3b6ea8";
      ctx.beginPath();
      ctx.ellipse(6, -1, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.ellipse(7, -1.8, 2, 0.8, 0, 0, Math.PI * 2);
      ctx.fill();

      // missile under each wing
      ctx.fillStyle = "#444b54";
      ctx.fillRect(-10, -14, 8, 2);
      ctx.fillRect(-10, 12, 8, 2);

      ctx.restore();

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-4">
      <h1 className="text-3xl font-bold text-foreground">Canyon Flyer</h1>
      <div className="relative" style={{ width: W, maxWidth: "100%" }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="w-full rounded-lg border border-border shadow-lg"
          style={{ aspectRatio: `${W}/${H}` }}
        />
        <div className="pointer-events-none absolute left-4 top-3 font-mono text-lg text-white drop-shadow">
          Score: {score} {best > 0 && <span className="ml-3 opacity-70">Best: {best}</span>}
        </div>
        <div className="pointer-events-none absolute right-4 top-3 font-mono text-sm text-white/80 drop-shadow">
          Speed: {Math.min(MAX_SPEED, BASE_SPEED + score / 250).toFixed(1)}x
        </div>

        {state === "menu" && (
          <Overlay>
            <h2 className="text-2xl font-semibold text-white">Canyon Flyer</h2>
            <p className="max-w-xs text-center text-sm text-white/80">
              Управление: ↑ / ↓ (или W / S). Лети через каньон и не врежься в стены.
            </p>
            <button
              onClick={start}
              className="rounded-md bg-primary px-6 py-2 text-base font-medium text-primary-foreground hover:bg-primary/90"
            >
              Start
            </button>
          </Overlay>
        )}

        {state === "over" && (
          <Overlay>
            <h2 className="text-2xl font-semibold text-white">Game Over</h2>
            <p className="text-white/80">Score: {score}</p>
            <button
              onClick={start}
              className="rounded-md bg-primary px-6 py-2 text-base font-medium text-primary-foreground hover:bg-primary/90"
            >
              Restart
            </button>
          </Overlay>
        )}
      </div>
      <p className="text-sm text-muted-foreground">↑ / ↓ — управление · Space — старт</p>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-lg bg-black/60 backdrop-blur-sm">
      {children}
    </div>
  );
}

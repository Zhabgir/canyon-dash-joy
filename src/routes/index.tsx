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
const SCROLL_SPEED = 4;
const PLAYER_SPEED = 4;

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

        // scroll
        offset.current += SCROLL_SPEED;
        distance.current += SCROLL_SPEED;
        while (offset.current >= SEG_W) {
          offset.current -= SEG_W;
          segments.current.shift();
          const last = segments.current[segments.current.length - 1];
          const lastCenter = H / 2 + (H / 2 - last.topH - (H - last.topH - last.botH) / 2);
          // smooth random walk
          const prevTop = last.topH;
          const prevBot = last.botH;
          const prevGap = H - prevTop - prevBot;
          const prevCenter = prevTop + prevGap / 2;
          const difficulty = Math.min(1, distance.current / 8000);
          const minGap = 220 - 90 * difficulty;
          const newGap = Math.max(minGap, prevGap + (Math.random() - 0.5) * 30);
          const newCenter = Math.max(
            newGap / 2 + 30,
            Math.min(H - newGap / 2 - 30, prevCenter + (Math.random() - 0.5) * 50),
          );
          segments.current.push({
            topH: newCenter - newGap / 2,
            botH: H - (newCenter + newGap / 2),
          });
          void lastCenter;
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

      // plane
      ctx.save();
      ctx.translate(PLANE_X, planeY.current);
      ctx.fillStyle = "#f5f5f5";
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-12, -10);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-12, 10);
      ctx.closePath();
      ctx.fill();
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

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
  const rocks = useRef<
    { x: number; y: number; r: number; vy: number; vx: number; rot: number; spin: number }[]
  >([]);
  const rockTimer = useRef(0);

  const resetWorld = useCallback(() => {
    planeY.current = H / 2;
    offset.current = 0;
    distance.current = 0;
    segments.current = [];
    rocks.current = [];
    rockTimer.current = 60;
    const count = Math.ceil(W / SEG_W) + 2;
    const gap = 260;
    const center = H / 2;
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
            const minPipeGap = 200 - 20 * difficulty;
            newGap = minPipeGap + Math.random() * 55;
            const targetCenter = 70 + newGap / 2 + Math.random() * (H - 140 - newGap);
            const maxCenterStep = 34 + 8 * difficulty;
            newCenter = Math.max(
              newGap / 2 + 28,
              Math.min(
                H - newGap / 2 - 28,
                Math.max(
                  prevCenter - maxCenterStep,
                  Math.min(prevCenter + maxCenterStep, targetCenter),
                ),
              ),
            );
          } else {
            const minGap = 285 - 55 * difficulty;
            newGap = Math.max(minGap, prevGap + (Math.random() - 0.5) * 28);
            const drift = 22 + 26 * difficulty;
            newCenter = Math.max(
              newGap / 2 + 28,
              Math.min(H - newGap / 2 - 28, prevCenter + (Math.random() - 0.5) * drift),
            );
          }
          segments.current.push({
            topH: newCenter - newGap / 2,
            botH: H - (newCenter + newGap / 2),
          });
        }

        // spawn falling rocks
        const difficultyAll = Math.min(1, distance.current / 6000);
        rockTimer.current -= 1;
        if (rockTimer.current <= 0) {
          // find a safe-ish x (within visible play area)
          const x = 200 + Math.random() * (W - 250);
          // y starts above the canyon ceiling for that column
          const colIdx = Math.floor((x + offset.current) / SEG_W);
          const topAtX = segments.current[colIdx]?.topH ?? 0;
          const r = 6 + Math.random() * 10;
          rocks.current.push({
            x,
            y: topAtX - r - 4,
            r,
            vy: 1.4 + Math.random() * 1.6 + difficultyAll * 2.5,
            vx: -speed * 0.4 + (Math.random() - 0.5) * 1.2,
            rot: Math.random() * Math.PI,
            spin: (Math.random() - 0.5) * 0.12,
          });
          rockTimer.current = Math.max(18, 75 - difficultyAll * 45 - Math.random() * 20);
        }
        // update rocks
        for (let i = rocks.current.length - 1; i >= 0; i--) {
          const rk = rocks.current[i];
          rk.x += rk.vx;
          rk.y += rk.vy;
          rk.vy += 0.08;
          rk.rot += rk.spin;
          // remove offscreen or buried in bottom wall
          const colIdx = Math.floor((rk.x + offset.current) / SEG_W);
          const segR = segments.current[colIdx];
          if (
            rk.x < -30 ||
            rk.x > W + 30 ||
            (segR && rk.y - rk.r > H - segR.botH)
          ) {
            rocks.current.splice(i, 1);
            continue;
          }
          // collision with plane (circle vs rect)
          const dx = Math.max(PLANE_X - PLANE_SIZE / 2, Math.min(rk.x, PLANE_X + PLANE_SIZE / 2));
          const dy = Math.max(
            planeY.current - PLANE_SIZE / 2,
            Math.min(rk.y, planeY.current + PLANE_SIZE / 2),
          );
          const dd = (dx - rk.x) ** 2 + (dy - rk.y) ** 2;
          if (dd < rk.r * rk.r) {
            const d = Math.floor(distance.current / 10);
            setScore(d);
            setBest((b) => Math.max(b, d));
            setState("over");
          }
        }

        // collision with canyon walls
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

      // sky / background gradient
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#1a1228");
      sky.addColorStop(0.5, "#3a1f2e");
      sky.addColorStop(1, "#0b0a16");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // distant sun haze
      const sun = ctx.createRadialGradient(W * 0.75, H * 0.35, 0, W * 0.75, H * 0.35, 220);
      sun.addColorStop(0, "rgba(255,180,90,0.35)");
      sun.addColorStop(1, "rgba(255,180,90,0)");
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, W, H);

      // canyon rock walls — jagged silhouette + texture
      const segs = segments.current;
      const drawRockBand = (isTop: boolean) => {
        // silhouette path
        ctx.beginPath();
        if (isTop) {
          ctx.moveTo(-SEG_W, -10);
          for (let i = 0; i < segs.length; i++) {
            const x = i * SEG_W - offset.current;
            // deterministic jitter so edge doesn't shimmer
            const seedIdx = Math.floor(distance.current / SEG_W) + i;
            const j = ((Math.sin(seedIdx * 12.9898) * 43758.5453) % 1) * 14;
            ctx.lineTo(x + SEG_W / 2, segs[i].topH + j - 4);
          }
          ctx.lineTo(W + SEG_W, -10);
        } else {
          ctx.moveTo(-SEG_W, H + 10);
          for (let i = 0; i < segs.length; i++) {
            const x = i * SEG_W - offset.current;
            const seedIdx = Math.floor(distance.current / SEG_W) + i + 999;
            const j = ((Math.sin(seedIdx * 12.9898) * 43758.5453) % 1) * 14;
            ctx.lineTo(x + SEG_W / 2, H - segs[i].botH - j + 4);
          }
          ctx.lineTo(W + SEG_W, H + 10);
        }
        ctx.closePath();

        // base fill — warm canyon rock gradient
        const grd = isTop
          ? ctx.createLinearGradient(0, 0, 0, H / 2)
          : ctx.createLinearGradient(0, H / 2, 0, H);
        if (isTop) {
          grd.addColorStop(0, "#3a1810");
          grd.addColorStop(0.6, "#6b2e1a");
          grd.addColorStop(1, "#9a4a28");
        } else {
          grd.addColorStop(0, "#9a4a28");
          grd.addColorStop(0.4, "#6b2e1a");
          grd.addColorStop(1, "#2a1208");
        }
        ctx.fillStyle = grd;
        ctx.fill();

        // edge highlight (rim light along the gap)
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = "rgba(255,170,90,0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < segs.length; i++) {
          const x = i * SEG_W - offset.current;
          const seedIdx = Math.floor(distance.current / SEG_W) + i + (isTop ? 0 : 999);
          const j = ((Math.sin(seedIdx * 12.9898) * 43758.5453) % 1) * 14;
          const y = isTop ? segs[i].topH + j - 4 : H - segs[i].botH - j + 4;
          if (i === 0) ctx.moveTo(x + SEG_W / 2, y);
          else ctx.lineTo(x + SEG_W / 2, y);
        }
        ctx.stroke();

        // rock striations / cracks
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 1;
        for (let i = 0; i < segs.length; i += 2) {
          const x = i * SEG_W - offset.current;
          const seedIdx = Math.floor(distance.current / SEG_W) + i + (isTop ? 333 : 777);
          const r1 = (((Math.sin(seedIdx * 7.13) * 43758.5453) % 1) + 1) % 1;
          const r2 = (((Math.sin(seedIdx * 3.71) * 43758.5453) % 1) + 1) % 1;
          ctx.beginPath();
          if (isTop) {
            const y1 = segs[i].topH - 4 - r1 * 40;
            const y2 = segs[i].topH - 18 - r2 * 60;
            ctx.moveTo(x, y1);
            ctx.lineTo(x + SEG_W * 1.5, y2);
          } else {
            const y1 = H - segs[i].botH + 4 + r1 * 40;
            const y2 = H - segs[i].botH + 18 + r2 * 60;
            ctx.moveTo(x, y1);
            ctx.lineTo(x + SEG_W * 1.5, y2);
          }
          ctx.stroke();
        }

        // speckle highlights
        ctx.fillStyle = "rgba(255,200,140,0.18)";
        for (let i = 0; i < segs.length; i++) {
          const x = i * SEG_W - offset.current;
          const seedIdx = Math.floor(distance.current / SEG_W) + i + (isTop ? 111 : 555);
          const r = (((Math.sin(seedIdx * 5.17) * 43758.5453) % 1) + 1) % 1;
          if (r > 0.7) {
            const y = isTop ? segs[i].topH - 6 - r * 30 : H - segs[i].botH + 6 + r * 30;
            ctx.fillRect(x + 4, y, 3, 2);
          }
        }
        ctx.restore();
      };

      drawRockBand(true);
      drawRockBand(false);

      // falling rocks
      for (const rk of rocks.current) {
        ctx.save();
        ctx.translate(rk.x, rk.y);
        ctx.rotate(rk.rot);
        // shadow
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.beginPath();
        ctx.ellipse(2, 3, rk.r, rk.r * 0.95, 0, 0, Math.PI * 2);
        ctx.fill();
        // body gradient
        const rg = ctx.createRadialGradient(-rk.r * 0.4, -rk.r * 0.4, 1, 0, 0, rk.r);
        rg.addColorStop(0, "#8a7060");
        rg.addColorStop(0.6, "#5a4030");
        rg.addColorStop(1, "#2a1a12");
        ctx.fillStyle = rg;
        ctx.beginPath();
        // irregular polygon
        const sides = 7;
        for (let s = 0; s < sides; s++) {
          const a = (s / sides) * Math.PI * 2;
          const rad = rk.r * (0.78 + ((Math.sin(s * 9.13 + rk.r) + 1) / 2) * 0.35);
          const px = Math.cos(a) * rad;
          const py = Math.sin(a) * rad;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        // crack
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-rk.r * 0.5, -rk.r * 0.2);
        ctx.lineTo(rk.r * 0.2, rk.r * 0.1);
        ctx.lineTo(rk.r * 0.5, -rk.r * 0.3);
        ctx.stroke();
        // highlight speck
        ctx.fillStyle = "rgba(255,220,180,0.4)";
        ctx.beginPath();
        ctx.arc(-rk.r * 0.35, -rk.r * 0.4, rk.r * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ============ Realistic fighter jet (top-down) ============
      ctx.save();
      ctx.translate(PLANE_X, planeY.current);
      // slight bank based on input
      const bank = (keys.current.down ? 1 : 0) - (keys.current.up ? 1 : 0);
      ctx.scale(1, 1 + bank * 0.04);

      // afterburner — twin flames
      const flameLen = 12 + Math.random() * 8;
      for (const off of [-4, 4]) {
        const fg = ctx.createLinearGradient(-20 - flameLen, off, -18, off);
        fg.addColorStop(0, "rgba(255,60,0,0)");
        fg.addColorStop(0.4, "rgba(255,120,30,0.85)");
        fg.addColorStop(0.8, "rgba(255,220,120,1)");
        fg.addColorStop(1, "rgba(255,255,230,1)");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(-20, off - 2.2);
        ctx.lineTo(-20 - flameLen, off);
        ctx.lineTo(-20, off + 2.2);
        ctx.closePath();
        ctx.fill();
      }

      // shadow under jet
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(2, 18, 22, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // horizontal stabilizers (rear small wings)
      ctx.fillStyle = "#3d4651";
      ctx.beginPath();
      ctx.moveTo(-12, -3);
      ctx.lineTo(-24, -11);
      ctx.lineTo(-22, -11);
      ctx.lineTo(-10, -3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-12, 3);
      ctx.lineTo(-24, 11);
      ctx.lineTo(-22, 11);
      ctx.lineTo(-10, 3);
      ctx.closePath();
      ctx.fill();

      // main swept wings with gradient
      const wingGrad = ctx.createLinearGradient(0, -20, 0, 20);
      wingGrad.addColorStop(0, "#9ba6b3");
      wingGrad.addColorStop(0.5, "#6b7480");
      wingGrad.addColorStop(1, "#9ba6b3");
      ctx.fillStyle = wingGrad;
      ctx.beginPath();
      ctx.moveTo(6, -4);
      ctx.lineTo(-4, -22);
      ctx.lineTo(-14, -22);
      ctx.lineTo(-14, -16);
      ctx.lineTo(-6, -4);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(6, 4);
      ctx.lineTo(-4, 22);
      ctx.lineTo(-14, 22);
      ctx.lineTo(-14, 16);
      ctx.lineTo(-6, 4);
      ctx.closePath();
      ctx.fill();

      // wing panel lines
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(-8, -20);
      ctx.moveTo(0, 6);
      ctx.lineTo(-8, 20);
      ctx.stroke();

      // missiles under wings
      ctx.fillStyle = "#2c333c";
      for (const wy of [-15, 13]) {
        ctx.beginPath();
        ctx.moveTo(8, wy);
        ctx.lineTo(-10, wy);
        ctx.lineTo(-12, wy + 1);
        ctx.lineTo(-10, wy + 2);
        ctx.lineTo(8, wy + 2);
        ctx.closePath();
        ctx.fill();
        // missile tip
        ctx.fillStyle = "#e34a3a";
        ctx.beginPath();
        ctx.moveTo(8, wy);
        ctx.lineTo(11, wy + 1);
        ctx.lineTo(8, wy + 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#2c333c";
      }

      // fuselage — sleek metallic
      const fuseGrad = ctx.createLinearGradient(0, -6, 0, 6);
      fuseGrad.addColorStop(0, "#d9dfe6");
      fuseGrad.addColorStop(0.5, "#aab3bd");
      fuseGrad.addColorStop(1, "#7c858f");
      ctx.fillStyle = fuseGrad;
      ctx.beginPath();
      ctx.moveTo(26, 0);
      ctx.lineTo(20, -3);
      ctx.lineTo(6, -6);
      ctx.lineTo(-18, -5);
      ctx.lineTo(-20, -3);
      ctx.lineTo(-20, 3);
      ctx.lineTo(-18, 5);
      ctx.lineTo(6, 6);
      ctx.lineTo(20, 3);
      ctx.closePath();
      ctx.fill();

      // intake (side)
      ctx.fillStyle = "#1a1f25";
      ctx.beginPath();
      ctx.ellipse(-4, -5, 5, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-4, 5, 5, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // vertical tail fin (cast as a triangle behind cockpit)
      ctx.fillStyle = "#5a6470";
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(-18, -1);
      ctx.lineTo(-14, 1);
      ctx.closePath();
      ctx.fill();

      // nose cone
      ctx.fillStyle = "#6b7480";
      ctx.beginPath();
      ctx.moveTo(26, 0);
      ctx.lineTo(18, -2);
      ctx.lineTo(18, 2);
      ctx.closePath();
      ctx.fill();

      // cockpit canopy — glass with reflection
      const canopyGrad = ctx.createLinearGradient(2, -3, 12, 3);
      canopyGrad.addColorStop(0, "#1c3a66");
      canopyGrad.addColorStop(0.6, "#5b8fc9");
      canopyGrad.addColorStop(1, "#0f1f3a");
      ctx.fillStyle = canopyGrad;
      ctx.beginPath();
      ctx.ellipse(8, 0, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.beginPath();
      ctx.ellipse(9, -1.2, 2.5, 0.8, -0.2, 0, Math.PI * 2);
      ctx.fill();

      // roundel marking
      ctx.fillStyle = "#c8d0d8";
      ctx.beginPath();
      ctx.arc(-2, 0, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#c8344a";
      ctx.beginPath();
      ctx.arc(-2, 0, 0.8, 0, Math.PI * 2);
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

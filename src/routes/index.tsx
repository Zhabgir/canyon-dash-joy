import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import gameIcon from "../assets/game-icon.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Space Rush" },
      {
        name: "description",
        content:
          "Space Rush — пилотируй звездолёт через астероидный коридор, уворачивайся от ракет и собирай космические бонусы.",
      },
    ],
  }),
  component: Game,
});

type GameState = "menu" | "playing" | "revive" | "over" | "choice";

const REVIVE_COST = 100;
const REVIVE_SECONDS = 10;

// ===== Shop catalogs =====
interface Skin {
  id: string;
  name: string;
  price: number;
  fuse: [string, string, string];
  wing: [string, string, string];
  accent: string;
}
interface MapTheme {
  id: string;
  name: string;
  price: number;
  sky: [string, string, string, string];
  sun: string;
  sunAlpha: string;
}

const SKINS: Skin[] = [
  { id: "classic", name: "Classic", price: 0, fuse: ["#e0e6ec", "#a8b1bb", "#6e7780"], wing: ["#aab4c0", "#5e6772", "#aab4c0"], accent: "#c8344a" },
  { id: "crimson", name: "Crimson", price: 200, fuse: ["#ffd0d0", "#d63a3a", "#5a1010"], wing: ["#ff8c8c", "#a02020", "#ff8c8c"], accent: "#ffe040" },
  { id: "stealth", name: "Stealth", price: 350, fuse: ["#3a3f48", "#15181c", "#000000"], wing: ["#2c3138", "#0e1014", "#2c3138"], accent: "#9b59ff" },
  { id: "gold", name: "Gold", price: 500, fuse: ["#fff1a8", "#d4a526", "#6a5010"], wing: ["#ffd860", "#a07a18", "#ffd860"], accent: "#ffffff" },
  { id: "neon", name: "Neon", price: 800, fuse: ["#a8fff0", "#22c2c8", "#0a3a4a"], wing: ["#7af0ff", "#1a8a9a", "#7af0ff"], accent: "#ff40d0" },
];

const MAPS: MapTheme[] = [
  { id: "twilight", name: "Twilight Desert", price: 0, sky: ["#0a0814", "#1d1230", "#5a2438", "#1a0a10"], sun: "#ffcf85", sunAlpha: "255,180,90" },
  { id: "arctic", name: "Arctic", price: 300, sky: ["#0a1a2a", "#1a3a55", "#3a6a8a", "#0e1a26"], sun: "#e8f5ff", sunAlpha: "180,220,255" },
  { id: "sunset", name: "Sunset", price: 250, sky: ["#1a0a0a", "#4a1418", "#c25028", "#ff8a3a"], sun: "#fff0a0", sunAlpha: "255,200,120" },
  { id: "neoncity", name: "Neon City", price: 600, sky: ["#0a0220", "#2a0a48", "#600a78", "#10001a"], sun: "#ff60c0", sunAlpha: "255,90,200" },
  { id: "space", name: "Deep Space", price: 900, sky: ["#000004", "#06061a", "#101030", "#000000"], sun: "#ffffff", sunAlpha: "200,200,255" },
];

const LS = {
  wallet: "jr_wallet",
  ownedSkins: "jr_owned_skins",
  ownedMaps: "jr_owned_maps",
  skin: "jr_skin",
  map: "jr_map",
  quests: "jr_quests_v1",
};

// ===== Daily quests =====
type QuestMetric = "runCoins" | "runScore" | "games" | "totalCoins";
interface QuestDef {
  id: string;
  metric: QuestMetric;
  target: number;
  reward: number;
  difficulty: "easy" | "hard";
  title: string;
}
interface QuestState {
  date: string;
  quests: { def: QuestDef; progress: number; claimed: boolean }[];
}

const EASY_QUESTS: QuestDef[] = [
  { id: "e_coins10", metric: "runCoins", target: 10, reward: 35, difficulty: "easy", title: "Собери 10 монет за один забег" },
  { id: "e_score400", metric: "runScore", target: 400, reward: 40, difficulty: "easy", title: "Набери 400 очков за один забег" },
  { id: "e_games3", metric: "games", target: 3, reward: 30, difficulty: "easy", title: "Сыграй 3 раунда" },
  { id: "e_total25", metric: "totalCoins", target: 25, reward: 35, difficulty: "easy", title: "Собери всего 25 монет" },
  { id: "e_score700", metric: "runScore", target: 700, reward: 50, difficulty: "easy", title: "Набери 700 очков за один забег" },
];
const HARD_QUESTS: QuestDef[] = [
  { id: "h_coins40", metric: "runCoins", target: 40, reward: 125, difficulty: "hard", title: "Собери 40 монет за один забег" },
  { id: "h_score2000", metric: "runScore", target: 2000, reward: 125, difficulty: "hard", title: "Набери 2000 очков за один забег" },
  { id: "h_games10", metric: "games", target: 10, reward: 125, difficulty: "hard", title: "Сыграй 10 раундов" },
  { id: "h_total150", metric: "totalCoins", target: 150, reward: 125, difficulty: "hard", title: "Собери всего 150 монет" },
];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function pickDailyQuests(date: string): QuestState["quests"] {
  let seed = seedFrom(date);
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const pick = <T,>(arr: T[], n: number): T[] => {
    const copy = [...arr];
    const out: T[] = [];
    for (let i = 0; i < n && copy.length; i++) {
      const idx = Math.floor(rng() * copy.length);
      out.push(copy.splice(idx, 1)[0]);
    }
    return out;
  };
  const hard = pick(HARD_QUESTS, 1);
  const easy = pick(EASY_QUESTS, 2);
  return [...hard, ...easy].map((def) => ({ def, progress: 0, claimed: false }));
}
function loadQuests(): QuestState {
  const today = todayStr();
  const saved = loadJSON<QuestState | null>(LS.quests, null);
  if (saved && saved.date === today && saved.quests?.length) return saved;
  return { date: today, quests: pickDailyQuests(today) };
}

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key: string, val: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore */
  }
}

type PowerKind = "shield" | "slowmo" | "boost";

const W = 800;
const H = 500;
const PLANE_X = 140;
const PLANE_SIZE = 22;
const BASE_SPEED = 2.5;
const MAX_SPEED = 5.55;
const PLAYER_SPEED = 4.0;
const SEG_W = 20;

interface Segment {
  topH: number;
  botH: number;
}
interface Missile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: { x: number; y: number }[];
}
interface PowerUp {
  x: number;
  y: number;
  kind: PowerKind;
  t: number; // animation time
  alive: boolean;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}
interface Star {
  x: number;
  y: number;
  z: number; // parallax depth 0.2..1
  s: number;
}
interface Coin {
  x: number;
  y: number;
  t: number;
}

function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<GameState>("menu");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [hud, setHud] = useState({ shield: false, slowmo: 0, boost: 0 });
  const [coins, setCoins] = useState(0);
  const [bestCoins, setBestCoins] = useState(0);
  const [reviveLeft, setReviveLeft] = useState(REVIVE_SECONDS);
  const usedRevive = useRef(false);
  const [wallet, setWallet] = useState(0);
  const walletRef = useRef(0);
  walletRef.current = wallet;
  const [ownedSkins, setOwnedSkins] = useState<string[]>(["classic"]);
  const [ownedMaps, setOwnedMaps] = useState<string[]>(["twilight"]);
  const [skinId, setSkinId] = useState<string>("classic");
  const [mapId, setMapId] = useState<string>("twilight");
  const [shopTab, setShopTab] = useState<null | "skins" | "maps">(null);
  const [questsOpen, setQuestsOpen] = useState(false);
  const [questState, setQuestState] = useState<QuestState>({ date: todayStr(), quests: [] });
  const totalCoinsRef = useRef(0);
  const skinRef = useRef<Skin>(SKINS[0]);
  const mapRef = useRef<MapTheme>(MAPS[0]);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  const stateRef = useRef(state);
  stateRef.current = state;

  // Hydrate persistent shop data from localStorage on mount
  useEffect(() => {
    setWallet(loadJSON<number>(LS.wallet, 0));
    setOwnedSkins(loadJSON<string[]>(LS.ownedSkins, ["classic"]));
    setOwnedMaps(loadJSON<string[]>(LS.ownedMaps, ["twilight"]));
    setSkinId(loadJSON<string>(LS.skin, "classic"));
    setMapId(loadJSON<string>(LS.map, "twilight"));
    setQuestState(loadQuests());
  }, []);

  // Keep render refs in sync with current selection
  useEffect(() => {
    skinRef.current = SKINS.find((s) => s.id === skinId) ?? SKINS[0];
    saveJSON(LS.skin, skinId);
  }, [skinId]);
  useEffect(() => {
    mapRef.current = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
    saveJSON(LS.map, mapId);
  }, [mapId]);


  const keys = useRef({ up: false, down: false });
  const planeY = useRef(H / 2);
  const planeVy = useRef(0);
  const segments = useRef<Segment[]>([]);
  const offset = useRef(0);
  const distance = useRef(0);
  const missiles = useRef<Missile[]>([]);
  const missileTimer = useRef(0);
  const powers = useRef<PowerUp[]>([]);
  const powerTimer = useRef(180);
  const coinsRef = useRef<Coin[]>([]);
  const coinTimer = useRef(80);
  const coinCount = useRef(0);
  const particles = useRef<Particle[]>([]);
  const stars = useRef<Star[]>([]);
  const shield = useRef(false);
  const slowmo = useRef(0); // frames remaining
  const boost = useRef(0); // frames remaining
  const shake = useRef(0);
  const flash = useRef(0);
  const tick = useRef(0);
  const speedLines = useRef<{ x: number; y: number; len: number; spd: number }[]>([]);

  // ===== Sound engine (WebAudio) =====
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const engineRef = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);

  const ensureAudio = useCallback(() => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const Ctx =
      (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return null;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    audioCtxRef.current = ctx;
    masterGainRef.current = master;
    return ctx;
  }, []);

  const playBeep = useCallback(
    (freq: number, dur: number, type: OscillatorType = "sine", vol = 0.4, slide = 0) => {
      if (mutedRef.current) return;
      const ctx = ensureAudio();
      if (!ctx || !masterGainRef.current) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ctx.currentTime + dur);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(g);
      g.connect(masterGainRef.current);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.02);
    },
    [ensureAudio],
  );

  const playNoise = useCallback(
    (dur: number, vol = 0.6) => {
      if (mutedRef.current) return;
      const ctx = ensureAudio();
      if (!ctx || !masterGainRef.current) return;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = vol;
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 900;
      src.connect(filt);
      filt.connect(g);
      g.connect(masterGainRef.current);
      src.start();
    },
    [ensureAudio],
  );

  const sfxCoin = useCallback(() => playBeep(1320, 0.09, "square", 0.18, 400), [playBeep]);
  const sfxPower = useCallback(() => {
    playBeep(660, 0.12, "triangle", 0.3, 400);
    setTimeout(() => playBeep(990, 0.16, "triangle", 0.25, 300), 70);
  }, [playBeep]);
  const sfxHit = useCallback(() => {
    playNoise(0.5, 0.7);
    playBeep(120, 0.45, "sawtooth", 0.4, -80);
  }, [playNoise, playBeep]);
  const sfxShieldHit = useCallback(() => playBeep(520, 0.15, "square", 0.25, -200), [playBeep]);

  const startEngine = useCallback(() => {
    if (mutedRef.current) return;
    const ctx = ensureAudio();
    if (!ctx || !masterGainRef.current || engineRef.current) return;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 80;
    const g = ctx.createGain();
    g.gain.value = 0;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 600;
    osc.connect(filt);
    filt.connect(g);
    g.connect(masterGainRef.current);
    osc.start();
    g.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.3);
    engineRef.current = { osc, gain: g };
  }, [ensureAudio]);

  const stopEngine = useCallback(() => {
    const ctx = audioCtxRef.current;
    const e = engineRef.current;
    if (!ctx || !e) return;
    e.gain.gain.cancelScheduledValues(ctx.currentTime);
    e.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
    e.osc.stop(ctx.currentTime + 0.2);
    engineRef.current = null;
  }, []);


  const resetWorld = useCallback(() => {
    planeY.current = H / 2;
    planeVy.current = 0;
    offset.current = 0;
    distance.current = 0;
    segments.current = [];
    missiles.current = [];
    missileTimer.current = 240;
    powers.current = [];
    powerTimer.current = 200;
    coinsRef.current = [];
    coinTimer.current = 90;
    coinCount.current = 0;
    particles.current = [];
    shield.current = false;
    slowmo.current = 0;
    boost.current = 0;
    shake.current = 0;
    flash.current = 0;
    usedRevive.current = false;
    const count = Math.ceil(W / SEG_W) + 2;
    const gap = 280;
    const center = H / 2;
    for (let i = 0; i < count; i++) {
      segments.current.push({ topH: center - gap / 2, botH: H - (center + gap / 2) });
    }
    stars.current = Array.from({ length: 90 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H * 0.55,
      z: 0.2 + Math.random() * 0.8,
      s: Math.random() * 1.5 + 0.3,
    }));
    setScore(0);
    setCoins(0);
    setHud({ shield: false, slowmo: 0, boost: 0 });
  }, []);

  const start = useCallback(() => {
    resetWorld();
    ensureAudio();
    if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
    startEngine();
    setState("playing");
  }, [resetWorld, ensureAudio, startEngine]);

  useEffect(() => {
    return () => {
      stopEngine();
      audioCtxRef.current?.close();
    };
  }, [stopEngine]);

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

  // Revive countdown — auto-finalize when time runs out
  useEffect(() => {
    if (state !== "revive") return;
    setReviveLeft(REVIVE_SECONDS);
    const started = Date.now();
    const id = window.setInterval(() => {
      const left = REVIVE_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        window.clearInterval(id);
        setReviveLeft(0);
        finalizeOver();
      } else {
        setReviveLeft(left);
      }
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const finalizeOver = useCallback((nextState: GameState = "over") => {
    const d = Math.floor(distance.current / 10);
    setScore(d);
    setBest((b) => Math.max(b, d));
    setBestCoins((b) => Math.max(b, coinCount.current));
    const runCoins = coinCount.current;
    totalCoinsRef.current += runCoins;
    setQuestState((qs) => {
      const today = todayStr();
      if (qs.date !== today) {
        const fresh = { date: today, quests: pickDailyQuests(today) };
        saveJSON(LS.quests, fresh);
        return fresh;
      }
      const next = {
        ...qs,
        quests: qs.quests.map((q) => {
          if (q.claimed) return q;
          let inc = 0;
          if (q.def.metric === "runCoins") inc = Math.max(q.progress, runCoins);
          else if (q.def.metric === "runScore") inc = Math.max(q.progress, d);
          else if (q.def.metric === "games") inc = q.progress + 1;
          else if (q.def.metric === "totalCoins") inc = q.progress + runCoins;
          return { ...q, progress: Math.min(q.def.target, inc) };
        }),
      };
      saveJSON(LS.quests, next);
      return next;
    });
    setState(nextState);
  }, []);

  const claimQuest = useCallback((id: string) => {
    setQuestState((qs) => {
      const q = qs.quests.find((x) => x.def.id === id);
      if (!q || q.claimed || q.progress < q.def.target) return qs;
      const next = {
        ...qs,
        quests: qs.quests.map((x) => (x.def.id === id ? { ...x, claimed: true } : x)),
      };
      saveJSON(LS.quests, next);
      setWallet((w) => {
        const nw = w + q.def.reward;
        saveJSON(LS.wallet, nw);
        return nw;
      });
      return next;
    });
  }, []);


  const buySkin = useCallback(
    (s: Skin) => {
      if (ownedSkins.includes(s.id)) {
        setSkinId(s.id);
        return;
      }
      if (wallet < s.price) return;
      const nextWallet = wallet - s.price;
      const nextOwned = [...ownedSkins, s.id];
      setWallet(nextWallet);
      setOwnedSkins(nextOwned);
      setSkinId(s.id);
      saveJSON(LS.wallet, nextWallet);
      saveJSON(LS.ownedSkins, nextOwned);
    },
    [ownedSkins, wallet],
  );

  const buyMap = useCallback(
    (m: MapTheme) => {
      if (ownedMaps.includes(m.id)) {
        setMapId(m.id);
        return;
      }
      if (wallet < m.price) return;
      const nextWallet = wallet - m.price;
      const nextOwned = [...ownedMaps, m.id];
      setWallet(nextWallet);
      setOwnedMaps(nextOwned);
      setMapId(m.id);
      saveJSON(LS.wallet, nextWallet);
      saveJSON(LS.ownedMaps, nextOwned);
    },
    [ownedMaps, wallet],
  );


  const die = useCallback(() => {
    // explosion particles — big arcade explosion
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 7;
      particles.current.push({
        x: PLANE_X,
        y: planeY.current,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 40 + Math.random() * 50,
        maxLife: 90,
        color: ["#fff2c0", "#ffd070", "#ff8030", "#ff4020", "#882020", "#555"][Math.floor(Math.random() * 6)],
        size: 2 + Math.random() * 4,
      });
    }
    // shockwave ring
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      particles.current.push({
        x: PLANE_X,
        y: planeY.current,
        vx: Math.cos(a) * 6,
        vy: Math.sin(a) * 6,
        life: 25,
        maxLife: 25,
        color: "#fff8d0",
        size: 3,
      });
    }
    shake.current = 24;
    flash.current = 18;
    sfxHit();
    stopEngine();
    if (!usedRevive.current) {
      setReviveLeft(REVIVE_SECONDS);
      setState("revive");
    } else {
      finalizeOver();
    }
  }, [sfxHit, stopEngine, finalizeOver]);

  const revive = useCallback(() => {
    if (walletRef.current < REVIVE_COST) return;
    const next = walletRef.current - REVIVE_COST;
    setWallet(next);
    saveJSON(LS.wallet, next);
    usedRevive.current = true;
    // clear nearby threats
    missiles.current = [];
    missileTimer.current = 180;
    particles.current = [];
    // re-center plane & grant temporary shield
    planeY.current = H / 2;
    planeVy.current = 0;
    shield.current = true;
    shake.current = 0;
    flash.current = 8;
    ensureAudio();
    if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
    startEngine();
    setHud((h) => ({ ...h, shield: true }));
    setState("playing");
  }, [ensureAudio, startEngine]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const loop = () => {
      tick.current++;
      const playing = stateRef.current === "playing";

      if (playing) {
        // smooth vertical control
        const target = (keys.current.down ? 1 : 0) - (keys.current.up ? 1 : 0);
        planeVy.current += target * 0.9;
        planeVy.current *= 0.82;
        planeY.current += Math.max(-PLAYER_SPEED, Math.min(PLAYER_SPEED, planeVy.current));

        // time scale: slowmo halves, boost speeds up
        const timeScale =
          (slowmo.current > 0 ? 0.5 : 1) * (boost.current > 0 ? 1.55 : 1);
        const baseSpeed = Math.min(MAX_SPEED, BASE_SPEED + distance.current / 6000);
        const speed = baseSpeed * timeScale;

        offset.current += speed;
        distance.current += speed * (boost.current > 0 ? 1.4 : 1); // boost gives bonus score
        while (offset.current >= SEG_W) {
          offset.current -= SEG_W;
          segments.current.shift();
          const last = segments.current[segments.current.length - 1];
          const prevTop = last.topH;
          const prevBot = last.botH;
          const prevGap = H - prevTop - prevBot;
          const prevCenter = prevTop + prevGap / 2;
          const difficulty = Math.min(1, distance.current / 4500);
          const segIndex = Math.floor(distance.current / SEG_W);

          const isPipe = segIndex > 0 && segIndex % 40 === 0;
          let newGap: number;
          let newCenter: number;
          if (isPipe) {
            const minPipeGap = 210 - 20 * difficulty;
            newGap = minPipeGap + Math.random() * 55;
            const targetCenter = 70 + newGap / 2 + Math.random() * (H - 140 - newGap);
            const maxStep = 34 + 8 * difficulty;
            newCenter = clamp(
              clamp(targetCenter, prevCenter - maxStep, prevCenter + maxStep),
              newGap / 2 + 28,
              H - newGap / 2 - 28,
            );
          } else {
            const minGap = 295 - 55 * difficulty;
            newGap = Math.max(minGap, prevGap + (Math.random() - 0.5) * 28);
            const drift = 22 + 26 * difficulty;
            newCenter = clamp(
              prevCenter + (Math.random() - 0.5) * drift,
              newGap / 2 + 28,
              H - newGap / 2 - 28,
            );
          }
          segments.current.push({
            topH: newCenter - newGap / 2,
            botH: H - (newCenter + newGap / 2),
          });
        }

        // ===== Missile spawn =====
        missileTimer.current -= 1 * timeScale;
        if (missileTimer.current <= 0 && boost.current <= 0) {
          const rightIdx = segments.current.length - 2;
          const segR = segments.current[rightIdx];
          const topY = segR ? segR.topH + 12 : 30;
          const botY = segR ? H - segR.botH - 12 : H - 30;
          const spawnY = topY + Math.random() * Math.max(20, botY - topY);
          const spawnX = W + 20;
          const targetY = planeY.current + (Math.random() - 0.5) * 70;
          const sp = (5 + difficultyFor() * 3.5 + Math.random() * 1.5) * 0.7;
          const dx = -W;
          const dy = targetY - spawnY;
          const dist = Math.hypot(dx, dy);
          missiles.current.push({
            x: spawnX,
            y: spawnY,
            vx: (dx / dist) * sp,
            vy: (dy / dist) * sp,
            trail: [],
          });
          missileTimer.current = Math.max(56, 210 - difficultyFor() * 120 - Math.random() * 50);
        }

        // ===== Missile update + collision =====
        for (let i = missiles.current.length - 1; i >= 0; i--) {
          const m = missiles.current[i];
          m.trail.push({ x: m.x, y: m.y });
          if (m.trail.length > 12) m.trail.shift();
          m.x += m.vx * timeScale;
          m.y += m.vy * timeScale;
          if (m.x < -40 || m.x > W + 80 || m.y < -40 || m.y > H + 40) {
            missiles.current.splice(i, 1);
            continue;
          }
          const hitR = 5;
          if (
            m.x > PLANE_X - PLANE_SIZE / 2 - hitR &&
            m.x < PLANE_X + PLANE_SIZE / 2 + hitR &&
            m.y > planeY.current - PLANE_SIZE / 2 - hitR &&
            m.y < planeY.current + PLANE_SIZE / 2 + hitR
          ) {
            missiles.current.splice(i, 1);
            if (shield.current) {
              shield.current = false;
              sfxShieldHit();
              shake.current = 8;
              flash.current = 6;
              for (let k = 0; k < 18; k++) {
                const a = Math.random() * Math.PI * 2;
                particles.current.push({
                  x: PLANE_X,
                  y: planeY.current,
                  vx: Math.cos(a) * 3,
                  vy: Math.sin(a) * 3,
                  life: 30,
                  maxLife: 30,
                  color: "#6bd4ff",
                  size: 2,
                });
              }
            } else {
              die();
            }
          }
        }

        // ===== Powerup spawn =====
        powerTimer.current -= 1 * timeScale;
        if (powerTimer.current <= 0) {
          const rightIdx = segments.current.length - 3;
          const segR = segments.current[rightIdx];
          const topY = (segR ? segR.topH : 30) + 28;
          const botY = (segR ? H - segR.botH : H - 30) - 28;
          const y = topY + Math.random() * Math.max(20, botY - topY);
          const r = Math.random();
          const kind: PowerKind = r < 0.4 ? "shield" : r < 0.75 ? "slowmo" : "boost";
          powers.current.push({ x: W + 20, y, kind, t: 0, alive: true });
          powerTimer.current = 320 + Math.random() * 280;
        }
        for (let i = powers.current.length - 1; i >= 0; i--) {
          const p = powers.current[i];
          p.x -= speed;
          p.t += 1;
          if (p.x < -30) {
            powers.current.splice(i, 1);
            continue;
          }
          const dx = p.x - PLANE_X;
          const dy = p.y - planeY.current;
          if (dx * dx + dy * dy < 22 * 22) {
            powers.current.splice(i, 1);
            // pickup effect
            for (let k = 0; k < 16; k++) {
              const a = Math.random() * Math.PI * 2;
              particles.current.push({
                x: PLANE_X,
                y: planeY.current,
                vx: Math.cos(a) * 2.5,
                vy: Math.sin(a) * 2.5,
                life: 28,
                maxLife: 28,
                color:
                  p.kind === "shield"
                    ? "#6bd4ff"
                    : p.kind === "slowmo"
                      ? "#b48bff"
                      : "#ffce4a",
                size: 2,
              });
            }
            if (p.kind === "shield") shield.current = true;
            if (p.kind === "slowmo") slowmo.current = 360;
            if (p.kind === "boost") boost.current = 300;
            flash.current = 6;
            sfxPower();
          }
        }

        // ===== Coin spawn (scattered) =====
        coinTimer.current -= 1 * timeScale;
        if (coinTimer.current <= 0) {
          const rightIdx = segments.current.length - 3;
          const segR = segments.current[rightIdx];
          const topY = (segR ? segR.topH : 30) + 26;
          const botY = (segR ? H - segR.botH : H - 30) - 26;
          const count = 1 + Math.floor(Math.random() * 5); // 1..5 coins
          const spacing = 32;
          for (let i = 0; i < count; i++) {
            const y = topY + Math.random() * Math.max(20, botY - topY);
            coinsRef.current.push({ x: W + 20 + i * spacing, y, t: Math.random() * 10 });
          }
          coinTimer.current = 70 + Math.random() * 80;
        }
        for (let i = coinsRef.current.length - 1; i >= 0; i--) {
          const c = coinsRef.current[i];
          c.x -= speed;
          c.t += 1;
          if (c.x < -20) {
            coinsRef.current.splice(i, 1);
            continue;
          }
          const dx = c.x - PLANE_X;
          const dy = c.y - planeY.current;
          if (dx * dx + dy * dy < 18 * 18) {
            coinsRef.current.splice(i, 1);
            coinCount.current += 1;
            setCoins(coinCount.current);
            setWallet((w) => {
              const next = w + 1;
              saveJSON(LS.wallet, next);
              return next;
            });
            sfxCoin();
            for (let k = 0; k < 8; k++) {
              const a = Math.random() * Math.PI * 2;
              particles.current.push({
                x: c.x,
                y: c.y,
                vx: Math.cos(a) * 1.8,
                vy: Math.sin(a) * 1.8,
                life: 18,
                maxLife: 18,
                color: "#ffd84a",
                size: 1.6,
              });
            }
          }
        }

        if (slowmo.current > 0) slowmo.current--;
        if (boost.current > 0) boost.current--;

        // engine particles (trail behind jet)
        if (tick.current % 2 === 0) {
          particles.current.push({
            x: PLANE_X - 22,
            y: planeY.current + (Math.random() - 0.5) * 3,
            vx: -2 - Math.random() * 1.5,
            vy: (Math.random() - 0.5) * 0.4,
            life: 22,
            maxLife: 22,
            color: boost.current > 0 ? "#7bd0ff" : "#ffd070",
            size: 2 + Math.random() * 1.5,
          });
        }

        // canyon collision
        const idx = Math.floor((PLANE_X + offset.current) / SEG_W);
        const seg = segments.current[idx];
        if (seg) {
          const planeTop = planeY.current - PLANE_SIZE / 2;
          const planeBot = planeY.current + PLANE_SIZE / 2;
          if (planeTop < seg.topH || planeBot > H - seg.botH) {
            if (shield.current) {
              shield.current = false;
              // bounce away from wall
              if (planeTop < seg.topH) {
                planeY.current = seg.topH + PLANE_SIZE / 2 + 2;
                planeVy.current = 3;
              } else {
                planeY.current = H - seg.botH - PLANE_SIZE / 2 - 2;
                planeVy.current = -3;
              }
              shake.current = 8;
              flash.current = 6;
            } else {
              die();
            }
          }
        }
        if (planeY.current < 0 || planeY.current > H) die();
        setScore(Math.floor(distance.current / 10));
        setHud({
          shield: shield.current,
          slowmo: slowmo.current,
          boost: boost.current,
        });
      }

      // update particles (always)
      for (let i = particles.current.length - 1; i >= 0; i--) {
        const p = particles.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.02;
        p.life--;
        if (p.life <= 0) particles.current.splice(i, 1);
      }
      // parallax stars drift left
      const driftSpeed = playing ? Math.min(MAX_SPEED, BASE_SPEED + distance.current / 6000) : 1;
      for (const s of stars.current) {
        s.x -= s.z * driftSpeed * 0.4;
        if (s.x < -2) {
          s.x = W + 2;
          s.y = Math.random() * H * 0.55;
        }
      }

      // speed lines (intensity scales with speed) — always when playing
      if (playing) {
        const intensity = (driftSpeed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED);
        const spawnEvery = boost.current > 0 ? 1 : Math.max(2, Math.round(5 - intensity * 3));
        if (tick.current % spawnEvery === 0) {
          const len = 18 + Math.random() * 28 + intensity * 30 + (boost.current > 0 ? 50 : 0);
          speedLines.current.push({
            x: W + 10,
            y: Math.random() * H,
            len,
            spd: 8 + driftSpeed * 2.2 + (boost.current > 0 ? 7 : 0),
          });
        }
        for (let i = speedLines.current.length - 1; i >= 0; i--) {
          const sl = speedLines.current[i];
          sl.x -= sl.spd;
          if (sl.x < -sl.len) speedLines.current.splice(i, 1);
        }
      } else {
        speedLines.current = [];
      }

      // engine sound modulation
      if (engineRef.current && audioCtxRef.current) {
        const targetFreq = 70 + driftSpeed * 22 + (boost.current > 0 ? 60 : 0);
        engineRef.current.osc.frequency.setTargetAtTime(targetFreq, audioCtxRef.current.currentTime, 0.08);
      }

      if (shake.current > 0) shake.current--;
      if (flash.current > 0) flash.current--;

      // ============ RENDER ============
      ctx.save();
      if (shake.current > 0) {
        ctx.translate(
          (Math.random() - 0.5) * shake.current * 0.8,
          (Math.random() - 0.5) * shake.current * 0.8,
        );
      }

      // sky gradient (from selected map)
      const theme = mapRef.current;
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, theme.sky[0]);
      sky.addColorStop(0.35, theme.sky[1]);
      sky.addColorStop(0.65, theme.sky[2]);
      sky.addColorStop(1, theme.sky[3]);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // distant sun
      const sunX = W * 0.78;
      const sunY = H * 0.42;
      const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 260);
      sunGlow.addColorStop(0, `rgba(${theme.sunAlpha},0.55)`);
      sunGlow.addColorStop(0.4, `rgba(${theme.sunAlpha},0.22)`);
      sunGlow.addColorStop(1, `rgba(${theme.sunAlpha},0)`);
      ctx.fillStyle = sunGlow;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = theme.sun;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 38, 0, Math.PI * 2);
      ctx.fill();

      // stars
      for (const s of stars.current) {
        ctx.fillStyle = `rgba(255,235,210,${0.3 + s.z * 0.7})`;
        ctx.fillRect(s.x, s.y, s.s, s.s);
      }

      // distant mountain silhouettes (background parallax)
      drawDistantMountains(ctx, offset.current * 0.15);

      // canyon walls
      drawCanyon(ctx, segments.current, offset.current, distance.current);

      // foreground mist
      const mist = ctx.createLinearGradient(0, H * 0.6, 0, H);
      mist.addColorStop(0, "rgba(60,30,40,0)");
      mist.addColorStop(1, "rgba(50,20,30,0.45)");
      ctx.fillStyle = mist;
      ctx.fillRect(0, H * 0.6, W, H * 0.4);

      // powerups
      for (const p of powers.current) drawPowerup(ctx, p);

      // coins
      for (const c of coinsRef.current) drawCoin(ctx, c);

      // missiles
      for (const m of missiles.current) drawMissile(ctx, m);

      // particles
      for (const p of particles.current) {
        const a = p.life / p.maxLife;
        ctx.fillStyle = withAlpha(p.color, a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + a * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }

      // jet
      if (stateRef.current !== "over") {
        drawJet(ctx, planeY.current, keys.current, boost.current > 0, shield.current, tick.current, skinRef.current);
      }

      // post-effects
      if (slowmo.current > 0) {
        ctx.fillStyle = "rgba(120,90,200,0.10)";
        ctx.fillRect(0, 0, W, H);
      }
      // speed lines — always rendered while playing
      if (speedLines.current.length) {
        ctx.lineCap = "round";
        for (const sl of speedLines.current) {
          const alpha = boost.current > 0 ? 0.7 : 0.32;
          const color = boost.current > 0 ? "180,230,255" : "255,225,200";
          ctx.strokeStyle = `rgba(${color},${alpha})`;
          ctx.lineWidth = boost.current > 0 ? 1.6 : 1.1;
          ctx.beginPath();
          ctx.moveTo(sl.x, sl.y);
          ctx.lineTo(sl.x + sl.len, sl.y);
          ctx.stroke();
        }
      }
      if (flash.current > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash.current / 24})`;
        ctx.fillRect(0, 0, W, H);
      }

      ctx.restore();

      raf = requestAnimationFrame(loop);
    };

    function difficultyFor() {
      return Math.min(1, distance.current / 4500);
    }

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [die, sfxCoin, sfxPower, sfxShieldHit]);

  // touch controls — tap/hold top half = up, bottom half = down
  const touchHandlers = (which: "up" | "down") => ({
    onTouchStart: (e: React.TouchEvent) => {
      e.preventDefault();
      keys.current[which] = true;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      e.preventDefault();
      keys.current[which] = false;
    },
    onMouseDown: () => {
      keys.current[which] = true;
    },
    onMouseUp: () => {
      keys.current[which] = false;
    },
    onMouseLeave: () => {
      keys.current[which] = false;
    },
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-to-b from-[#1a0a20] via-[#2a0f1a] to-[#0a0510] p-3">
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
        style={{ maxWidth: W, aspectRatio: `${W}/${H}` }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="block h-full w-full"
        />

        {/* HUD: score & best */}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-0.5 font-mono text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
          <div className="text-2xl font-extrabold tracking-tight">
            {score.toLocaleString()}
          </div>
          {best > 0 && (
            <div className="text-[10px] uppercase tracking-widest text-white/60">
              Best {best.toLocaleString()}
            </div>
          )}
        </div>

        {/* coins + active buffs */}
        <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-1.5 font-mono drop-shadow">
          <div className="flex items-center gap-1.5 rounded-full border border-yellow-300/70 bg-black/60 px-3 py-1 text-sm font-bold text-yellow-300 backdrop-blur-sm">
            <span className="text-base leading-none">●</span>
            <span>{coins}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {hud.shield && <Badge color="#6bd4ff">⛨</Badge>}
            {hud.slowmo > 0 && <Badge color="#b48bff">⧖ {Math.ceil(hud.slowmo / 60)}</Badge>}
            {hud.boost > 0 && <Badge color="#ffce4a">⚡ {Math.ceil(hud.boost / 60)}</Badge>}
          </div>
        </div>

        {/* mute toggle */}
        <button
          onClick={() => setMuted((m) => !m)}
          className="absolute bottom-3 right-3 z-20 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white/80 backdrop-blur-sm hover:bg-black/80"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? "🔇" : "🔊"}
        </button>

        {/* touch zones — only active during play */}
        {state === "playing" && (
          <>
            <div
              className="absolute inset-x-0 top-0 z-10 h-1/2"
              {...touchHandlers("up")}
            />
            <div
              className="absolute inset-x-0 bottom-0 z-10 h-1/2"
              {...touchHandlers("down")}
            />
          </>
        )}

        {state === "menu" && (
          <Overlay>
            <div className="relative flex flex-col items-center gap-3">
              <div className="relative">
                <img
                  src={gameIcon}
                  alt="Jet Rush"
                  width={96}
                  height={96}
                  className="h-20 w-20 rounded-2xl shadow-lg shadow-orange-500/30 sm:h-24 sm:w-24"
                />
                <div className="absolute -inset-2 -z-10 animate-pulse rounded-full bg-orange-500/20 blur-2xl" />
              </div>
              <h2 className="bg-gradient-to-b from-yellow-200 via-orange-400 to-red-600 bg-clip-text text-3xl font-black tracking-tighter text-transparent drop-shadow-[0_4px_12px_rgba(255,120,40,0.5)] sm:text-4xl md:text-5xl">
                JET RUSH
              </h2>
            </div>
            <p className="max-w-xs text-center text-sm text-white/80">
              Тапай <b>верх</b> / <b>низ</b> экрана, чтобы маневрировать. Уворачивайся от ракет, собирай монеты и бонусы.
            </p>
            <div className="flex flex-wrap justify-center gap-2.5 text-[11px] text-white/85">
              <LegendChip color="#6bd4ff" label="Щит" />
              <LegendChip color="#b48bff" label="Slow-Mo" />
              <LegendChip color="#ffce4a" label="Boost" />
            </div>
            <button
              onClick={start}
              className="group relative mt-2 w-full max-w-[260px] overflow-hidden rounded-full bg-gradient-to-r from-orange-500 to-red-600 px-6 py-3 text-lg font-bold text-white shadow-lg shadow-orange-500/40 transition-transform hover:scale-105 active:scale-95 sm:px-10"
            >
              <span className="relative z-10">▶  PLAY</span>
              <span className="absolute inset-0 -z-0 animate-pulse bg-white/20 opacity-0 group-hover:opacity-100" />
            </button>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={() => setShopTab("skins")}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white backdrop-blur-sm hover:bg-white/20"
              >
                ✈ Скины
              </button>
              <button
                onClick={() => setShopTab("maps")}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white backdrop-blur-sm hover:bg-white/20"
              >
                🗺 Карты
              </button>
              <button
                onClick={() => setQuestsOpen(true)}
                className="relative rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white backdrop-blur-sm hover:bg-white/20"
              >
                🎯 Задания
                {questState.quests.some((q) => !q.claimed && q.progress >= q.def.target) && (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-green-400 ring-2 ring-black/60" />
                )}
              </button>
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-yellow-300/60 bg-black/40 px-3 py-1 font-mono text-xs font-bold text-yellow-300">
              <span>●</span>
              <span>{wallet.toLocaleString()}</span>
            </div>
            {best > 0 && (
              <p className="text-xs text-white/50">
                Лучший: <span className="font-mono text-white/80">{best.toLocaleString()}</span> · ● {bestCoins}
              </p>
            )}
          </Overlay>
        )}

        {state === "menu" && shopTab && (
          <ShopOverlay
            tab={shopTab}
            wallet={wallet}
            skinId={skinId}
            mapId={mapId}
            ownedSkins={ownedSkins}
            ownedMaps={ownedMaps}
            onBuySkin={buySkin}
            onBuyMap={buyMap}
            onClose={() => setShopTab(null)}
          />
        )}

        {state === "menu" && questsOpen && (
          <QuestsOverlay
            questState={questState}
            onClaim={claimQuest}
            onClose={() => setQuestsOpen(false)}
          />
        )}

        {state === "revive" && (
          <Overlay>
            <h2 className="text-2xl font-black uppercase tracking-wider text-orange-300 drop-shadow-[0_2px_8px_rgba(255,140,40,0.6)]">
              Продолжить?
            </h2>
            <div className="relative flex h-24 w-24 items-center justify-center">
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,0.15)" strokeWidth="6" fill="none" />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  stroke="#ffce4a"
                  strokeWidth="6"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 44}
                  strokeDashoffset={2 * Math.PI * 44 * (1 - reviveLeft / REVIVE_SECONDS)}
                  style={{ transition: "stroke-dashoffset 0.1s linear" }}
                />
              </svg>
              <span className="font-mono text-3xl font-bold text-white">{reviveLeft}</span>
            </div>
            <p className="text-center text-xs text-white/70">
              Восстанови самолёт и продолжи забег
            </p>
            <button
              onClick={revive}
              disabled={wallet < REVIVE_COST}
              className="group relative w-full max-w-[260px] overflow-hidden rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 px-5 py-2.5 text-base font-bold text-black shadow-lg shadow-yellow-500/40 transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:px-7"
            >
              <span className="relative z-10">♥ ОЖИВИТЬ · ● {REVIVE_COST}</span>
            </button>
            <div className="font-mono text-xs text-yellow-300/90">У тебя: ● {wallet}</div>
            <button
              onClick={() => finalizeOver("choice")}
              className="text-xs uppercase tracking-widest text-white/50 hover:text-white/80"
            >
              Пропустить
            </button>
          </Overlay>
        )}


        {state === "choice" && (
          <Overlay>
            <h2 className="text-3xl font-black uppercase tracking-wider text-red-400 drop-shadow-[0_2px_8px_rgba(255,60,40,0.6)]">
              Crashed
            </h2>
            <div className="flex flex-col items-center gap-1">
              <div className="font-mono text-4xl font-bold text-white">
                {score.toLocaleString()}
              </div>
              <div className="font-mono text-base text-yellow-300">● {coins}</div>
            </div>
            {(best > 0 || bestCoins > 0) && (
              <p className="text-xs text-white/60">
                Best: <span className="font-mono text-white/85">{best.toLocaleString()}</span> · ● {bestCoins}
              </p>
            )}
            {score >= best && score > 0 && (
              <p className="animate-pulse text-sm font-bold uppercase tracking-widest text-yellow-300">
                ★ New Record ★
              </p>
            )}
            <div className="mt-1 flex w-full max-w-[280px] flex-col gap-3">
              <button
                onClick={start}
                className="w-full rounded-full bg-gradient-to-r from-orange-500 to-red-600 px-6 py-2.5 text-base font-bold text-white shadow-lg shadow-orange-500/40 transition-transform hover:scale-105 active:scale-95 sm:px-8"
              >
                ↻  Играть дальше
              </button>
              <button
                onClick={() => setState("menu")}
                className="w-full rounded-full border border-white/20 bg-white/10 px-6 py-2.5 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-white/20 sm:px-8"
              >
                🏠  Главное меню
              </button>
            </div>
          </Overlay>
        )}

        {state === "over" && (
          <Overlay>
            <h2 className="text-3xl font-black uppercase tracking-wider text-red-400 drop-shadow-[0_2px_8px_rgba(255,60,40,0.6)]">
              Crashed
            </h2>
            <div className="flex flex-col items-center gap-1">
              <div className="font-mono text-4xl font-bold text-white">
                {score.toLocaleString()}
              </div>
              <div className="font-mono text-base text-yellow-300">● {coins}</div>
            </div>
            {(best > 0 || bestCoins > 0) && (
              <p className="text-xs text-white/60">
                Best: <span className="font-mono text-white/85">{best.toLocaleString()}</span> · ● {bestCoins}
              </p>
            )}
            {score >= best && score > 0 && (
              <p className="animate-pulse text-sm font-bold uppercase tracking-widest text-yellow-300">
                ★ New Record ★
              </p>
            )}
            <button
              onClick={start}
              className="mt-1 w-full max-w-[260px] rounded-full bg-gradient-to-r from-orange-500 to-red-600 px-6 py-2.5 text-base font-bold text-white shadow-lg shadow-orange-500/40 transition-transform hover:scale-105 active:scale-95 sm:px-8"
            >
              ↻  RETRY
            </button>
          </Overlay>
        )}
      </div>
      <p className="text-center text-xs text-white/50">
        ↑ / ↓ или тапай по экрану · Space — старт
      </p>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-hidden rounded-lg bg-black/60 px-3 backdrop-blur-sm">
      {children}
    </div>
  );
}

interface ShopOverlayProps {
  tab: "skins" | "maps";
  wallet: number;
  skinId: string;
  mapId: string;
  ownedSkins: string[];
  ownedMaps: string[];
  onBuySkin: (s: Skin) => void;
  onBuyMap: (m: MapTheme) => void;
  onClose: () => void;
}

function ShopOverlay({
  tab,
  wallet,
  skinId,
  mapId,
  ownedSkins,
  ownedMaps,
  onBuySkin,
  onBuyMap,
  onClose,
}: ShopOverlayProps) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/85 backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/10 p-3">
        <button
          onClick={onClose}
          className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/15"
        >
          ← Назад
        </button>
        <div className="flex items-center gap-1.5 rounded-full border border-yellow-300/60 bg-black/40 px-3 py-1 font-mono text-sm font-bold text-yellow-300">
          <span>●</span>
          <span>{wallet.toLocaleString()}</span>
        </div>
      </div>
      <div className="flex justify-center p-3">
        <div className="text-sm font-bold uppercase tracking-wider text-white/90">
          {tab === "skins" ? "Скины" : "Карты"}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="grid grid-cols-1 gap-2.5">
          {tab === "skins" &&
            SKINS.map((s) => {
              const owned = ownedSkins.includes(s.id);
              const selected = skinId === s.id;
              const canBuy = owned || wallet >= s.price;
              return (
                <button
                  key={s.id}
                  onClick={() => onBuySkin(s)}
                  disabled={!canBuy}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    selected
                      ? "border-orange-400 bg-orange-500/15"
                      : "border-white/15 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-14 rounded-md border border-white/20"
                      style={{
                        background: `linear-gradient(180deg, ${s.fuse[0]}, ${s.fuse[1]} 55%, ${s.fuse[2]})`,
                      }}
                    />
                    <div>
                      <div className="text-sm font-bold text-white">{s.name}</div>
                      <div className="text-[10px] uppercase tracking-wider text-white/50">
                        {owned ? (selected ? "Выбрано" : "Куплено") : `● ${s.price}`}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      selected
                        ? "bg-orange-500 text-white"
                        : owned
                          ? "bg-white/15 text-white"
                          : canBuy
                            ? "bg-yellow-400 text-black"
                            : "bg-white/10 text-white/40"
                    }`}
                  >
                    {selected ? "✓" : owned ? "Выбрать" : canBuy ? "Купить" : "Не хватает"}
                  </span>
                </button>
              );
            })}
          {tab === "maps" &&
            MAPS.map((m) => {
              const owned = ownedMaps.includes(m.id);
              const selected = mapId === m.id;
              const canBuy = owned || wallet >= m.price;
              return (
                <button
                  key={m.id}
                  onClick={() => onBuyMap(m)}
                  disabled={!canBuy}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    selected
                      ? "border-orange-400 bg-orange-500/15"
                      : "border-white/15 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-14 rounded-md border border-white/20"
                      style={{
                        background: `linear-gradient(180deg, ${m.sky[0]}, ${m.sky[1]} 40%, ${m.sky[2]} 75%, ${m.sky[3]})`,
                      }}
                    />
                    <div>
                      <div className="text-sm font-bold text-white">{m.name}</div>
                      <div className="text-[10px] uppercase tracking-wider text-white/50">
                        {owned ? (selected ? "Выбрано" : "Куплено") : `● ${m.price}`}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      selected
                        ? "bg-orange-500 text-white"
                        : owned
                          ? "bg-white/15 text-white"
                          : canBuy
                            ? "bg-yellow-400 text-black"
                            : "bg-white/10 text-white/40"
                    }`}
                  >
                    {selected ? "✓" : owned ? "Выбрать" : canBuy ? "Купить" : "Не хватает"}
                  </span>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}


function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="rounded-full border px-2 py-1"
      style={{ borderColor: color, color, background: "rgba(0,0,0,0.45)" }}
    >
      {children}
    </span>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      {label}
    </span>
  );
}

// ===== helpers =====
function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function withAlpha(c: string, a: number) {
  if (c.startsWith("#")) {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return c;
}

function drawDistantMountains(ctx: CanvasRenderingContext2D, off: number) {
  ctx.fillStyle = "rgba(40,20,40,0.55)";
  ctx.beginPath();
  ctx.moveTo(0, H * 0.55);
  for (let x = 0; x <= W; x += 30) {
    const n =
      Math.sin((x + off) * 0.012) * 18 + Math.sin((x + off) * 0.03) * 8 + Math.cos((x + off) * 0.005) * 14;
    ctx.lineTo(x, H * 0.55 + n);
  }
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(25,12,25,0.7)";
  ctx.beginPath();
  ctx.moveTo(0, H * 0.62);
  for (let x = 0; x <= W; x += 25) {
    const n =
      Math.sin((x + off * 1.4) * 0.018) * 22 + Math.cos((x + off * 1.4) * 0.04) * 10;
    ctx.lineTo(x, H * 0.62 + n);
  }
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
}

function drawCanyon(
  ctx: CanvasRenderingContext2D,
  segs: Segment[],
  offset: number,
  distance: number,
) {
  const drawBand = (isTop: boolean) => {
    ctx.beginPath();
    if (isTop) {
      ctx.moveTo(-SEG_W, -10);
      for (let i = 0; i < segs.length; i++) {
        const x = i * SEG_W - offset;
        const seed = Math.floor(distance / SEG_W) + i;
        const j = ((Math.sin(seed * 12.9898) * 43758.5453) % 1) * 16;
        ctx.lineTo(x + SEG_W / 2, segs[i].topH + j - 4);
      }
      ctx.lineTo(W + SEG_W, -10);
    } else {
      ctx.moveTo(-SEG_W, H + 10);
      for (let i = 0; i < segs.length; i++) {
        const x = i * SEG_W - offset;
        const seed = Math.floor(distance / SEG_W) + i + 999;
        const j = ((Math.sin(seed * 12.9898) * 43758.5453) % 1) * 16;
        ctx.lineTo(x + SEG_W / 2, H - segs[i].botH - j + 4);
      }
      ctx.lineTo(W + SEG_W, H + 10);
    }
    ctx.closePath();

    const grd = isTop
      ? ctx.createLinearGradient(0, 0, 0, H / 2)
      : ctx.createLinearGradient(0, H / 2, 0, H);
    if (isTop) {
      grd.addColorStop(0, "#2a0e08");
      grd.addColorStop(0.6, "#5e2818");
      grd.addColorStop(1, "#9a4528");
    } else {
      grd.addColorStop(0, "#9a4528");
      grd.addColorStop(0.4, "#5e2818");
      grd.addColorStop(1, "#1a0806");
    }
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.save();
    ctx.clip();

    // rim light along edge
    ctx.strokeStyle = "rgba(255,180,100,0.7)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i < segs.length; i++) {
      const x = i * SEG_W - offset;
      const seed = Math.floor(distance / SEG_W) + i + (isTop ? 0 : 999);
      const j = ((Math.sin(seed * 12.9898) * 43758.5453) % 1) * 16;
      const y = isTop ? segs[i].topH + j - 4 : H - segs[i].botH - j + 4;
      if (i === 0) ctx.moveTo(x + SEG_W / 2, y);
      else ctx.lineTo(x + SEG_W / 2, y);
    }
    ctx.stroke();

    // strata bands
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    if (isTop) {
      for (let y = 20; y < H / 2; y += 14) ctx.fillRect(0, y, W, 1);
    } else {
      for (let y = H / 2; y < H; y += 14) ctx.fillRect(0, y, W, 1);
    }

    // cracks
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    for (let i = 0; i < segs.length; i += 2) {
      const x = i * SEG_W - offset;
      const seed = Math.floor(distance / SEG_W) + i + (isTop ? 333 : 777);
      const r1 = (((Math.sin(seed * 7.13) * 43758.5453) % 1) + 1) % 1;
      const r2 = (((Math.sin(seed * 3.71) * 43758.5453) % 1) + 1) % 1;
      ctx.beginPath();
      if (isTop) {
        ctx.moveTo(x, segs[i].topH - 4 - r1 * 40);
        ctx.lineTo(x + SEG_W * 1.5, segs[i].topH - 18 - r2 * 60);
      } else {
        ctx.moveTo(x, H - segs[i].botH + 4 + r1 * 40);
        ctx.lineTo(x + SEG_W * 1.5, H - segs[i].botH + 18 + r2 * 60);
      }
      ctx.stroke();
    }

    // speckles (sun-touched edges)
    ctx.fillStyle = "rgba(255,210,150,0.25)";
    for (let i = 0; i < segs.length; i++) {
      const x = i * SEG_W - offset;
      const seed = Math.floor(distance / SEG_W) + i + (isTop ? 111 : 555);
      const r = (((Math.sin(seed * 5.17) * 43758.5453) % 1) + 1) % 1;
      if (r > 0.65) {
        const y = isTop ? segs[i].topH - 6 - r * 28 : H - segs[i].botH + 6 + r * 28;
        ctx.fillRect(x + 4, y, 3, 2);
      }
    }
    ctx.restore();
  };
  drawBand(true);
  drawBand(false);
}

function drawMissile(ctx: CanvasRenderingContext2D, m: Missile) {
  const angle = Math.atan2(m.vy, m.vx);
  for (let t = 0; t < m.trail.length; t++) {
    const p = m.trail[t];
    const a = (t / m.trail.length) * 0.55;
    const r = 1.5 + (t / m.trail.length) * 4;
    ctx.fillStyle = `rgba(220,220,230,${a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(m.x, m.y);
  ctx.rotate(angle);

  // exhaust
  const fl = 9 + Math.random() * 6;
  const fg = ctx.createLinearGradient(6, 0, 6 + fl, 0);
  fg.addColorStop(0, "rgba(255,240,180,1)");
  fg.addColorStop(0.5, "rgba(255,140,40,0.85)");
  fg.addColorStop(1, "rgba(255,60,0,0)");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(6, -1.8);
  ctx.lineTo(6 + fl, 0);
  ctx.lineTo(6, 1.8);
  ctx.closePath();
  ctx.fill();

  // body
  const bg = ctx.createLinearGradient(0, -3, 0, 3);
  bg.addColorStop(0, "#dde2ea");
  bg.addColorStop(0.5, "#90979f");
  bg.addColorStop(1, "#3a3f47");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(-13, 0);
  ctx.lineTo(-7, -2.6);
  ctx.lineTo(6, -2.6);
  ctx.lineTo(6, 2.6);
  ctx.lineTo(-7, 2.6);
  ctx.closePath();
  ctx.fill();

  // fins
  ctx.fillStyle = "#1f242b";
  ctx.beginPath();
  ctx.moveTo(4, -2.6);
  ctx.lineTo(9, -5.4);
  ctx.lineTo(7, -2.6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(4, 2.6);
  ctx.lineTo(9, 5.4);
  ctx.lineTo(7, 2.6);
  ctx.closePath();
  ctx.fill();

  // red tip
  ctx.fillStyle = "#e34a3a";
  ctx.beginPath();
  ctx.moveTo(-13, 0);
  ctx.lineTo(-7, -1.7);
  ctx.lineTo(-7, 1.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPowerup(ctx: CanvasRenderingContext2D, p: PowerUp) {
  const bob = Math.sin(p.t * 0.08) * 4;
  const color =
    p.kind === "shield" ? "#6bd4ff" : p.kind === "slowmo" ? "#b48bff" : "#ffce4a";
  ctx.save();
  ctx.translate(p.x, p.y + bob);

  // glow
  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 28);
  glow.addColorStop(0, withAlpha(color, 0.7));
  glow.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 28, 0, Math.PI * 2);
  ctx.fill();

  // capsule body
  ctx.rotate(Math.sin(p.t * 0.05) * 0.15);
  ctx.fillStyle = "rgba(15,15,25,0.85)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // icon
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  if (p.kind === "shield") {
    ctx.moveTo(0, -7);
    ctx.lineTo(7, -3);
    ctx.lineTo(6, 5);
    ctx.lineTo(0, 8);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-7, -3);
    ctx.closePath();
    ctx.fill();
  } else if (p.kind === "slowmo") {
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(0, 0);
    ctx.lineTo(4, 2);
    ctx.stroke();
  } else {
    // boost lightning
    ctx.moveTo(2, -8);
    ctx.lineTo(-3, 1);
    ctx.lineTo(1, 1);
    ctx.lineTo(-2, 8);
    ctx.lineTo(4, -1);
    ctx.lineTo(0, -1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawJet(
  ctx: CanvasRenderingContext2D,
  y: number,
  keys: { up: boolean; down: boolean },
  isBoost: boolean,
  hasShield: boolean,
  tick: number,
  skin: Skin,
) {
  ctx.save();
  ctx.translate(PLANE_X, y);
  const bank = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  ctx.scale(1, 1 + bank * 0.05);

  // soft shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(2, 20, 24, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // afterburner (twin) — bigger with boost
  const flameLen = (isBoost ? 22 : 12) + Math.random() * (isBoost ? 14 : 8);
  for (const offY of [-4, 4]) {
    const fg = ctx.createLinearGradient(-22 - flameLen, offY, -20, offY);
    fg.addColorStop(0, "rgba(255,60,0,0)");
    fg.addColorStop(0.35, isBoost ? "rgba(80,200,255,0.85)" : "rgba(255,120,30,0.85)");
    fg.addColorStop(0.8, isBoost ? "rgba(180,240,255,1)" : "rgba(255,220,120,1)");
    fg.addColorStop(1, "rgba(255,255,240,1)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-20, offY - 2.4);
    ctx.lineTo(-20 - flameLen, offY);
    ctx.lineTo(-20, offY + 2.4);
    ctx.closePath();
    ctx.fill();
  }

  // horizontal stabilizers
  ctx.fillStyle = "#39424d";
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

  // main swept wings
  const wing = ctx.createLinearGradient(0, -20, 0, 20);
  wing.addColorStop(0, skin.wing[0]);
  wing.addColorStop(0.5, skin.wing[1]);
  wing.addColorStop(1, skin.wing[2]);
  ctx.fillStyle = wing;
  ctx.beginPath();
  ctx.moveTo(8, -4);
  ctx.lineTo(-3, -22);
  ctx.lineTo(-15, -22);
  ctx.lineTo(-14, -16);
  ctx.lineTo(-7, -4);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, 4);
  ctx.lineTo(-3, 22);
  ctx.lineTo(-15, 22);
  ctx.lineTo(-14, 16);
  ctx.lineTo(-7, 4);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(-8, -20);
  ctx.moveTo(0, 6);
  ctx.lineTo(-8, 20);
  ctx.stroke();

  // wing-mounted missiles
  for (const wy of [-15, 13]) {
    ctx.fillStyle = "#262b33";
    ctx.beginPath();
    ctx.moveTo(9, wy);
    ctx.lineTo(-10, wy);
    ctx.lineTo(-12, wy + 1);
    ctx.lineTo(-10, wy + 2);
    ctx.lineTo(9, wy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#e34a3a";
    ctx.beginPath();
    ctx.moveTo(12, wy + 1);
    ctx.lineTo(9, wy);
    ctx.lineTo(9, wy + 2);
    ctx.closePath();
    ctx.fill();
  }

  // fuselage
  const fuse = ctx.createLinearGradient(0, -6, 0, 6);
  fuse.addColorStop(0, skin.fuse[0]);
  fuse.addColorStop(0.5, skin.fuse[1]);
  fuse.addColorStop(1, skin.fuse[2]);
  ctx.fillStyle = fuse;
  ctx.beginPath();
  ctx.moveTo(28, 0);
  ctx.lineTo(22, -3);
  ctx.lineTo(7, -6);
  ctx.lineTo(-18, -5);
  ctx.lineTo(-20, -3);
  ctx.lineTo(-20, 3);
  ctx.lineTo(-18, 5);
  ctx.lineTo(7, 6);
  ctx.lineTo(22, 3);
  ctx.closePath();
  ctx.fill();

  // panel lines along fuselage
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(20, -2);
  ctx.lineTo(-16, -2);
  ctx.moveTo(20, 2);
  ctx.lineTo(-16, 2);
  ctx.stroke();

  // intakes
  ctx.fillStyle = "#13171c";
  ctx.beginPath();
  ctx.ellipse(-3, -5, 5, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-3, 5, 5, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // tail fin
  ctx.fillStyle = "#525c67";
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(-19, -1);
  ctx.lineTo(-14, 1);
  ctx.closePath();
  ctx.fill();

  // nose cone
  ctx.fillStyle = "#6b7480";
  ctx.beginPath();
  ctx.moveTo(28, 0);
  ctx.lineTo(20, -2);
  ctx.lineTo(20, 2);
  ctx.closePath();
  ctx.fill();

  // canopy
  const canopy = ctx.createLinearGradient(4, -3, 14, 3);
  canopy.addColorStop(0, "#163460");
  canopy.addColorStop(0.6, "#5b8fc9");
  canopy.addColorStop(1, "#0c1c36");
  ctx.fillStyle = canopy;
  ctx.beginPath();
  ctx.ellipse(9, 0, 6.5, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.ellipse(10, -1.3, 2.8, 0.9, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // roundel
  ctx.fillStyle = "#d0d8e0";
  ctx.beginPath();
  ctx.arc(-2, 0, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = skin.accent;
  ctx.beginPath();
  ctx.arc(-2, 0, 0.9, 0, Math.PI * 2);
  ctx.fill();

  // shield bubble
  if (hasShield) {
    const pulse = 0.6 + Math.sin(tick * 0.18) * 0.15;
    ctx.strokeStyle = `rgba(120,210,255,${pulse})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.stroke();
    const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 26);
    g.addColorStop(0, "rgba(120,210,255,0)");
    g.addColorStop(1, "rgba(120,210,255,0.22)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawCoin(ctx: CanvasRenderingContext2D, c: Coin) {
  const bob = Math.sin(c.t * 0.12) * 3;
  // flip rotation: scale x by sin to fake 3D spin
  const sx = Math.cos(c.t * 0.18);
  const w = Math.max(0.15, Math.abs(sx));
  ctx.save();
  ctx.translate(c.x, c.y + bob);

  // glow
  const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 18);
  glow.addColorStop(0, "rgba(255,220,90,0.55)");
  glow.addColorStop(1, "rgba(255,220,90,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fill();

  // coin body
  ctx.scale(w, 1);
  const g = ctx.createRadialGradient(-2, -3, 1, 0, 0, 9);
  g.addColorStop(0, "#fff3a8");
  g.addColorStop(0.5, "#ffd84a");
  g.addColorStop(1, "#b07a10");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  // edge
  ctx.strokeStyle = "rgba(120,70,5,0.8)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // star mark
  if (sx > 0) {
    ctx.fillStyle = "rgba(120,70,5,0.85)";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("★", 0, 1);
  } else {
    ctx.fillStyle = "rgba(120,70,5,0.7)";
    ctx.fillRect(-5, -1, 10, 2);
  }
  ctx.restore();
}

function QuestsOverlay({
  questState,
  onClaim,
  onClose,
}: {
  questState: QuestState;
  onClaim: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/85 backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/10 p-3">
        <div className="text-base font-bold uppercase tracking-wider text-white">
          🎯 Ежедневные задания
        </div>
        <button
          onClick={onClose}
          className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold text-white hover:bg-white/20"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-2">
          {questState.quests.map((q) => {
            const pct = Math.min(100, (q.progress / q.def.target) * 100);
            const done = q.progress >= q.def.target;
            const hard = q.def.difficulty === "hard";
            return (
              <div
                key={q.def.id}
                className={`rounded-lg border p-3 ${
                  hard
                    ? "border-orange-400/50 bg-orange-500/10"
                    : "border-white/15 bg-white/5"
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        hard
                          ? "bg-orange-500/30 text-orange-200"
                          : "bg-white/15 text-white/80"
                      }`}
                    >
                      {hard ? "Сложно" : "Легко"}
                    </span>
                    <span className="text-sm font-bold text-white">{q.def.title}</span>
                  </div>
                  <div className="font-mono text-xs font-bold text-yellow-300">
                    ● {q.def.reward}
                  </div>
                </div>
                <div className="mb-2 h-2 overflow-hidden rounded-full bg-black/40">
                  <div
                    className={`h-full transition-all ${
                      hard
                        ? "bg-gradient-to-r from-orange-400 to-red-500"
                        : "bg-gradient-to-r from-yellow-300 to-orange-400"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[11px] text-white/60">
                    {Math.min(q.progress, q.def.target)} / {q.def.target}
                  </div>
                  <button
                    disabled={!done || q.claimed}
                    onClick={() => onClaim(q.def.id)}
                    className="rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-black shadow disabled:cursor-not-allowed disabled:from-white/10 disabled:to-white/10 disabled:text-white/40 disabled:shadow-none"
                  >
                    {q.claimed ? "Получено" : done ? "Забрать" : "В процессе"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-center text-[10px] uppercase tracking-widest text-white/40">
          Новые задания каждый день
        </p>
      </div>
    </div>
  );
}

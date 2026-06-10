import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import gameIcon from "../assets/game-icon.png";
import playerJetSrc from "../assets/player-jet.png";
import gameOverBg from "../assets/game-over.jpg";

type BrowserFaceDetector = {
  detect(source: CanvasImageSource): Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
};

type FaceDetectorWindow = Window & {
  FaceDetector?: new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => BrowserFaceDetector;
};

// Cached player jet sprite (loaded once)
let _jetImg: HTMLImageElement | null = null;
function getJetImg(): HTMLImageElement | null {
  if (typeof window === "undefined") return null;
  if (!_jetImg) {
    const img = new Image();
    img.src = playerJetSrc;
    _jetImg = img;
  }
  return _jetImg.complete && _jetImg.naturalWidth > 0 ? _jetImg : null;
}

// Tinted jet cache: keep a recoloured canvas per skin id
const _tintCache = new Map<string, HTMLCanvasElement>();
function getTintedJet(
  jet: HTMLImageElement,
  skin: { id: string; fuse: [string, string, string]; accent: string },
): HTMLCanvasElement | HTMLImageElement {
  // White/neutral skin = no tint
  if (skin.id === "classic") {
    const cached = _tintCache.get("__raw");
    if (cached) return cached;
    const c = document.createElement("canvas");
    c.width = jet.naturalWidth;
    c.height = jet.naturalHeight;
    c.getContext("2d")!.drawImage(jet, 0, 0);
    _tintCache.set("__raw", c);
    return c;
  }
  const key = `${skin.id}|${skin.fuse[1]}|${skin.accent}`;
  const hit = _tintCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = jet.naturalWidth;
  c.height = jet.naturalHeight;
  const cx = c.getContext("2d")!;
  // 1. base sprite
  cx.drawImage(jet, 0, 0);
  // 2. multiply skin color over only the opaque pixels (keeps shading)
  cx.globalCompositeOperation = "multiply";
  cx.fillStyle = skin.fuse[1];
  cx.fillRect(0, 0, c.width, c.height);
  // 3. restore original alpha mask (multiply also tinted transparent halo)
  cx.globalCompositeOperation = "destination-in";
  cx.drawImage(jet, 0, 0);
  cx.globalCompositeOperation = "source-over";
  _tintCache.set(key, c);
  return c;
}

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getAiBuddyLine } from "@/lib/api/gemini.functions";


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

type GameState = "menu" | "briefing" | "playing" | "paused" | "revive" | "over" | "choice";

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
  emoji: string;
  // Optional decorative overlay on the fuselage.
  pattern?: "stripes-v" | "stripes-h" | "dots" | "checker" | "zigzag" | "stars" | "flames";
  patternColor?: string;
  // Optional: render as a giant emoji vehicle instead of the jet geometry.
  vehicle?: "helicopter" | "ufo" | "military" | "bomber" | "spaceship" | "biplane" | "balloon" | "dragon";
  category?: "skin" | "vehicle";
}
interface MapTheme {
  id: string;
  name: string;
  price: number;
  sky: [string, string, string, string];
  sun: string;
  sunAlpha: string;
  emoji: string;
}

const SKINS: Skin[] = [
  { id: "classic", name: "Стандартный", price: 0, fuse: ["#f5f7fa", "#c8ced6", "#7a828c"], wing: ["#dde2e8", "#9aa3ad", "#5a626c"], accent: "#e23a3a", emoji: "" },
  { id: "flame", name: "Пламя", price: 250, fuse: ["#ffd0a0", "#e84a18", "#5a1408"], wing: ["#ffa050", "#a82010", "#5a0a04"], accent: "#ffe040", emoji: "" },
  { id: "pulse", name: "Импульс", price: 300, fuse: ["#d0f0ff", "#3a9ad8", "#0a3060"], wing: ["#a8e0ff", "#1a70b8", "#0a2848"], accent: "#80e8ff", emoji: "" },
  { id: "neon", name: "Неон", price: 600, fuse: ["#ffd0ff", "#c040d8", "#400858"], wing: ["#ff90f8", "#9020c0", "#300648"], accent: "#ff40f0", emoji: "" },
  { id: "solar", name: "Солнечный шторм", price: 1200, fuse: ["#fff0a0", "#f8a020", "#5a2808"], wing: ["#ffd060", "#c87018", "#503010"], accent: "#ffff60", emoji: "" },
  { id: "shadow", name: "Тень", price: 800, fuse: ["#5a4050", "#28181c", "#080408"], wing: ["#403040", "#181018", "#000000"], accent: "#ff2040", emoji: "" },
  { id: "cyber", name: "Кибер", price: 500, fuse: ["#c0ffc0", "#30d050", "#082818"], wing: ["#80f0a0", "#188838", "#042010"], accent: "#00ff80", emoji: "" },
  { id: "angel", name: "Ангел", price: 1500, fuse: ["#ffffff", "#e8e8f0", "#a8a8b8"], wing: ["#f8f8ff", "#c0c0d0", "#808090"], accent: "#ffe060", emoji: "" },

  // === EMOJI / PATTERN SKINS ===
  { id: "bee", name: "Пчёлка 🐝", price: 350, fuse: ["#fff0a0", "#ffd020", "#7a5008"], wing: ["#ffe060", "#c89018", "#5a3808"], accent: "#1a1a1a", emoji: "🐝", pattern: "stripes-v", patternColor: "#1a1a1a" },
  { id: "tiger", name: "Тигр 🐯", price: 450, fuse: ["#ffb050", "#e87010", "#5a2808"], wing: ["#ffa040", "#c05808", "#502008"], accent: "#1a1a1a", emoji: "🐯", pattern: "stripes-v", patternColor: "#1a0a08" },
  { id: "zebra", name: "Зебра 🦓", price: 400, fuse: ["#ffffff", "#e8e8e8", "#a0a0a0"], wing: ["#f8f8f8", "#c0c0c0", "#606060"], accent: "#1a1a1a", emoji: "🦓", pattern: "stripes-v", patternColor: "#0a0a0a" },
  { id: "racer", name: "Гонщик 🏎️", price: 500, fuse: ["#ffff60", "#f0c000", "#704800"], wing: ["#ffe040", "#c89000", "#503600"], accent: "#e02020", emoji: "🏎️", pattern: "stripes-h", patternColor: "#1a1a1a" },
  { id: "frog", name: "Лягушка 🐸", price: 400, fuse: ["#c0ff80", "#60c020", "#1a4008"], wing: ["#a0e060", "#408018", "#103008"], accent: "#fff060", emoji: "🐸", pattern: "dots", patternColor: "#2a5008" },
  { id: "ladybug", name: "Божья коровка 🐞", price: 450, fuse: ["#ff4040", "#c01010", "#400000"], wing: ["#e02020", "#800808", "#300000"], accent: "#1a1a1a", emoji: "🐞", pattern: "dots", patternColor: "#0a0a0a" },
  { id: "panda", name: "Панда 🐼", price: 550, fuse: ["#ffffff", "#e8e8e8", "#a8a8a8"], wing: ["#1a1a1a", "#080808", "#1a1a1a"], accent: "#1a1a1a", emoji: "🐼", pattern: "dots", patternColor: "#1a1a1a" },
  { id: "checker", name: "Шахматы ♟️", price: 600, fuse: ["#ffffff", "#e8e8e8", "#909090"], wing: ["#1a1a1a", "#080808", "#1a1a1a"], accent: "#c08020", emoji: "♟️", pattern: "checker", patternColor: "#0a0a0a" },
  { id: "shark", name: "Акула 🦈", price: 700, fuse: ["#a0b0c0", "#506878", "#1a2838"], wing: ["#809098", "#384858", "#101820"], accent: "#ff3040", emoji: "🦈", pattern: "zigzag", patternColor: "#0a1018" },
  { id: "unicorn", name: "Единорог 🦄", price: 1100, fuse: ["#ffd0f0", "#c080ff", "#5a2080"], wing: ["#80d0ff", "#40a0e0", "#103060"], accent: "#fff060", emoji: "🦄", pattern: "stars", patternColor: "#ffffff" },
  { id: "phoenix", name: "Феникс 🔥", price: 1300, fuse: ["#ffe060", "#ff6020", "#7a1808"], wing: ["#ffd040", "#e04010", "#5a0808"], accent: "#fff080", emoji: "🔥", pattern: "flames", patternColor: "#ffff80" },
  { id: "ghost", name: "Призрак 👻", price: 800, fuse: ["#f0f0ff", "#c0c0e8", "#7080a0"], wing: ["#e0e0f0", "#9098c0", "#404868"], accent: "#a0c0ff", emoji: "👻", pattern: "dots", patternColor: "#3040707a" },
  { id: "cosmic", name: "Космо-кот 🐱‍🚀", price: 1400, fuse: ["#3020a0", "#180848", "#08001a"], wing: ["#5030c0", "#200858", "#100428"], accent: "#80f0ff", emoji: "🐱‍🚀", pattern: "stars", patternColor: "#ffd0ff" },
  { id: "rainbow", name: "Радуга 🌈", price: 1600, fuse: ["#ff4040", "#40a0ff", "#a040ff"], wing: ["#ffa040", "#40d080", "#ff40a0"], accent: "#ffffff", emoji: "🌈", pattern: "stripes-h", patternColor: "#ffffff" },



  // === VEHICLES ===
  { id: "v-heli", name: "Вертолёт", price: 1200, fuse: ["#3a4a30", "#1a2818", "#0a1408"], wing: ["#3a4a30", "#1a2818", "#3a4a30"], accent: "#ffcc00", emoji: "🚁", vehicle: "helicopter", category: "vehicle" },
  { id: "v-ufo", name: "НЛО", price: 2500, fuse: ["#c0c8d0", "#7080a0", "#202838"], wing: ["#a0b0c8", "#404858", "#a0b0c8"], accent: "#00ffff", emoji: "🛸", vehicle: "ufo", category: "vehicle" },
  { id: "v-military", name: "Военный истребитель", price: 1800, fuse: ["#5a6a4a", "#2a3a1c", "#0a1408"], wing: ["#4a5a3a", "#1a2818", "#4a5a3a"], accent: "#c0c000", emoji: "🛩️", vehicle: "military", category: "vehicle" },
  { id: "v-bomber", name: "Стелс-бомбардировщик", price: 3000, fuse: ["#1a1a20", "#08080c", "#000000"], wing: ["#15151a", "#050508", "#15151a"], accent: "#80a0ff", emoji: "🛫", vehicle: "bomber", category: "vehicle" },
  { id: "v-spaceship", name: "Космолёт", price: 3500, fuse: ["#a0d0ff", "#3060c0", "#101848"], wing: ["#80b0ff", "#2040a0", "#80b0ff"], accent: "#ffff80", emoji: "🚀", vehicle: "spaceship", category: "vehicle" },
  { id: "v-biplane", name: "Биплан", price: 900, fuse: ["#ffd060", "#c08020", "#603810"], wing: ["#e0a040", "#805010", "#e0a040"], accent: "#a02020", emoji: "🛩", vehicle: "biplane", category: "vehicle" },
  { id: "v-balloon", name: "Воздушный шар", price: 700, fuse: ["#ff6080", "#c02040", "#600810"], wing: ["#ff8090", "#a02030", "#ff8090"], accent: "#ffcc00", emoji: "🎈", vehicle: "balloon", category: "vehicle" },
  { id: "v-dragon", name: "Огнедышащий дракон", price: 4000, fuse: ["#c02010", "#600808", "#200000"], wing: ["#e04020", "#801010", "#e04020"], accent: "#ffd000", emoji: "🐲", vehicle: "dragon", category: "vehicle" },
];

const MAPS: MapTheme[] = [
  { id: "space", name: "Глубокий Космос", price: 0, sky: ["#000004", "#06061a", "#101030", "#000000"], sun: "#ffffff", sunAlpha: "200,200,255", emoji: "🌌" },
  { id: "nebula", name: "Туманность", price: 250, sky: ["#1a0028", "#3a0a55", "#7028a0", "#10001a"], sun: "#ff90f0", sunAlpha: "255,150,240", emoji: "💜" },
  { id: "mars", name: "Орбита Марса", price: 300, sky: ["#1a0808", "#3a1410", "#8a3018", "#2a0a08"], sun: "#ffb070", sunAlpha: "255,170,100", emoji: "🪐" },
  { id: "ice", name: "Ледяной Пояс", price: 400, sky: ["#04101a", "#0a2845", "#2a6a9a", "#06121c"], sun: "#d0f0ff", sunAlpha: "180,220,255", emoji: "❄️" },
  { id: "blackhole", name: "Чёрная Дыра", price: 900, sky: ["#000000", "#0a0218", "#3a0848", "#000000"], sun: "#c060ff", sunAlpha: "180,80,255", emoji: "🕳️" },
  { id: "sunset", name: "Закат", price: 350, sky: ["#1a0a2a", "#5a1a4a", "#e05040", "#ffa050"], sun: "#fff060", sunAlpha: "255,220,120", emoji: "🌅" },
  { id: "ocean", name: "Океан", price: 450, sky: ["#001828", "#003858", "#0a7090", "#40a0c0"], sun: "#80f0ff", sunAlpha: "150,230,255", emoji: "🌊" },
  { id: "jungle", name: "Джунгли", price: 500, sky: ["#021008", "#0a3018", "#1a6028", "#308040"], sun: "#c0ff80", sunAlpha: "180,255,140", emoji: "🌴" },
  { id: "candy", name: "Конфетный Мир", price: 700, sky: ["#ffd0e8", "#ffa0c8", "#f070b0", "#c050a0"], sun: "#ffffff", sunAlpha: "255,255,255", emoji: "🍭" },
  { id: "lava", name: "Лава", price: 800, sky: ["#1a0000", "#400000", "#a02000", "#ff5010"], sun: "#ffff00", sunAlpha: "255,200,80", emoji: "🌋" },
  { id: "aurora", name: "Северное Сияние", price: 1000, sky: ["#020a14", "#0a2840", "#1a8060", "#40ffa0"], sun: "#80ffd0", sunAlpha: "120,255,200", emoji: "🌠" },
  { id: "galaxy", name: "Галактика", price: 1500, sky: ["#000010", "#200840", "#6020a0", "#a040c0"], sun: "#ffd0ff", sunAlpha: "255,200,255", emoji: "🌟" },
  { id: "matrix", name: "Матрица", price: 1200, sky: ["#000000", "#001008", "#003020", "#00a040"], sun: "#00ff40", sunAlpha: "80,255,120", emoji: "🟢" },
  { id: "cherry", name: "Сакура", price: 600, sky: ["#1a0a14", "#3a1a28", "#a04060", "#ffc0d8"], sun: "#fff0f8", sunAlpha: "255,220,235", emoji: "🌸" },
];

const OTHER_WORLD: MapTheme = {
  id: "otherworld",
  name: "Иной Мир",
  price: 0,
  sky: ["#001a0a", "#0a3a28", "#3a0a55", "#1a0030"],
  sun: "#60ffd0",
  sunAlpha: "120,255,200",
  emoji: "🌀",
};

const CHERNOBYL_WORLD: MapTheme = {
  id: "chernobyl",
  name: "Чернобыль",
  price: 0,
  sky: ["#000000", "#080808", "#0c0c08", "#000000"],
  sun: "#1a1a1a",
  sunAlpha: "30,30,30",
  emoji: "☢️",
};

const LS = {
  wallet: "jr_wallet",
  ownedSkins: "jr_owned_skins",
  ownedMaps: "jr_owned_maps",
  skin: "jr_skin",
  map: "jr_map",
  quests: "jr_quests_v2",
  totalDistance: "jr_rank_score_v1",
  dailyRewards: "jr_daily_rewards_v1",
};

// ===== 30-day login rewards =====
type DailyReward =
  | { type: "coins"; amount: number }
  | { type: "skin"; id: string; name: string }
  | { type: "map"; id: string; name: string };

const DAILY_REWARDS: DailyReward[] = [
  { type: "coins", amount: 50 },
  { type: "coins", amount: 75 },
  { type: "coins", amount: 100 },
  { type: "coins", amount: 150 },
  { type: "skin", id: "bee", name: "Пчёлка" },
  { type: "coins", amount: 100 },
  { type: "map", id: "nebula", name: "Туманность" },
  { type: "coins", amount: 150 },
  { type: "coins", amount: 200 },
  { type: "skin", id: "frog", name: "Лягушка" },
  { type: "coins", amount: 150 },
  { type: "coins", amount: 200 },
  { type: "map", id: "sunset", name: "Закат" },
  { type: "coins", amount: 250 },
  { type: "skin", id: "racer", name: "Гонщик" },
  { type: "coins", amount: 200 },
  { type: "coins", amount: 250 },
  { type: "map", id: "ocean", name: "Океан" },
  { type: "coins", amount: 300 },
  { type: "skin", id: "shark", name: "Акула" },
  { type: "coins", amount: 250 },
  { type: "coins", amount: 300 },
  { type: "map", id: "aurora", name: "Северное Сияние" },
  { type: "coins", amount: 350 },
  { type: "skin", id: "unicorn", name: "Единорог" },
  { type: "coins", amount: 300 },
  { type: "coins", amount: 400 },
  { type: "map", id: "galaxy", name: "Галактика" },
  { type: "coins", amount: 500 },
  { type: "skin", id: "rainbow", name: "Радуга" },
];

interface DailyRewardState {
  lastClaim: string | null; // "YYYY-MM-DD"
  day: number; // 1..30, current day to claim next
}

// ===== Rank system =====
interface RankDef {
  name: string;
  emoji: string;
  threshold: number;
  color: string;
}
const RANKS: RankDef[] = [
  { name: "Курсант", emoji: "🎖️", threshold: 0, color: "#a0a0a0" },
  { name: "Новичок", emoji: "🌱", threshold: 200, color: "#7ec850" },
  { name: "Пилот", emoji: "✈️", threshold: 1000, color: "#4aa8ff" },
  { name: "Капитан", emoji: "⭐", threshold: 3000, color: "#ffd700" },
  { name: "Ас", emoji: "🏆", threshold: 8000, color: "#ff7b2e" },
  { name: "Элита", emoji: "💎", threshold: 20000, color: "#b76eff" },
  { name: "Легенда", emoji: "👑", threshold: 50000, color: "#ff3a3a" },
  { name: "Мифический", emoji: "🔥", threshold: 120000, color: "#ff1493" },
];
function getRank(totalDistance: number): { current: RankDef; next: RankDef | null; progress: number } {
  let current = RANKS[0];
  let next: RankDef | null = RANKS[1] ?? null;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (totalDistance >= RANKS[i].threshold) {
      current = RANKS[i];
      next = RANKS[i + 1] ?? null;
      break;
    }
  }
  if (!next) return { current, next: null, progress: 100 };
  const range = next.threshold - current.threshold;
  const earned = totalDistance - current.threshold;
  const progress = Math.min(100, Math.floor((earned / range) * 100));
  return { current, next, progress };
}

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
  const hard = pick(HARD_QUESTS, 2);
  const easy = pick(EASY_QUESTS, 3);
  return [...hard, ...easy].map((def) => ({ def, progress: 0, claimed: false }));
}
function loadQuests(): QuestState {
  const today = todayStr();
  const saved = loadJSON<QuestState | null>(LS.quests, null);
  if (saved && saved.date === today && saved.quests?.length === 5) return saved;
  return { date: today, quests: pickDailyQuests(today) };
}

async function fetchQuestsFromDB(userId: string): Promise<QuestState | null> {
  const today = todayStr();
  const { data, error } = await supabase
    .from("daily_quests")
    .select("quest_date, quests")
    .eq("user_id", userId)
    .eq("quest_date", today)
    .maybeSingle();
  if (error || !data) return null;
  const quests = data.quests as unknown as QuestState["quests"];
  if (!Array.isArray(quests) || quests.length !== 5) return null;
  return { date: today, quests };
}

async function saveQuestsToDB(userId: string, qs: QuestState): Promise<void> {
  await supabase
    .from("daily_quests")
    .upsert(
      { user_id: userId, quest_date: qs.date, quests: qs.quests as never },
      { onConflict: "user_id,quest_date" },
    );
}

interface ShopProgress {
  wallet: number;
  ownedSkins: string[];
  ownedMaps: string[];
  selectedSkin: string;
  selectedMap: string;
}

async function fetchShopFromDB(userId: string): Promise<ShopProgress | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("wallet, owned_skins, owned_maps, selected_skin, selected_map")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    wallet: data.wallet ?? 0,
    ownedSkins: (data.owned_skins as string[]) ?? ["classic"],
    ownedMaps: (data.owned_maps as string[]) ?? ["space"],
    selectedSkin: data.selected_skin ?? "classic",
    selectedMap: data.selected_map ?? "space",
  };
}

async function saveShopToDB(userId: string, p: Partial<ShopProgress>): Promise<void> {
  const payload: {
    wallet?: number;
    owned_skins?: string[];
    owned_maps?: string[];
    selected_skin?: string;
    selected_map?: string;
  } = {};
  if (p.wallet !== undefined) payload.wallet = p.wallet;
  if (p.ownedSkins !== undefined) payload.owned_skins = p.ownedSkins;
  if (p.ownedMaps !== undefined) payload.owned_maps = p.ownedMaps;
  if (p.selectedSkin !== undefined) payload.selected_skin = p.selectedSkin;
  if (p.selectedMap !== undefined) payload.selected_map = p.selectedMap;
  if (Object.keys(payload).length === 0) return;
  await supabase.from("profiles").update(payload).eq("user_id", userId);
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
  const MAX_SPEED = 5.0;
  const PLAYER_SPEED = 2.35;
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
  emoji?: string;
  trailColor?: string;
  spin?: number;
}

// Projectile per world. If emoji is set, missile renders as that emoji.
const PROJECTILE_BY_MAP: Record<string, { emoji?: string; trailColor?: string }> = {
  space: {}, // default rocket
  nebula: { emoji: "🔮", trailColor: "255,160,240" },
  mars: { emoji: "🪨", trailColor: "200,120,80" },
  ice: { emoji: "❄️", trailColor: "180,230,255" },
  blackhole: { emoji: "🕳️", trailColor: "180,80,255" },
  sunset: { emoji: "🍊", trailColor: "255,180,80" },
  ocean: { emoji: "🐟", trailColor: "120,220,255" },
  jungle: { emoji: "🍌", trailColor: "240,230,80" },
  candy: { emoji: "🍬", trailColor: "255,180,220" },
  lava: { emoji: "🔥", trailColor: "255,120,40" },
  aurora: { emoji: "⭐", trailColor: "180,255,220" },
  galaxy: { emoji: "☄️", trailColor: "255,200,255" },
  matrix: { emoji: "🟢", trailColor: "80,255,120" },
  cherry: { emoji: "🌸", trailColor: "255,200,230" },
  otherworld: { emoji: "💩", trailColor: "160,100,60" },
  chernobyl: { emoji: "☢️", trailColor: "200,255,80" },
};
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
  kind?: number; // 0+ = planet variant, undefined = tiny star
}
interface Coin {
  x: number;
  y: number;
  t: number;
}
interface AiBuddy {
  x: number;
  y: number;
  vy: number;
  targetY: number;
  mood: "scan" | "coin" | "danger";
  message: string;
  messageTimer: number;
  faceTimer: number;
  coinCooldown: number;
  warningCooldown: number;
  shieldCooldown: number;
  shieldPulse: number;
}

function Game() {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<GameState>("menu");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [hud, setHud] = useState({ shield: 0, slowmo: 0, boost: 0, buddyShield: 0 });
  const [coins, setCoins] = useState(0);
  const [bestCoins, setBestCoins] = useState(0);
  const [reviveLeft, setReviveLeft] = useState(REVIVE_SECONDS);
  const usedRevive = useRef(false);
  const [wallet, setWallet] = useState(0);
  const walletRef = useRef(0);
  walletRef.current = wallet;
  const [ownedSkins, setOwnedSkins] = useState<string[]>(["classic"]);
  const [ownedMaps, setOwnedMaps] = useState<string[]>(["space"]);
  const [skinId, setSkinId] = useState<string>("classic");
  const [mapId, setMapId] = useState<string>("space");
  const [shopTab, setShopTab] = useState<null | "skins" | "maps" | "vehicles">(null);
  const [questsOpen, setQuestsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [dailyRewards, setDailyRewards] = useState<DailyRewardState>({ lastClaim: null, day: 1 });
  const [rewardToast, setRewardToast] = useState<string | null>(null);
  const [questState, setQuestState] = useState<QuestState>({ date: todayStr(), quests: [] });
  const [totalDistance, setTotalDistance] = useState(0);
  const totalCoinsRef = useRef(0);
  const skinRef = useRef<Skin>(SKINS[0]);
  const mapRef = useRef<MapTheme>(MAPS[0]);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const [resumeCountdown, setResumeCountdown] = useState<number | null>(null);
  const [playIrisClosing, setPlayIrisClosing] = useState(false);
  const [briefingTakeoff, setBriefingTakeoff] = useState(false);
  const [noseControl, setNoseControl] = useState(false);
  const [noseControlStatus, setNoseControlStatus] = useState<string | null>(null);
  const [noseControlOffset, setNoseControlOffset] = useState(0);

  const stateRef = useRef(state);
  stateRef.current = state;
  const aliveRef = useRef(true);
  aliveRef.current = state !== "over" && state !== "choice";


  // Hydrate persistent shop data from localStorage on mount
  useEffect(() => {
    setWallet(loadJSON<number>(LS.wallet, 0));
    setOwnedSkins(loadJSON<string[]>(LS.ownedSkins, ["classic"]));
    setOwnedMaps(loadJSON<string[]>(LS.ownedMaps, ["space"]));
    setSkinId(loadJSON<string>(LS.skin, "classic"));
    setMapId(loadJSON<string>(LS.map, "space"));
    setQuestState(loadQuests());
    setTotalDistance(loadJSON<number>(LS.totalDistance, 0));
    setDailyRewards(loadJSON<DailyRewardState>(LS.dailyRewards, { lastClaim: null, day: 1 }));
  }, []);

  const canClaimDaily = dailyRewards.lastClaim !== todayStr();

  const claimDailyReward = () => {
    if (!canClaimDaily) return;
    const reward = DAILY_REWARDS[(dailyRewards.day - 1) % 30];
    let msg = "";
    if (reward.type === "coins") {
      setWallet((w) => {
        const nw = w + reward.amount;
        saveJSON(LS.wallet, nw);
        return nw;
      });
      msg = `+${reward.amount} монет!`;
    } else if (reward.type === "skin") {
      setOwnedSkins((prev) => {
        if (prev.includes(reward.id)) return prev;
        const next = [...prev, reward.id];
        saveJSON(LS.ownedSkins, next);
        return next;
      });
      msg = `Новый скин: ${reward.name}!`;
    } else if (reward.type === "map") {
      setOwnedMaps((prev) => {
        if (prev.includes(reward.id)) return prev;
        const next = [...prev, reward.id];
        saveJSON(LS.ownedMaps, next);
        return next;
      });
      msg = `Новая карта: ${reward.name}!`;
    }
    const nextDay = dailyRewards.day >= 30 ? 1 : dailyRewards.day + 1;
    const next: DailyRewardState = { lastClaim: todayStr(), day: nextDay };
    setDailyRewards(next);
    saveJSON(LS.dailyRewards, next);
    setRewardToast(msg);
    setTimeout(() => setRewardToast(null), 2400);
  };

  // Sync quests with database when user is signed in
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const remote = await fetchQuestsFromDB(user.id);
      if (cancelled) return;
      if (remote) {
        setQuestState(remote);
        saveJSON(LS.quests, remote);
      } else {
        // No DB record for today — push the local/fresh one up
        const local = loadQuests();
        setQuestState(local);
        saveJSON(LS.quests, local);
        await saveQuestsToDB(user.id, local).catch((e) => console.warn("save quests failed", e));
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Sync shop progress (wallet, owned skins/maps, selection) with DB on sign-in.
  // Remote is the source of truth; if remote is missing fields, push local up.
  const shopHydrated = useRef(false);
  useEffect(() => {
    if (!user) { shopHydrated.current = false; return; }
    let cancelled = false;
    (async () => {
      const remote = await fetchShopFromDB(user.id);
      if (cancelled) return;
      if (remote) {
        // Merge: union owned lists, take max wallet, prefer remote selection
        const localWallet = loadJSON<number>(LS.wallet, 0);
        const localSkins = loadJSON<string[]>(LS.ownedSkins, ["classic"]);
        const localMaps = loadJSON<string[]>(LS.ownedMaps, ["space"]);
        const mergedSkins = Array.from(new Set([...remote.ownedSkins, ...localSkins]));
        const mergedMaps = Array.from(new Set([...remote.ownedMaps, ...localMaps]));
        const mergedWallet = Math.max(remote.wallet, localWallet);
        setWallet(mergedWallet);
        setOwnedSkins(mergedSkins);
        setOwnedMaps(mergedMaps);
        setSkinId(remote.selectedSkin);
        setMapId(remote.selectedMap);
        saveJSON(LS.wallet, mergedWallet);
        saveJSON(LS.ownedSkins, mergedSkins);
        saveJSON(LS.ownedMaps, mergedMaps);
        saveJSON(LS.skin, remote.selectedSkin);
        saveJSON(LS.map, remote.selectedMap);
        // Push merged state back so other devices catch up
        await saveShopToDB(user.id, {
          wallet: mergedWallet,
          ownedSkins: mergedSkins,
          ownedMaps: mergedMaps,
        }).catch((e) => console.warn("save shop failed", e));
      }
      shopHydrated.current = true;
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Rank progress is tracked locally per device — not synced from DB

  // Keep render refs in sync with current selection
  useEffect(() => {
    skinRef.current = SKINS.find((s) => s.id === skinId) ?? SKINS[0];
    saveJSON(LS.skin, skinId);
    if (user && shopHydrated.current) {
      saveShopToDB(user.id, { selectedSkin: skinId }).catch((e) => console.warn("save skin failed", e));
    }
  }, [skinId, user]);
  useEffect(() => {
    mapRef.current = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
    saveJSON(LS.map, mapId);
    if (user && shopHydrated.current) {
      saveShopToDB(user.id, { selectedMap: mapId }).catch((e) => console.warn("save map failed", e));
    }
  }, [mapId, user]);


  const keys = useRef({ up: false, down: false });
  const planeY = useRef(H / 2);
  const planeVy = useRef(0);
  const planeTilt = useRef(0);
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
  const aiBuddy = useRef<AiBuddy>({
    x: PLANE_X + 112,
    y: H / 2 - 34,
    vy: 0,
    targetY: H / 2 - 34,
    mood: "scan",
    message: "",
    messageTimer: 0,
    faceTimer: 0,
    coinCooldown: 0,
    warningCooldown: 0,
    shieldCooldown: 0,
    shieldPulse: 0,
  });
  const aiLinePending = useRef(false);
  const nextAiLineAt = useRef(0);
  const particles = useRef<Particle[]>([]);
  const stars = useRef<Star[]>([]);
  const shield = useRef(0); // frames remaining
  const usedBuddyShield = useRef(false);
  const slowmo = useRef(0); // frames remaining
  const boost = useRef(0); // frames remaining
  const shake = useRef(0);
  const flash = useRef(0);
  const tick = useRef(0);
  const speedLines = useRef<{ x: number; y: number; len: number; spd: number }[]>([]);
  type PortalKind = "other" | "normal" | "chernobyl";
  type PortalEntity = { worldX: number; anchor: "top" | "bottom"; kind: PortalKind; entered: boolean };
  const portals = useRef<PortalEntity[]>([]);
  const nextPortalScore = useRef(800);
  // ===== Rare events (visual flair, non-colliding) =====
  type RareEventKind = "star" | "asteroids" | "wreck" | "chase";
  type RareEvent = { kind: RareEventKind; t: number; duration: number; seed: number };
  const rareEvent = useRef<RareEvent | null>(null);
  const rareCooldown = useRef(900); // frames until first possible event

  const showAiBuddyLine = useCallback(
    (event: "danger" | "narrow" | "shield" | "coin" | "revive" | "start", fallback: string) => {
      const buddy = aiBuddy.current;
      const now = Date.now();
      const urgent = event === "shield" || event === "revive";
      const warning = event === "danger" || event === "narrow";

      if (!urgent && !warning && now < nextAiLineAt.current) return;
      if (warning && now < nextAiLineAt.current - 2_000) return;

      buddy.message = fallback;
      buddy.messageTimer = urgent ? 120 : warning ? 130 : 90;
      buddy.faceTimer = Math.max(buddy.faceTimer, urgent ? 36 : warning ? 28 : 18);
      nextAiLineAt.current = now + (urgent ? 8_000 : warning ? 5_500 : 18_000);

      if (aiLinePending.current || (!urgent && !warning && Math.random() < 0.35)) return;

      aiLinePending.current = true;

      getAiBuddyLine({
        data: {
          event,
          score: Math.floor(distance.current / 10),
          coins: coinCount.current,
          mapName: mapRef.current.name,
        },
      })
        .then((result) => {
          if (stateRef.current !== "playing") return;
          const freshBuddy = aiBuddy.current;
          freshBuddy.message = result.line;
          freshBuddy.messageTimer = urgent ? 130 : warning ? 140 : 100;
          freshBuddy.faceTimer = Math.max(freshBuddy.faceTimer, urgent ? 34 : warning ? 26 : 18);
        })
        .catch((error) => {
          console.warn("Gemini buddy line failed", error);
        })
        .finally(() => {
          aiLinePending.current = false;
        });
    },
    [],
  );

  // ===== Boss =====
  type BossPhase = "enter" | "shoot" | "rest" | "die";
  type Boss = {
    x: number; y: number; vy: number;
    hp: number; maxHp: number;
    phase: BossPhase; t: number; shotTimer: number; phaseTimer: number;
    fallVy: number; rot: number;
  };
  type BigMissile = { x: number; y: number; vx: number; vy: number; r: number; t: number };
  type PlayerRocket = { x: number; y: number; vx: number; t: number };
  const boss = useRef<Boss | null>(null);
  const bigMissiles = useRef<BigMissile[]>([]);
  const playerRockets = useRef<PlayerRocket[]>([]);
  const nextBossScore = useRef(5000);
  const bossHitCd = useRef(0); // i-frames after ramming boss
  
  const speedBoostStartScore = useRef<number | null>(null);
  const rocketCdRef = useRef(0); // frames until next player rocket available
  const rocketHudPrev = useRef(0);

  const [bossHud, setBossHud] = useState<{ hp: number; max: number } | null>(null);
  const [rocketHud, setRocketHud] = useState<number>(0); // seconds remaining

  const resetControls = useCallback(() => {
    keys.current = { up: false, down: false };
  }, []);

  
  
  const portalY = (p: PortalEntity) => {
    const px = p.worldX - distance.current;
    const i = Math.floor((px + offset.current) / SEG_W);
    const seg = segments.current[i] ?? segments.current[Math.max(0, Math.min(segments.current.length - 1, i))];
    if (!seg) return H / 2;
    // place the horizontal tunnel so its outer edge touches the canyon wall
    const tunnelRadius = 36;
    return p.anchor === "top" ? seg.topH + tunnelRadius : H - seg.botH - tunnelRadius;
  };

  // ===== Sound engine (WebAudio) =====
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const engineRef = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const faceVideoRef = useRef<HTMLVideoElement | null>(null);
  const faceStreamRef = useRef<MediaStream | null>(null);
  const faceDetectorRef = useRef<BrowserFaceDetector | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const noseBaselineY = useRef<number | null>(null);
  const lastNoseHudUpdate = useRef(0);

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

  const playMusic = useCallback(() => {
    const a = musicRef.current;
    if (!a || mutedRef.current) return;
    a.volume = 0.45;
    a.loop = true;
    a.play().catch(() => {});
  }, []);

  const stopMusic = useCallback((reset = false) => {
    const a = musicRef.current;
    if (!a) return;
    a.pause();
    if (reset) a.currentTime = 0;
  }, []);

  const stopNoseControl = useCallback(() => {
    faceStreamRef.current?.getTracks().forEach((track) => track.stop());
    faceStreamRef.current = null;
    if (faceVideoRef.current) faceVideoRef.current.srcObject = null;
    faceDetectorRef.current = null;
    faceLandmarkerRef.current?.close();
    faceLandmarkerRef.current = null;
    noseBaselineY.current = null;
    keys.current.up = false;
    keys.current.down = false;
    setNoseControl(false);
    setNoseControlStatus(null);
    setNoseControlOffset(0);
  }, []);

  const startNoseControl = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNoseControlStatus("Камера не поддерживается");
      return false;
    }
    const Detector = (window as FaceDetectorWindow).FaceDetector;
    if (!Detector) {
      setNoseControlStatus("Захват лица не поддерживается в этом браузере");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
        audio: false,
      });
      faceStreamRef.current?.getTracks().forEach((track) => track.stop());
      faceStreamRef.current = stream;
      const video = faceVideoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      faceDetectorRef.current = new Detector({ fastMode: true, maxDetectedFaces: 1 });
      noseBaselineY.current = null;
      setNoseControl(true);
      setNoseControlStatus("Лицо ищется");
      return true;
    } catch {
      setNoseControlStatus("Камера не разрешена");
      return false;
    }
  }, []);


  const startMediaPipeNoseControl = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNoseControlStatus("Камера не поддерживается");
      return false;
    }

    try {
      setNoseControlStatus("Запускаю камеру");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
        audio: false,
      });
      faceStreamRef.current?.getTracks().forEach((track) => track.stop());
      faceStreamRef.current = stream;
      const video = faceVideoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }

      setNoseControlStatus("Загружаю захват лица");
      const fileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
      );
      faceLandmarkerRef.current?.close();
      faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
      });

      faceDetectorRef.current = {
        async detect(source: CanvasImageSource) {
          const video = source as HTMLVideoElement;
          const landmarker = faceLandmarkerRef.current;
          if (!landmarker || !video.videoWidth || !video.videoHeight) return [];
          const result = landmarker.detectForVideo(video, performance.now());
          const landmarks = result.faceLandmarks[0];
          if (!landmarks?.length) return [];
          const nose = landmarks[1] ?? landmarks[4];
          const top = landmarks[10] ?? landmarks[151] ?? nose;
          const bottom = landmarks[152] ?? landmarks[199] ?? nose;
          const height = Math.max(90, Math.abs(bottom.y - top.y) * video.videoHeight);
          const y = nose.y * video.videoHeight - height * 0.58;
          return [{ boundingBox: { y, height } as DOMRectReadOnly }];
        },
      };
      noseBaselineY.current = null;
      setNoseControl(true);
      setNoseControlStatus("Лицо ищется");
      return true;
    } catch (error) {
      console.warn("MediaPipe face capture failed", error);
      setNoseControlStatus("Камера или модель лица не запустилась");
      return false;
    }
  }, []);

  const resetWorld = useCallback(() => {
    resetControls();
    planeY.current = H / 2;
    planeVy.current = 0;
    planeTilt.current = 0;
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
    aiBuddy.current = {
      x: PLANE_X + 112,
      y: H / 2 - 34,
      vy: 0,
      targetY: H / 2 - 34,
      mood: "scan",
      message: "",
      messageTimer: 0,
      faceTimer: 0,
      coinCooldown: 0,
      warningCooldown: 0,
      shieldCooldown: 0,
      shieldPulse: 0,
    };
    particles.current = [];
    shield.current = 0;
    usedBuddyShield.current = false;
    slowmo.current = 0;
    boost.current = 0;
    shake.current = 0;
    flash.current = 0;
    portals.current = [];
    nextPortalScore.current = 800;
    rareEvent.current = null;
    rareCooldown.current = 900;
    boss.current = null;
    bigMissiles.current = [];
    playerRockets.current = [];
    nextBossScore.current = 5000;
    bossHitCd.current = 0;
    rocketCdRef.current = 0;
    speedBoostStartScore.current = null;
    setBossHud(null);
    setRocketHud(0);

    mapRef.current = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
    usedRevive.current = false;
    const count = Math.ceil(W / SEG_W) + 2;
    const gap = 280;
    const center = H / 2;
    for (let i = 0; i < count; i++) {
      segments.current.push({ topH: center - gap / 2, botH: H - (center + gap / 2) });
    }
    stars.current = [
      { x: W * 0.78, y: H * 0.18, z: 0.18, s: 90, kind: 0 },  // ringed gas giant
      { x: W * 0.35, y: H * 0.12, z: 0.22, s: 55, kind: 1 },  // red/mars planet
      { x: W * 0.55, y: H * 0.28, z: 0.28, s: 38, kind: 2 },  // blue earth-like
      { x: W * 0.1,  y: H * 0.22, z: 0.15, s: 28, kind: 3 },  // small moon
    ];
    setScore(0);
    setCoins(0);
    setHud({ shield: 0, slowmo: 0, boost: 0, buddyShield: 0 });
  }, [mapId, resetControls]);

  const start = useCallback(() => {
    resetControls();
    resetWorld();
    ensureAudio();
    if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
    startEngine();
    playMusic();
    setState("playing");
  }, [resetControls, resetWorld, ensureAudio, startEngine, playMusic]);

  const openBriefing = useCallback(() => {
    if (playIrisClosing) return;
    resetControls();
    setBriefingTakeoff(false);
    setStatsOpen(false);
    setSettingsOpen(false);
    setShopTab(null);
    setQuestsOpen(false);
    setRewardsOpen(false);
    setPlayIrisClosing(true);
    window.setTimeout(() => {
      setState("briefing");
      setPlayIrisClosing(false);
    }, 520);
  }, [playIrisClosing, resetControls]);

  const openNormalBriefing = useCallback(() => {
    stopNoseControl();
    openBriefing();
  }, [stopNoseControl, openBriefing]);

  const openNoseBriefing = useCallback(async () => {
    const ready = await startMediaPipeNoseControl();
    if (ready) openBriefing();
  }, [startMediaPipeNoseControl, openBriefing]);

  const launchFromBriefing = useCallback(() => {
    if (playIrisClosing || briefingTakeoff) return;
    resetControls();
    setBriefingTakeoff(true);
    window.setTimeout(() => {
      setPlayIrisClosing(true);
      window.setTimeout(() => {
        start();
        setBriefingTakeoff(false);
        setPlayIrisClosing(false);
      }, 520);
    }, 880);
  }, [playIrisClosing, briefingTakeoff, resetControls, start]);

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
        if (stateRef.current === "menu") openNormalBriefing();
        else if (stateRef.current === "briefing") launchFromBriefing();
        else if (stateRef.current !== "playing") start();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") keys.current.up = false;
      if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") keys.current.down = false;
    };
    const clearReleasedPointers = () => resetControls();
    const onVisibility = () => {
      if (document.hidden) resetControls();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("mouseup", clearReleasedPointers);
    window.addEventListener("touchend", clearReleasedPointers);
    window.addEventListener("touchcancel", clearReleasedPointers);
    window.addEventListener("blur", clearReleasedPointers);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("mouseup", clearReleasedPointers);
      window.removeEventListener("touchend", clearReleasedPointers);
      window.removeEventListener("touchcancel", clearReleasedPointers);
      window.removeEventListener("blur", clearReleasedPointers);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [resetControls, start, openNormalBriefing, launchFromBriefing]);

  useEffect(() => {
    if (!noseControl) return;
    let cancelled = false;
    let raf = 0;

    const detectFace = async () => {
      if (cancelled) return;
      const video = faceVideoRef.current;
      const detector = faceDetectorRef.current;
      const playing = stateRef.current === "playing";

      if (!video || !detector || video.readyState < 2) {
        raf = requestAnimationFrame(detectFace);
        return;
      }

      try {
        const faces = await detector.detect(video);
        const face = faces[0];
        if (!face) {
          if (playing) {
            keys.current.up = false;
            keys.current.down = false;
          }
          const now = performance.now();
          if (now - lastNoseHudUpdate.current > 350) {
            lastNoseHudUpdate.current = now;
            setNoseControlStatus("Лицо не найдено");
            setNoseControlOffset(0);
          }
        } else {
          const box = face.boundingBox;
          const noseY = box.y + box.height * 0.58;
          if (noseBaselineY.current == null || !playing) {
            noseBaselineY.current = noseY;
          }
          const delta = (noseY - noseBaselineY.current) / Math.max(90, box.height);
          const deadZone = 0.075;
          keys.current.down = playing && delta > deadZone;
          keys.current.up = playing && delta < -deadZone;
          if (!playing) {
            keys.current.down = false;
            keys.current.up = false;
          }

          const now = performance.now();
          if (now - lastNoseHudUpdate.current > 120) {
            lastNoseHudUpdate.current = now;
            setNoseControlStatus("Лицо захвачено");
            setNoseControlOffset(Math.max(-1, Math.min(1, delta * 3.5)));
          }
        }
      } catch {
        setNoseControlStatus("Ошибка захвата лица");
      }

      raf = requestAnimationFrame(detectFace);
    };

    raf = requestAnimationFrame(detectFace);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      keys.current.up = false;
      keys.current.down = false;
    };
  }, [noseControl]);

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
    resetControls();
    const d = Math.floor(distance.current / 10);
    setScore(d);
    setBest((b) => Math.max(b, d));
    setBestCoins((b) => Math.max(b, coinCount.current));
    const runCoins = coinCount.current;
    totalCoinsRef.current += runCoins;
    const runDistance = Math.floor(distance.current);
    // Update rank progress locally using score units (distance / 10)
    setTotalDistance((td) => {
      const newTotal = td + d;
      saveJSON(LS.totalDistance, newTotal);
      return newTotal;
    });
    // Save run stats to the user's profile if signed in
    if (user) {
      (async () => {
        const { data: existing } = await supabase
          .from("profiles")
          .select("high_score, total_distance, games_played")
          .eq("user_id", user.id)
          .maybeSingle();
        const newHigh = Math.max(existing?.high_score ?? 0, d);
        const newTotal = (existing?.total_distance ?? 0) + runDistance;
        const newGames = (existing?.games_played ?? 0) + 1;
        await supabase
          .from("profiles")
          .update({
            high_score: newHigh,
            total_distance: newTotal,
            games_played: newGames,
            wallet: walletRef.current,
          })
          .eq("user_id", user.id);
      })().catch((e) => console.warn("save stats failed", e));
    }
    setQuestState((qs) => {
      const today = todayStr();
      let next: QuestState;
      if (qs.date !== today) {
        next = { date: today, quests: pickDailyQuests(today) };
      } else {
        next = {
          ...qs,
          quests: qs.quests.map((q) => {
            if (q.claimed) return q;
            let inc = 0;
            if (q.def.metric === "runCoins") inc = runCoins >= q.def.target ? q.def.target : 0;
            else if (q.def.metric === "runScore") inc = d >= q.def.target ? q.def.target : 0;
            else if (q.def.metric === "games") inc = q.progress + 1;
            else if (q.def.metric === "totalCoins") inc = q.progress + runCoins;
            return { ...q, progress: Math.min(q.def.target, inc) };
          }),
        };
      }
      saveJSON(LS.quests, next);
      if (user) saveQuestsToDB(user.id, next).catch((e) => console.warn("save quests failed", e));
      return next;
    });
    setState(nextState);
  }, [resetControls, user]);

  const claimQuest = useCallback((id: string) => {
    setQuestState((qs) => {
      const q = qs.quests.find((x) => x.def.id === id);
      if (!q || q.claimed || q.progress < q.def.target) return qs;
      const next = {
        ...qs,
        quests: qs.quests.map((x) => (x.def.id === id ? { ...x, claimed: true } : x)),
      };
      saveJSON(LS.quests, next);
      if (user) saveQuestsToDB(user.id, next).catch((e) => console.warn("save quests failed", e));
      setWallet((w) => {
        const nw = w + q.def.reward;
        saveJSON(LS.wallet, nw);
        if (user) saveShopToDB(user.id, { wallet: nw }).catch((e) => console.warn("save wallet failed", e));
        return nw;
      });
      return next;
    });
  }, [user]);


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
      if (user) {
        saveShopToDB(user.id, {
          wallet: nextWallet,
          ownedSkins: nextOwned,
          selectedSkin: s.id,
        }).catch((e) => console.warn("save skin purchase failed", e));
      }
    },
    [ownedSkins, wallet, user],
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
      if (user) {
        saveShopToDB(user.id, {
          wallet: nextWallet,
          ownedMaps: nextOwned,
          selectedMap: m.id,
        }).catch((e) => console.warn("save map purchase failed", e));
      }
    },
    [ownedMaps, wallet, user],
  );


  const die = useCallback(() => {
    resetControls();
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
  }, [resetControls, sfxHit, stopEngine, finalizeOver]);

  const revive = useCallback(() => {
    if (walletRef.current < REVIVE_COST) return;
    resetControls();
    const next = walletRef.current - REVIVE_COST;
    setWallet(next);
    saveJSON(LS.wallet, next);
    if (user) saveShopToDB(user.id, { wallet: next }).catch((e) => console.warn("save wallet failed", e));
    usedRevive.current = true;
    // clear nearby threats
    missiles.current = [];
    missileTimer.current = 180;
    particles.current = [];
    // re-center plane & grant temporary shield
    planeY.current = H / 2;
    planeVy.current = 0;
    shield.current = 25 * 60;
    shake.current = 0;
    flash.current = 8;
    ensureAudio();
    if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
    startEngine();
    playMusic();
    setHud((h) => ({ ...h, shield: 25 * 60 }));
    setState("playing");
  }, [resetControls, ensureAudio, startEngine, playMusic, user]);

  const pauseGame = useCallback(() => {
    if (stateRef.current !== "playing") return;
    resetControls();
    stopEngine();
    setState("paused");
  }, [resetControls, stopEngine]);

  const resumeGame = useCallback(() => {
    if (stateRef.current !== "paused") return;
    resetControls();
    setResumeCountdown(3);
    let n = 3;
    const tickDown = () => {
      n -= 1;
      if (n <= 0) {
        setResumeCountdown(null);
        ensureAudio();
        if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
        startEngine();
        playMusic();
        setState("playing");
      } else {
        setResumeCountdown(n);
        setTimeout(tickDown, 1000);
      }
    };
    setTimeout(tickDown, 1000);
  }, [resetControls, ensureAudio, startEngine, playMusic]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const loop = () => {
      tick.current++;
      const playing = stateRef.current === "playing";

      if (playing) {
        // smooth vertical control: slow acceleration, low max speed, soft tilt
        const target = (keys.current.down ? 1 : 0) - (keys.current.up ? 1 : 0);
        planeVy.current += target * 0.3;
        planeVy.current *= target === 0 ? 0.9 : 0.94;
        const verticalStep = clamp(planeVy.current, -PLAYER_SPEED, PLAYER_SPEED);
        planeY.current += verticalStep * 0.82;
        const targetTilt = clamp(verticalStep * 0.085, -0.22, 0.22);
        planeTilt.current += (targetTilt - planeTilt.current) * 0.065;

        // time scale: slowmo halves, boost speeds up
        const timeScale =
          (slowmo.current > 0 ? 0.5 : 1) * (boost.current > 0 ? 2.5 : 1);
        const curScoreNow = Math.floor(distance.current / 10);
        const startS = speedBoostStartScore.current;
        const boostScore = startS == null ? 0 : Math.min(4000, Math.max(0, curScoreNow - startS));
        const speedMult = 1 + (boostScore / 20) * 0.6;
        const baseSpeed = Math.min(MAX_SPEED, BASE_SPEED + (boostScore * 10) / 6000);
        const speed = baseSpeed * timeScale * speedMult;
        const activateBuddyShield = (message: string) => {
          const buddy = aiBuddy.current;
          if (shield.current > 0 || usedBuddyShield.current) return false;
          usedBuddyShield.current = true;
          shield.current = 4 * 60;
          buddy.shieldCooldown = 0;
          buddy.shieldPulse = 42;
          buddy.mood = "danger";
          showAiBuddyLine("shield", message);
          buddy.warningCooldown = Math.max(buddy.warningCooldown, 260);
          shake.current = Math.max(shake.current, 9);
          flash.current = Math.max(flash.current, 7);
          for (let k = 0; k < 24; k++) {
            const a = Math.random() * Math.PI * 2;
            particles.current.push({
              x: PLANE_X,
              y: planeY.current,
              vx: Math.cos(a) * 3.4,
              vy: Math.sin(a) * 3.4,
              life: 34,
              maxLife: 34,
              color: k % 2 === 0 ? "#7df9ff" : "#ffffff",
              size: 2.2,
            });
          }
          sfxPower();
          return true;
        };

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
        if (missileTimer.current <= 0 && boost.current <= 0 && !boss.current) {
          const rightIdx = segments.current.length - 2;
          const segR = segments.current[rightIdx];
          const topY = segR ? segR.topH + 12 : 30;
          const botY = segR ? H - segR.botH - 12 : H - 30;
          const spawnY = topY + Math.random() * Math.max(20, botY - topY);
          const spawnX = W + 20;
          const targetY = planeY.current + (Math.random() - 0.5) * 70;
          const sp = (5 + difficultyFor() * 3.5 + Math.random() * 1.5) * 0.40;
          const dx = -W;
          const dy = targetY - spawnY;
          const dist = Math.hypot(dx, dy);
          const proj = PROJECTILE_BY_MAP[mapRef.current.id] ?? {};
          missiles.current.push({
            x: spawnX,
            y: spawnY,
            vx: (dx / dist) * sp,
            vy: (dy / dist) * sp,
            trail: [],
            emoji: proj.emoji,
            trailColor: proj.trailColor,
            spin: Math.random() * Math.PI * 2,
          });
          missileTimer.current = Math.max(95, 340 - difficultyFor() * 150 - Math.random() * 80);
        }

        // ===== Missile update + collision =====
        for (let i = missiles.current.length - 1; i >= 0; i--) {
          const m = missiles.current[i];
          m.trail.push({ x: m.x, y: m.y });
          if (m.trail.length > 12) m.trail.shift();
          const mSpeedMult = 1 + Math.floor(distance.current / 200) * 0.008;
          m.x += m.vx * timeScale * mSpeedMult;
          m.y += m.vy * timeScale * mSpeedMult;
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
            if (shield.current > 0) {
              shield.current = 0;
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
            } else if (!activateBuddyShield("Аварийный щит!")) {
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
            if (p.kind === "shield") shield.current = 25 * 60;
            if (p.kind === "slowmo") slowmo.current = 360;
            if (p.kind === "boost") boost.current = 300;
            flash.current = 6;
            sfxPower();
          }
        }

        // ===== Coin spawn (scattered) =====
        coinTimer.current -= 1 * timeScale;
        if (coinTimer.current <= 0) {
          const count = 1 + Math.floor(Math.random() * 5); // 1..5 coins
          const spacing = 32;
          for (let i = 0; i < count; i++) {
            const sx = W + 20 + i * spacing;
            const segIdx = Math.floor((sx + offset.current) / SEG_W);
            const seg = segments.current[segIdx];
            if (!seg) continue; // skip coins past generated terrain
            const topY = seg.topH + 26;
            const botY = H - seg.botH - 26;
            const y = topY + Math.random() * Math.max(20, botY - topY);
            coinsRef.current.push({ x: sx, y, t: Math.random() * 10 });
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

        // ===== AI buddy: calm independent scouting =====
        {
          const buddy = aiBuddy.current;
          buddy.x = PLANE_X + 118 + Math.sin(tick.current * 0.018) * 8;
          buddy.warningCooldown = Math.max(0, buddy.warningCooldown - 1);
          buddy.shieldCooldown = Math.max(0, buddy.shieldCooldown - 1);
          buddy.shieldPulse = Math.max(0, buddy.shieldPulse - 1);
          buddy.messageTimer = Math.max(0, buddy.messageTimer - 1);
          buddy.faceTimer = Math.max(0, buddy.faceTimer - 1);
          buddy.coinCooldown = Math.max(0, buddy.coinCooldown - 1);

          const segIdx = Math.floor((buddy.x + offset.current) / SEG_W);
          const seg = segments.current[segIdx];
          const topSafe = (seg?.topH ?? 40) + 38;
          const botSafe = H - (seg?.botH ?? 40) - 38;
          const safeCenter = (topSafe + botSafe) / 2;
          const soloDrift =
            Math.sin(tick.current * 0.007) * 30 +
            Math.sin(tick.current * 0.003 + 1.7) * 14;
          let targetY = clamp(safeCenter + soloDrift, topSafe, botSafe);
          let nearestThreat: { x: number; y: number; r: number } | null = null;
          let interestingCoin: Coin | null = null;

          for (const m of missiles.current) {
            if (m.x < PLANE_X - 10 || m.x > buddy.x + 220) continue;
            const futureY = m.y + m.vy * 24;
            const close = Math.abs(futureY - buddy.y) < 58 || Math.abs(futureY - planeY.current) < 64;
            if (!close) continue;
            if (!nearestThreat || m.x < nearestThreat.x) nearestThreat = { x: m.x, y: futureY, r: 58 };
          }
          for (const m of bigMissiles.current) {
            if (m.x < PLANE_X - 20 || m.x > buddy.x + 240) continue;
            if (!nearestThreat || m.x < nearestThreat.x) nearestThreat = { x: m.x, y: m.y, r: m.r + 42 };
          }
          for (const c of coinsRef.current) {
            if (c.x < buddy.x - 20 || c.x > buddy.x + 190) continue;
            if (!interestingCoin || c.x < interestingCoin.x) interestingCoin = c;
          }

          if (nearestThreat) {
            const upSpace = nearestThreat.y - topSafe;
            const downSpace = botSafe - nearestThreat.y;
            const saferY = downSpace > upSpace
              ? clamp(nearestThreat.y + nearestThreat.r, topSafe, botSafe)
              : clamp(nearestThreat.y - nearestThreat.r, topSafe, botSafe);
            targetY = targetY * 0.84 + saferY * 0.16;
            buddy.mood = "danger";
            if (buddy.warningCooldown <= 0 && nearestThreat.x < PLANE_X + 260) {
              showAiBuddyLine("danger", "Опасность впереди!");
              buddy.warningCooldown = 190;
            }
          } else {
            const aheadIdx = Math.floor((buddy.x + 135 + offset.current) / SEG_W);
            const aheadSeg = segments.current[aheadIdx];
            if (aheadSeg) {
              const aheadTop = aheadSeg.topH + 42;
              const aheadBot = H - aheadSeg.botH - 42;
              const corridor = aheadBot - aheadTop;
              if (corridor < 205 && buddy.warningCooldown <= 0) {
                showAiBuddyLine("narrow", "Узкий проход!");
                buddy.warningCooldown = 230;
              }
              targetY = clamp(targetY, aheadTop, aheadBot);
            }
            if (interestingCoin && buddy.coinCooldown <= 0) {
              targetY = targetY * 0.9 + interestingCoin.y * 0.1;
              buddy.mood = "coin";
              buddy.coinCooldown = 70;
            } else if (buddy.messageTimer <= 0) {
              buddy.mood = "scan";
            }
            if (buddy.faceTimer <= 0 && buddy.messageTimer <= 0 && Math.random() < 0.0008) {
              buddy.faceTimer = 14 + Math.floor(Math.random() * 12);
            }
          }

          buddy.targetY = targetY;
          buddy.vy += (buddy.targetY - buddy.y) * 0.006;
          buddy.vy *= 0.9;
          buddy.vy = clamp(buddy.vy, -1.15, 1.15);
          buddy.y = clamp(buddy.y + buddy.vy, topSafe, botSafe);
        }

        // ===== Rare events =====
        if (rareEvent.current) {
          rareEvent.current.t += 1;
          if (rareEvent.current.t >= rareEvent.current.duration) {
            rareEvent.current = null;
            rareCooldown.current = 1400 + Math.floor(Math.random() * 1600);
          }
        } else if (mapRef.current.id === "space") {
          rareCooldown.current -= 1;
          if (rareCooldown.current <= 0) {
            const kinds: RareEventKind[] = ["star", "asteroids", "wreck", "chase"];
            const kind = kinds[Math.floor(Math.random() * kinds.length)];
            rareEvent.current = { kind, t: 0, duration: 600, seed: Math.random() };
          }
        } else {
          // not in space map — slowly recharge
          rareCooldown.current = Math.max(600, rareCooldown.current - 1);
        }

        // ===== Boss =====
        const curScoreForBoss = Math.floor(distance.current / 10);
        if (!boss.current && curScoreForBoss >= nextBossScore.current) {
          // wipe normal missiles entering frame
          missiles.current = [];
          boss.current = {
            x: W + 220, y: H / 2, vy: 0,
            hp: 7, maxHp: 7,
            phase: "enter", t: 0, shotTimer: 90, phaseTimer: 0,
            fallVy: 0, rot: 0,
          };
          setBossHud({ hp: 7, max: 7 });
          shake.current = 14;
          // give player a rocket immediately when boss appears
          rocketCdRef.current = 0;
          setRocketHud(0);
        }

        if (bossHitCd.current > 0) bossHitCd.current--;

        // Player rockets cooldown HUD
        if (boss.current && boss.current.phase !== "die") {
          if (rocketCdRef.current > 0) rocketCdRef.current--;
          const secs = Math.ceil(rocketCdRef.current / 60);
          if (secs !== rocketHudPrev.current) {
            rocketHudPrev.current = secs;
            setRocketHud(secs);
          }
        }

        // Update player rockets
        for (let i = playerRockets.current.length - 1; i >= 0; i--) {
          const r = playerRockets.current[i];
          r.x += r.vx;
          r.t += 1;
          if (r.t % 2 === 0) {
            particles.current.push({
              x: r.x - 10, y: r.y + (Math.random() - 0.5) * 4,
              vx: -1 - Math.random() * 1.5, vy: (Math.random() - 0.5) * 0.6,
              life: 18, maxLife: 18,
              color: Math.random() < 0.5 ? "#ffd070" : "#ff8a3a",
              size: 2 + Math.random() * 1.5,
            });
          }
          if (boss.current && boss.current.phase !== "die") {
            const b2 = boss.current;
            const bw = 220, bh = 110;
            if (r.x > b2.x - bw / 2 && r.x < b2.x + bw / 2 &&
                r.y > b2.y - bh / 2 && r.y < b2.y + bh / 2) {
              b2.hp -= 1;
              setBossHud({ hp: b2.hp, max: b2.maxHp });
              shake.current = Math.max(shake.current, 12);
              flash.current = Math.max(flash.current, 8);
              for (let k = 0; k < 24; k++) {
                const a = Math.random() * Math.PI * 2;
                particles.current.push({
                  x: r.x, y: r.y,
                  vx: Math.cos(a) * (2 + Math.random() * 4),
                  vy: Math.sin(a) * (2 + Math.random() * 4),
                  life: 36, maxLife: 36,
                  color: Math.random() < 0.5 ? "#ffd070" : "#ff7a3a",
                  size: 2.4 + Math.random() * 1.6,
                });
              }
              playerRockets.current.splice(i, 1);
              if (b2.hp <= 0) {
                b2.phase = "die";
                b2.t = 0;
                b2.fallVy = -2;
                bigMissiles.current = [];
              }
              continue;
            }
          }
          if (r.x > W + 40) playerRockets.current.splice(i, 1);
        }


        if (boss.current) {
          const b = boss.current;
          b.t += 1;

          if (b.phase === "enter") {
            const targetX = W - 160;
            b.x += (targetX - b.x) * 0.04;
            b.y += (H / 2 - b.y) * 0.04;
            if (Math.abs(b.x - targetX) < 4) {
              b.phase = "shoot";
              b.phaseTimer = 0;
              b.shotTimer = 40;
            }
          } else if (b.phase === "shoot") {
            b.phaseTimer += 1;
            // slow vertical drift
            b.vy += (Math.sin(b.t * 0.04) * 0.6 - b.vy) * 0.08;
            b.y = clamp(b.y + b.vy, 110, H - 110);
            b.shotTimer -= 1;
            if (b.shotTimer <= 0) {
              const targetY = planeY.current;
              const dx = PLANE_X - (b.x - 60);
              const dy = targetY - b.y;
              const dist = Math.hypot(dx, dy);
              const sp = 3.2;
              bigMissiles.current.push({
                x: b.x - 60, y: b.y,
                vx: (dx / dist) * sp,
                vy: (dy / dist) * sp,
                r: 18, t: 0,
              });
              b.shotTimer = 75 + Math.random() * 35;
              shake.current = Math.max(shake.current, 4);
            }
            if (b.phaseTimer > 360) {
              b.phase = "rest";
              b.phaseTimer = 0;
            }
          } else if (b.phase === "rest") {
            b.phaseTimer += 1;
            // move closer to player so they can ram
            const targetX = W - 290;
            b.x += (targetX - b.x) * 0.035;
            b.y += (planeY.current - b.y) * 0.012;
            if (b.phaseTimer > 260) {
              b.phase = "shoot";
              b.phaseTimer = 0;
              b.shotTimer = 50;
            }


          } else if (b.phase === "die") {
            b.fallVy += 0.35;
            b.y += b.fallVy;
            b.rot += 0.04;
            b.x -= 1.2;
            if (b.t % 6 === 0) {
              for (let k = 0; k < 6; k++) {
                particles.current.push({
                  x: b.x + (Math.random() - 0.5) * 120,
                  y: b.y + (Math.random() - 0.5) * 60,
                  vx: (Math.random() - 0.5) * 3,
                  vy: -1 - Math.random() * 2,
                  life: 40, maxLife: 40,
                  color: Math.random() < 0.5 ? "#ff7a3a" : "#ffd070",
                  size: 3 + Math.random() * 2,
                });
              }
            }
            if (b.y > H + 120) {
              boss.current = null;
              setBossHud(null);
              bigMissiles.current = [];
              if (speedBoostStartScore.current == null) {
                speedBoostStartScore.current = Math.floor(distance.current / 10);
              }
            }
          }

          // Update big missiles
          for (let i = bigMissiles.current.length - 1; i >= 0; i--) {
            const m = bigMissiles.current[i];
            m.x += m.vx * timeScale;
            m.y += m.vy * timeScale;
            m.t += 1;
            if (m.x < -60 || m.y < -60 || m.y > H + 60) {
              bigMissiles.current.splice(i, 1);
              continue;
            }
            // smoke trail
            if (m.t % 2 === 0) {
              particles.current.push({
                x: m.x, y: m.y,
                vx: (Math.random() - 0.5) * 0.6,
                vy: (Math.random() - 0.5) * 0.6,
                life: 26, maxLife: 26,
                color: "#ff8a3a", size: 3,
              });
            }
            const dxh = m.x - PLANE_X;
            const dyh = m.y - planeY.current;
            if (Math.hypot(dxh, dyh) < m.r + PLANE_SIZE / 2) {
              bigMissiles.current.splice(i, 1);
              shake.current = 14;
              flash.current = 10;
              if (shield.current > 0) {
                shield.current = 0;
                sfxShieldHit();
              } else if (!activateBuddyShield("Прикрываю!")) {
                die();
              }
            }
          }

          // Player vs boss collision (ram damage during rest)
          if (boss.current && b.phase !== "die") {
            const bw = 220, bh = 110;
            const hit =
              PLANE_X + PLANE_SIZE / 2 > b.x - bw / 2 &&
              PLANE_X - PLANE_SIZE / 2 < b.x + bw / 2 &&
              planeY.current + PLANE_SIZE / 2 > b.y - bh / 2 &&
              planeY.current - PLANE_SIZE / 2 < b.y + bh / 2;
            if (hit) {
              if (b.phase === "rest" && bossHitCd.current === 0) {
                b.hp -= 1;
                setBossHud({ hp: b.hp, max: b.maxHp });
                bossHitCd.current = 45;
                shake.current = 16;
                flash.current = 12;
                // bounce player back
                planeVy.current = (planeY.current < b.y ? -1 : 1) * 6;
                for (let k = 0; k < 22; k++) {
                  const a = Math.random() * Math.PI * 2;
                  particles.current.push({
                    x: PLANE_X + 12, y: planeY.current,
                    vx: Math.cos(a) * 4, vy: Math.sin(a) * 4,
                    life: 32, maxLife: 32,
                    color: "#ffb84a", size: 2.4,
                  });
                }
                if (b.hp <= 0) {
                  b.phase = "die";
                  b.t = 0;
                  b.fallVy = -2;
                  bigMissiles.current = [];
                }
              } else if (bossHitCd.current === 0) {
                // touching boss while it's shooting = death (unless shield)
                if (shield.current > 0) {
                  shield.current = 0;
                  sfxShieldHit();
                  bossHitCd.current = 30;
                  planeVy.current = -5;
                } else if (!activateBuddyShield("Прикрываю от босса!")) {
                  die();
                }
              }
            }
          }
        }



        if (slowmo.current > 0) slowmo.current--;
        if (boost.current > 0) boost.current--;
        if (shield.current > 0) shield.current--;

        // engine particles (trail behind jet)
        if (tick.current % 2 === 0) {
          particles.current.push({
            x: PLANE_X - 22,
            y: planeY.current + (Math.random() - 0.5) * 3,
            vx: -3.5 - Math.random() * 2.5,
            vy: (Math.random() - 0.5) * 0.6,
            life: 22,
            maxLife: 22,
            color: boost.current > 0 ? "#7bd0ff" : "#ffd070",
            size: 2 + Math.random() * 1.5,
          });
        }

        // canyon collision (skip while plane is near any open portal)
        const idx = Math.floor((PLANE_X + offset.current) / SEG_W);
        const seg = segments.current[idx];
        const nearAnyPortal = portals.current.some(
          (p) => !p.entered && Math.abs(p.worldX - distance.current - PLANE_X) < 90,
        );
        if (seg && !nearAnyPortal) {
          const planeTop = planeY.current - PLANE_SIZE / 2;
          const planeBot = planeY.current + PLANE_SIZE / 2;
          if (planeTop < seg.topH || planeBot > H - seg.botH) {
            if (shield.current > 0) {
              shield.current = 0;
              if (planeTop < seg.topH) {
                planeY.current = seg.topH + PLANE_SIZE / 2 + 2;
                planeVy.current = 3;
              } else {
                planeY.current = H - seg.botH - PLANE_SIZE / 2 - 2;
                planeVy.current = -3;
              }
              shake.current = 8;
              flash.current = 6;
            } else if (activateBuddyShield("Держу щит!")) {
              if (planeTop < seg.topH) {
                planeY.current = seg.topH + PLANE_SIZE / 2 + 2;
                planeVy.current = 3;
              } else {
                planeY.current = H - seg.botH - PLANE_SIZE / 2 - 2;
                planeVy.current = -3;
              }
            } else {
              die();
            }
          }
        }
        if (planeY.current < 0 || planeY.current > H) {
          if (activateBuddyShield("Возвращаю в коридор!")) {
            planeY.current = clamp(planeY.current, PLANE_SIZE / 2, H - PLANE_SIZE / 2);
            planeVy.current *= -0.35;
          } else {
            die();
          }
        }
        setScore(Math.floor(distance.current / 10));

        // ===== Portal spawning (every 1000 score, recurring) =====
        const curScore = Math.floor(distance.current / 10);
        // mark portals that scrolled past as gone (so we can spawn new ones)
        for (const p of portals.current) {
          if (!p.entered && p.worldX - distance.current < -120) p.entered = true;
        }
        const anyActive = portals.current.some((p) => !p.entered);
        if (curScore >= nextPortalScore.current && !anyActive) {
          const curMap = mapRef.current.id;
          const spawnX = distance.current + W * 1.2;
          if (curMap === "otherworld") {
            // dual choice: back to normal (out of ceiling) OR chernobyl (out of floor)
            portals.current.push({ worldX: spawnX, anchor: "top", kind: "normal", entered: false });
            portals.current.push({ worldX: spawnX, anchor: "bottom", kind: "chernobyl", entered: false });
          } else if (curMap === "chernobyl") {
            portals.current.push({ worldX: spawnX, anchor: "bottom", kind: "normal", entered: false });
          } else {
            portals.current.push({ worldX: spawnX, anchor: "bottom", kind: "other", entered: false });
          }
          nextPortalScore.current += 1000;
        }

        // ===== Portal entering =====
        for (const p of portals.current) {
          if (p.entered) continue;
          const px = p.worldX - distance.current;
          const dx = px - PLANE_X;
          const dy = portalY(p) - planeY.current;
          if (Math.hypot(dx, dy) < 60) {
            p.entered = true;
            if (p.kind === "other") mapRef.current = OTHER_WORLD;
            else if (p.kind === "chernobyl") mapRef.current = CHERNOBYL_WORLD;
            else mapRef.current = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
            flash.current = 30;
            shake.current = 18;
            const colors =
              p.kind === "chernobyl"
                ? ["#3a3a2a", "#1a1a10"]
                : p.kind === "normal"
                  ? ["#80c0ff", "#ffffff"]
                  : ["#a060ff", "#60ffd0"];
            for (let i = 0; i < 40; i++) {
              particles.current.push({
                x: PLANE_X,
                y: planeY.current,
                vx: (Math.random() - 0.5) * 6,
                vy: (Math.random() - 0.5) * 6,
                life: 40,
                maxLife: 40,
                color: colors[i % colors.length],
                size: 2 + Math.random() * 3,
              });
            }
          }
        }
        setHud({
          shield: shield.current,
          slowmo: slowmo.current,
          boost: boost.current,
          buddyShield: aiBuddy.current.shieldCooldown,
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
      const driftSpeed = playing ? Math.min(MAX_SPEED, BASE_SPEED + distance.current / 12000) : 1;
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

      if (shake.current > 0) shake.current = Math.max(0, shake.current - 1.6);
      if (flash.current > 0) flash.current--;

      // ============ RENDER ============
      ctx.save();

      // sky gradient (from selected map)
      const theme = mapRef.current;
      const isOther = theme.id === "otherworld";
      const isCher = theme.id === "chernobyl";
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      if (isOther) {
        const ht = tick.current * 0.8;
        sky.addColorStop(0, `hsl(${(ht) % 360}, 90%, 12%)`);
        sky.addColorStop(0.35, `hsl(${(ht + 60) % 360}, 85%, 28%)`);
        sky.addColorStop(0.65, `hsl(${(ht + 160) % 360}, 90%, 35%)`);
        sky.addColorStop(1, `hsl(${(ht + 240) % 360}, 85%, 12%)`);
      } else if (isCher) {
        sky.addColorStop(0, "#000000");
        sky.addColorStop(0.4, "#070806");
        sky.addColorStop(0.75, "#0a0c08");
        sky.addColorStop(1, "#000000");
      } else {
        sky.addColorStop(0, theme.sky[0]);
        sky.addColorStop(0.35, theme.sky[1]);
        sky.addColorStop(0.65, theme.sky[2]);
        sky.addColorStop(1, theme.sky[3]);
      }
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
      if (!isCher) {
        ctx.fillStyle = isOther ? `hsl(${(tick.current * 2) % 360}, 100%, 75%)` : theme.sun;
        ctx.beginPath();
        ctx.arc(sunX, sunY, 38, 0, Math.PI * 2);
        ctx.fill();
      }

      // stars
      for (const s of stars.current) {
        if (s.kind !== undefined) {
          // Planet
          const r = s.s;
          // Palette per kind
          const palettes: Array<{ a: string; b: string; c: string; glow: string; ring?: boolean; ringColor?: string }> = [
            { a: "#f4d4a0", b: "#c98a4b", c: "#5a3a1a", glow: "255,200,130", ring: true, ringColor: "rgba(230,200,150,0.65)" }, // gas giant
            { a: "#ff8a5b", b: "#c0432a", c: "#3a0d08", glow: "255,110,70" },  // mars
            { a: "#7fd0ff", b: "#2a6fb8", c: "#0a2040", glow: "120,180,255" }, // earth-like
            { a: "#e0e0e0", b: "#888", c: "#222", glow: "200,200,210" },       // moon
          ];
          const p = palettes[s.kind % palettes.length];

          // Outer atmospheric glow
          const aura = ctx.createRadialGradient(s.x, s.y, r * 0.9, s.x, s.y, r * 1.8);
          aura.addColorStop(0, `rgba(${p.glow},0.35)`);
          aura.addColorStop(1, `rgba(${p.glow},0)`);
          ctx.fillStyle = aura;
          ctx.fillRect(s.x - r * 2, s.y - r * 2, r * 4, r * 4);

          // Rings (behind planet) — back half
          if (p.ring) {
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(-0.35);
            ctx.strokeStyle = p.ringColor!;
            ctx.lineWidth = Math.max(2, r * 0.08);
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 1.55, r * 0.38, 0, Math.PI, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          // Planet sphere with lit gradient (light from upper-left)
          const lx = s.x - r * 0.4;
          const ly = s.y - r * 0.4;
          const grad = ctx.createRadialGradient(lx, ly, r * 0.1, s.x, s.y, r);
          grad.addColorStop(0, p.a);
          grad.addColorStop(0.55, p.b);
          grad.addColorStop(1, p.c);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.fill();

          // Surface bands / detail
          ctx.save();
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.clip();
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = p.c;
          if (s.kind === 0) {
            // gas giant bands
            for (let i = -3; i <= 3; i++) {
              ctx.fillRect(s.x - r, s.y + i * r * 0.22 - r * 0.05, r * 2, r * 0.1);
            }
          } else if (s.kind === 1) {
            // mars craters
            for (let i = 0; i < 6; i++) {
              const ang = i * 1.7;
              ctx.beginPath();
              ctx.arc(s.x + Math.cos(ang) * r * 0.5, s.y + Math.sin(ang) * r * 0.5, r * 0.12, 0, Math.PI * 2);
              ctx.fill();
            }
          } else if (s.kind === 2) {
            // earth continents
            ctx.fillStyle = "#3a7a3a";
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            ctx.ellipse(s.x - r * 0.2, s.y, r * 0.5, r * 0.3, 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(s.x + r * 0.35, s.y + r * 0.2, r * 0.3, r * 0.18, -0.3, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // moon craters
            for (let i = 0; i < 5; i++) {
              const ang = i * 1.3;
              ctx.beginPath();
              ctx.arc(s.x + Math.cos(ang) * r * 0.45, s.y + Math.sin(ang) * r * 0.45, r * 0.14, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          ctx.restore();

          // Shadow crescent
          ctx.save();
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.clip();
          const shade = ctx.createRadialGradient(s.x + r * 0.5, s.y + r * 0.5, r * 0.2, s.x + r * 0.6, s.y + r * 0.6, r * 1.4);
          shade.addColorStop(0, "rgba(0,0,0,0)");
          shade.addColorStop(1, "rgba(0,0,0,0.65)");
          ctx.fillStyle = shade;
          ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
          ctx.restore();

          // Rings front half
          if (p.ring) {
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(-0.35);
            ctx.strokeStyle = p.ringColor!;
            ctx.lineWidth = Math.max(2, r * 0.08);
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 1.55, r * 0.38, 0, 0, Math.PI);
            ctx.stroke();
            ctx.restore();
          }
        } else {
          const col = isOther
            ? `hsla(${(tick.current * 3 + s.x) % 360}, 100%, 75%, ${0.4 + s.z * 0.6})`
            : isCher
              ? `rgba(80,90,70,${0.15 + s.z * 0.25})`
              : `rgba(255,235,210,${0.3 + s.z * 0.7})`;
          ctx.fillStyle = col;
          ctx.fillRect(s.x, s.y, s.s, s.s);
        }
      }

      // distant mountain silhouettes (background parallax)
      drawDistantMountains(ctx, offset.current * 0.15);

      // canyon walls
      drawCanyon(ctx, segments.current, offset.current, distance.current, tick.current, isOther, isCher);

      // chernobyl ash overlay
      if (isCher) {
        const haze = ctx.createLinearGradient(0, 0, 0, H);
        haze.addColorStop(0, "rgba(40,55,30,0)");
        haze.addColorStop(1, "rgba(40,55,30,0.35)");
        ctx.fillStyle = haze;
        ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < 30; i++) {
          const ax = (i * 137 + (tick.current * 0.6) % W) % W;
          const ay = (i * 53 + (tick.current * 0.9) % H) % H;
          ctx.fillStyle = "rgba(180,180,170,0.25)";
          ctx.fillRect(ax, ay, 1.5, 1.5);
        }
      }

      // foreground mist
      const mist = ctx.createLinearGradient(0, H * 0.6, 0, H);
      mist.addColorStop(0, "rgba(60,30,40,0)");
      mist.addColorStop(1, "rgba(50,20,30,0.45)");
      ctx.fillStyle = mist;
      ctx.fillRect(0, H * 0.6, W, H * 0.4);

      // rare space events (visual only — no text)
      if (rareEvent.current) drawRareEvent(ctx, rareEvent.current, tick.current);

      // powerups, coins, portals, missiles
      for (const p of powers.current) drawPowerup(ctx, p);
      for (const c of coinsRef.current) drawCoin(ctx, c);
      for (const p of portals.current) {
        if (p.entered) continue;
        const px = p.worldX - distance.current;
        if (px > -80 && px < W + 80) {
          drawPortal(ctx, px, portalY(p), tick.current, p.kind, p.anchor);
        }
      }
      for (const m of missiles.current) drawMissile(ctx, m);

      // Boss + big missiles
      if (boss.current) {
        const b = boss.current;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        const flicker = b.phase === "die" ? 0.6 + Math.random() * 0.4 : 1;
        // hull main body
        const grad = ctx.createLinearGradient(0, -55, 0, 55);
        grad.addColorStop(0, "#5a6a85");
        grad.addColorStop(0.5, "#2d3548");
        grad.addColorStop(1, "#15192a");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-110, -30);
        ctx.lineTo(80, -55);
        ctx.lineTo(108, -10);
        ctx.lineTo(108, 18);
        ctx.lineTo(70, 50);
        ctx.lineTo(-100, 38);
        ctx.lineTo(-115, 0);
        ctx.closePath();
        ctx.fill();
        // upper bridge
        ctx.fillStyle = "#3a4660";
        ctx.fillRect(-30, -68, 70, 18);
        // windows
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = `rgba(120,210,255,${0.5 + 0.5 * Math.sin(tick.current * 0.1 + i)})`;
          ctx.fillRect(-80 + i * 22, -18, 10, 6);
        }
        // gun turret (front-left)
        ctx.fillStyle = "#1a1f30";
        ctx.fillRect(-130, -8, 30, 18);
        ctx.fillStyle = b.phase === "shoot" ? `rgba(255,${120 - 80 * Math.sin(tick.current * 0.3)},60,${flicker})` : "#3a2030";
        ctx.beginPath();
        ctx.arc(-130, 1, 9, 0, Math.PI * 2);
        ctx.fill();
        // engines
        for (let i = 0; i < 3; i++) {
          const ey = -20 + i * 22;
          ctx.fillStyle = "#0a0e18";
          ctx.fillRect(100, ey - 4, 14, 8);
          ctx.fillStyle = `rgba(120,180,255,${0.6 + 0.4 * Math.sin(tick.current * 0.4 + i)})`;
          ctx.fillRect(112, ey - 2, 10 + Math.random() * 6, 4);
        }
        ctx.restore();

        // HP bar above boss
        if (b.phase !== "die") {
          const bx = b.x - 90, by = b.y - 90;
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.fillRect(bx, by, 180, 10);
          ctx.fillStyle = "#ff3a4a";
          ctx.fillRect(bx + 2, by + 2, (176 * b.hp) / b.maxHp, 6);
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, by, 180, 10);
        }

        // phase hint
        if (b.phase === "rest") {
          ctx.fillStyle = `rgba(120,255,160,${0.4 + 0.3 * Math.sin(tick.current * 0.2)})`;
          ctx.font = "bold 11px monospace";
          ctx.textAlign = "center";
          ctx.fillText("ТАРАНЬ!", b.x, b.y - 100);
        }
      }
      // big missiles from boss
      for (const m of bigMissiles.current) {
        ctx.save();
        ctx.translate(m.x, m.y);
        const ang = Math.atan2(m.vy, m.vx);
        ctx.rotate(ang);
        // glow
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, m.r + 14);
        g.addColorStop(0, "rgba(255,220,120,0.9)");
        g.addColorStop(0.4, "rgba(255,120,40,0.6)");
        g.addColorStop(1, "rgba(255,80,40,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, m.r + 14, 0, Math.PI * 2);
        ctx.fill();
        // body
        ctx.fillStyle = "#2a2230";
        ctx.beginPath();
        ctx.ellipse(0, 0, m.r, m.r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ff5a3a";
        ctx.beginPath();
        ctx.moveTo(m.r, 0);
        ctx.lineTo(m.r - 6, -m.r * 0.5);
        ctx.lineTo(m.r - 6, m.r * 0.5);
        ctx.closePath();
        ctx.fill();
        // fins
        ctx.fillStyle = "#1a1a24";
        ctx.fillRect(-m.r, -m.r * 0.8, 6, m.r * 0.6);
        ctx.fillRect(-m.r, m.r * 0.2, 6, m.r * 0.6);
        ctx.restore();
      }

      // player rockets
      for (const r of playerRockets.current) {
        ctx.save();
        ctx.translate(r.x, r.y);
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
        g.addColorStop(0, "rgba(180,240,255,0.95)");
        g.addColorStop(0.5, "rgba(120,200,255,0.55)");
        g.addColorStop(1, "rgba(80,160,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#e8f6ff";
        ctx.beginPath();
        ctx.ellipse(0, 0, 14, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#7ec8ff";
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(8, -4);
        ctx.lineTo(8, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }



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
        drawAiBuddy(ctx, aiBuddy.current, tick.current);
        drawJet(ctx, planeY.current, boost.current > 0, shield.current > 0, tick.current, skinRef.current, planeTilt.current);
      }

      // post-effects
      if (slowmo.current > 0) {
        ctx.fillStyle = "rgba(120,90,200,0.10)";
        ctx.fillRect(0, 0, W, H);
      }
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
  }, [die, sfxCoin, sfxPower, sfxShieldHit, showAiBuddyLine]);

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
    onTouchCancel: (e: React.TouchEvent) => {
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

  // Background music (Undertale - Asgore). Loops automatically.
  useEffect(() => {
    const a = musicRef.current;
    if (!a) return;
    a.volume = 0.45;
    a.loop = true;
    const restartMusic = () => {
      if (state === "playing") {
        a.currentTime = 0;
        playMusic();
      }
    };
    a.addEventListener("ended", restartMusic);
    if (state === "playing") {
      playMusic();
    } else if (state === "menu" || state === "briefing") {
      stopMusic();
    } else if (state === "paused") {
      stopMusic();
    } else if (state === "over" || state === "revive") {
      stopMusic(true);
    }
    return () => {
      a.removeEventListener("ended", restartMusic);
    };
  }, [state, playMusic, stopMusic]);

  useEffect(() => {
    if (muted) {
      stopEngine();
      stopMusic();
      return;
    }
    if (state === "playing") {
      ensureAudio();
      if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
      startEngine();
      playMusic();
    }
  }, [muted, state, ensureAudio, startEngine, stopEngine, playMusic, stopMusic]);

  return (
    <div className="fixed inset-0 bg-black">
      <div className="relative h-full w-full overflow-hidden">
        <audio ref={musicRef} src="/077.%20ASGORE%20(UNDERTALE%20Soundtrack)%20-%20Toby%20Fox.mp3" preload="auto" loop />
        <video ref={faceVideoRef} className="hidden" muted playsInline autoPlay />
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="absolute inset-0 h-full w-full"
          style={{ imageRendering: "auto" }}
        />


        {playIrisClosing && (
          <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden bg-transparent">
            <div className="play-iris-close" />
          </div>
        )}

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
          {hud.shield > 0 && (
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-cyan-300/60 bg-cyan-500/15 px-2 py-0.5 text-[11px] font-bold text-cyan-100 backdrop-blur-sm">
              <span>🛡️</span>
              <span className="tabular-nums">{Math.ceil(hud.shield / 60)}с</span>
            </div>
          )}
          {hud.buddyShield > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/35 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-100 backdrop-blur-sm">
              <span>AI</span>
              <span className="tabular-nums">{Math.ceil(hud.buddyShield / 60)}с</span>
            </div>
          )}
        </div>

        {/* Boss HP bar */}
        {bossHud && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 flex flex-col items-center gap-1 font-mono">
            <div className="text-[10px] uppercase tracking-widest text-red-300 drop-shadow">
              ★ BOSS ★
            </div>
            <div className="flex h-3 w-64 overflow-hidden rounded-full border border-red-400/70 bg-black/70">
              <div
                className="h-full bg-gradient-to-r from-red-500 to-orange-400 transition-[width] duration-200"
                style={{ width: `${(bossHud.hp / bossHud.max) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Rocket fire button (only during boss fight) */}
        {state === "playing" && bossHud && (
          <button
            onClick={() => {
              if (rocketCdRef.current > 0) return;
              if (!boss.current || boss.current.phase === "die") return;
              playerRockets.current.push({
                x: PLANE_X + 18,
                y: planeY.current,
                vx: 14,
                t: 0,
              });
              rocketCdRef.current = 60 * 18; // 18s cooldown
              rocketHudPrev.current = 18;
              setRocketHud(18);
              shake.current = Math.max(shake.current, 4);
            }}
            disabled={rocketHud > 0}
            className="absolute bottom-16 left-1/2 z-20 -translate-x-1/2 rounded-full border-2 border-orange-300/80 bg-gradient-to-b from-orange-500 to-red-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-[0_0_20px_rgba(255,120,40,0.6)] backdrop-blur-sm transition disabled:cursor-not-allowed disabled:border-white/20 disabled:from-zinc-700 disabled:to-zinc-800 disabled:text-white/50 disabled:shadow-none"
            aria-label="Fire rocket at boss"
          >
            {rocketHud > 0 ? `🚀 ${rocketHud}с` : "🚀 ОГОНЬ!"}
          </button>
        )}




        {/* in-game mute toggle (only while playing) */}
        {state === "playing" && (
          <button
            onClick={() => setMuted((m) => !m)}
            className="absolute bottom-3 right-3 z-20 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white/80 backdrop-blur-sm hover:bg-black/80"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        )}

        {noseControl && (state === "playing" || state === "briefing" || state === "paused") && (
          <div className="pointer-events-none absolute left-3 bottom-3 z-30 w-44 rounded-md border border-cyan-200/25 bg-black/65 p-2 font-mono text-[10px] text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.18)] backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2">
              <span>{noseControlStatus ?? "Захват лица"}</span>
              <span className="text-white/60">нос</span>
            </div>
            <div className="relative mt-2 h-2 rounded-full bg-white/10">
              <div className="absolute left-1/2 top-0 h-2 w-px bg-white/45" />
              <div
                className="absolute top-0 h-2 w-3 rounded-full bg-cyan-200 shadow-[0_0_10px_rgba(125,249,255,0.85)]"
                style={{ left: `calc(50% + ${noseControlOffset * 42}% - 6px)` }}
              />
            </div>
          </div>
        )}

        {/* in-game pause button */}
        {state === "playing" && (
          <button
            onClick={pauseGame}
            className="absolute top-3 right-3 z-20 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs font-bold text-white/90 backdrop-blur-sm hover:bg-black/80"
            aria-label="Pause"
          >
            ⏸ СТОП
          </button>
        )}

        {/* Pause overlay */}
        {state === "paused" && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-black/70 backdrop-blur-sm">
            <div className="font-mono text-3xl font-extrabold uppercase tracking-widest text-white">
              Пауза
            </div>
            <button
              onClick={resumeGame}
              className="rounded-full border border-white/30 bg-white px-8 py-3 font-mono text-lg font-bold uppercase tracking-wide text-black hover:bg-white/90"
            >
              ▶ Продолжить
            </button>
            <button
              onClick={() => {
                setResumeCountdown(null);
                stopNoseControl();
                setState("menu");
              }}
              className="rounded-full border border-white/30 bg-black/60 px-6 py-2 font-mono text-sm text-white/80 hover:bg-black/80"
            >
              В меню
            </button>
          </div>
        )}

        {/* Resume countdown */}
        {resumeCountdown !== null && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/40">
            <div className="font-mono text-8xl font-extrabold text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)]">
              {resumeCountdown}
            </div>
          </div>
        )}


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
          <div className="absolute inset-0 z-10 overflow-hidden rounded-lg bg-black">
            {/* Menu background served from public so Vercel keeps the image at a stable URL. */}
            <img
              src="/space-menu-bg.jpg"
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover select-none pointer-events-none opacity-80"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/70 pointer-events-none" />

            {/* Top-right coins */}
            <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-full border border-yellow-300/60 bg-black/70 px-3 py-1.5 font-mono text-sm font-bold text-yellow-200 backdrop-blur-sm shadow-lg shadow-yellow-500/20">
              <span className="text-base">🪙</span>
              <span>{wallet.toLocaleString()}</span>
            </div>

            {/* Title */}
            <div className="absolute left-1/2 top-[6%] -translate-x-1/2 text-center">
              <h1 className="bg-gradient-to-b from-cyan-200 via-purple-300 to-pink-400 bg-clip-text text-4xl font-black uppercase tracking-[0.2em] text-transparent drop-shadow-[0_4px_12px_rgba(168,85,247,0.5)] sm:text-5xl md:text-6xl">
                Space Rush
              </h1>
              <div className="mt-1 text-[10px] uppercase tracking-[0.4em] text-white/50">
                Космический забег
              </div>
            </div>

            {/* Stats strip: Rank · Record · Coins · Leaderboard */}
            {(() => {
              const rank =
                best >= 5000 ? { name: "Легенда", icon: "👑", grad: "from-yellow-300 to-orange-500" } :
                best >= 2000 ? { name: "Капитан", icon: "🎖️", grad: "from-purple-400 to-pink-500" } :
                best >= 500  ? { name: "Ас",      icon: "⭐", grad: "from-cyan-300 to-blue-500" } :
                best >= 100  ? { name: "Пилот",   icon: "🚀", grad: "from-emerald-300 to-teal-500" } :
                               { name: "Новичок", icon: "🌱", grad: "from-slate-300 to-slate-500" };
              return (
                <div className="absolute left-1/2 top-[22%] z-20 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2">
                  <div className={`flex items-center gap-1.5 rounded-full bg-gradient-to-r ${rank.grad} px-3 py-1.5 text-xs font-black uppercase tracking-wider text-black shadow-lg ring-1 ring-white/40`}>
                    <span>{rank.icon}</span>
                    <span>{rank.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full border border-cyan-300/50 bg-black/60 px-3 py-1.5 font-mono text-xs font-bold text-cyan-200 backdrop-blur-sm">
                    <span>🏆</span>
                    <span>{best.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full border border-pink-300/50 bg-black/60 px-3 py-1.5 font-mono text-xs font-bold text-pink-200 backdrop-blur-sm">
                    <span>💎</span>
                    <span>Лучшие ● {bestCoins}</span>
                  </div>
                  <button
                    onClick={() => setStatsOpen(true)}
                    className="flex items-center gap-1.5 rounded-full border border-white/30 bg-black/60 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm transition-transform hover:scale-105 active:scale-95"
                  >
                    <span>🏅</span>
                    <span>Подробнее</span>
                  </button>
                </div>
              );
            })()}


            {/* PLAY button */}
            <button
              onClick={openNormalBriefing}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 group relative overflow-hidden rounded-full bg-gradient-to-r from-orange-400 via-pink-500 to-purple-600 px-12 py-4 text-2xl font-black uppercase tracking-widest text-white shadow-[0_10px_40px_-5px_rgba(236,72,153,0.6)] ring-2 ring-white/30 transition-transform hover:scale-110 active:scale-95 focus:outline-none sm:px-16 sm:py-5 sm:text-3xl"
            >
              <span className="relative z-10 drop-shadow-md">▶ Играть</span>
              <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            </button>

            <button
              onClick={openNoseBriefing}
              className="absolute left-1/2 top-[61%] z-20 -translate-x-1/2 rounded-full border border-cyan-200/45 bg-black/70 px-5 py-2.5 text-xs font-black uppercase tracking-[0.22em] text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.24)] backdrop-blur-md transition hover:scale-105 hover:bg-cyan-950/65 active:scale-95"
            >
              Играть носом
            </button>
            {noseControlStatus && state === "menu" && (
              <div className="absolute left-1/2 top-[68%] z-20 -translate-x-1/2 rounded-full border border-white/15 bg-black/65 px-3 py-1 font-mono text-[10px] text-white/75 backdrop-blur-sm">
                {noseControlStatus}
              </div>
            )}

            {/* Shop row (4 buttons) */}
            <div className="absolute inset-x-3 bottom-[15%] z-20 grid grid-cols-5 gap-2 sm:gap-3">
              {[
                { label: "Скины", icon: "👤", grad: "from-pink-500 via-fuchsia-500 to-purple-600", ring: "ring-fuchsia-300/60", glow: "shadow-fuchsia-500/40", onClick: () => setShopTab("skins"), badge: false },
                { label: "Карты", icon: "🗺️", grad: "from-emerald-400 via-teal-500 to-cyan-600", ring: "ring-emerald-300/60", glow: "shadow-emerald-500/40", onClick: () => setShopTab("maps"), badge: false },
                { label: "Транспорт", icon: "🚀", grad: "from-orange-400 via-red-500 to-pink-600", ring: "ring-orange-300/60", glow: "shadow-orange-500/40", onClick: () => setShopTab("vehicles"), badge: false },
                { label: "Задания", icon: "📋", grad: "from-amber-300 via-yellow-500 to-orange-500", ring: "ring-yellow-300/60", glow: "shadow-yellow-500/40", onClick: () => setQuestsOpen(true), badge: false },
                { label: "Награды", icon: "🎁", grad: "from-rose-400 via-red-500 to-amber-500", ring: "ring-rose-300/60", glow: "shadow-rose-500/40", onClick: () => setRewardsOpen(true), badge: canClaimDaily },
              ].map((b) => (
                <button
                  key={b.label}
                  onClick={b.onClick}
                  className={`group relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl bg-gradient-to-br ${b.grad} px-2 py-3.5 text-white shadow-lg ${b.glow} ring-2 ${b.ring} transition-all duration-200 hover:scale-110 hover:-translate-y-1 active:scale-95 focus:outline-none`}
                >
                  {/* glossy highlight */}
                  <span className="pointer-events-none absolute inset-x-2 top-1 h-1/3 rounded-full bg-gradient-to-b from-white/40 to-transparent blur-sm" />
                  {/* shimmer sweep */}
                  <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                  <span className="relative text-2xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] transition-transform group-hover:scale-125 group-hover:rotate-6">{b.icon}</span>
                  <span className="relative text-[10px] font-black uppercase tracking-wider drop-shadow-md sm:text-xs">{b.label}</span>
                  {b.badge && (
                    <span className="absolute right-1 top-1 flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white/80" />
                    </span>
                  )}
                </button>
              ))}
            </div>


            {user?.email && (
              <div className="absolute inset-x-3 bottom-14 z-20 flex justify-center">
                <div className="max-w-[calc(100%-1.5rem)] truncate rounded-full border border-white/15 bg-black/60 px-3 py-1 text-center font-mono text-[11px] text-white/75 backdrop-blur-sm">
                  {user.email}
                </div>
              </div>
            )}

            {/* Bottom row: Stats, Settings, Leave */}
            <div className="absolute inset-x-3 bottom-3 z-20 flex items-center justify-center gap-2">
              <button
                onClick={() => setStatsOpen(true)}
                className="flex items-center gap-1.5 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs font-semibold text-white/85 backdrop-blur-sm transition-all hover:scale-105 hover:bg-black/80 active:scale-95"
              >
                <span>📊</span> Статистика
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-1.5 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs font-semibold text-white/85 backdrop-blur-sm transition-all hover:scale-105 hover:bg-black/80 active:scale-95"
              >
                <span>⚙️</span> Настройки
              </button>
              {user ? (
                <button
                  onClick={() => supabase.auth.signOut()}
                  className="flex items-center gap-1.5 rounded-full border border-red-400/40 bg-black/60 px-3 py-1.5 text-xs font-semibold text-red-200 backdrop-blur-sm transition-all hover:scale-105 hover:bg-red-950/60 active:scale-95"
                >
                  <span>🚪</span> Выйти
                </button>
              ) : (
                <Link
                  to="/auth"
                  className="flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-black/60 px-3 py-1.5 text-xs font-semibold text-cyan-200 backdrop-blur-sm transition-all hover:scale-105 hover:bg-cyan-950/60 active:scale-95"
                >
                  <span>🔑</span> Войти
                </Link>
              )}
            </div>
          </div>
        )}

        {state === "briefing" && (
          <div className="absolute inset-0 z-20 overflow-hidden bg-[#050611] text-white">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_12%,rgba(79,209,255,0.2),transparent_26%),radial-gradient(circle_at_82%_16%,rgba(255,120,200,0.16),transparent_24%),linear-gradient(180deg,#07111f_0%,#0d1523_44%,#0a0a0b_100%)]" />
            <div className="absolute inset-x-0 top-0 h-[45%] opacity-70">
              {Array.from({ length: 36 }).map((_, i) => (
                <span
                  key={i}
                  className="absolute h-0.5 w-0.5 rounded-full bg-white"
                  style={{
                    left: `${(i * 23) % 100}%`,
                    top: `${8 + ((i * 37) % 34)}%`,
                    opacity: 0.35 + ((i * 13) % 55) / 100,
                  }}
                />
              ))}
            </div>
            <div className="absolute left-1/2 top-[14%] z-0 hidden h-[38%] w-[88%] -translate-x-1/2 overflow-hidden rounded-t-full border border-cyan-100/25 bg-[radial-gradient(circle_at_50%_20%,rgba(125,249,255,0.12),rgba(15,23,42,0.18)_48%,rgba(0,0,0,0.08)_100%)] shadow-[inset_0_0_70px_rgba(125,249,255,0.12),0_0_42px_rgba(34,211,238,0.08)] sm:block">
              <div className="absolute inset-x-[6%] top-[8%] h-px bg-cyan-100/35" />
              <div className="absolute left-[12%] top-[22%] h-px w-[76%] bg-cyan-100/15" />
              <div className="absolute left-[18%] top-[12%] h-24 w-44 rotate-[-12deg] rounded-full bg-fuchsia-400/10 blur-2xl" />
              <div className="absolute right-[17%] top-[16%] h-20 w-36 rotate-[14deg] rounded-full bg-cyan-300/10 blur-2xl" />
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="absolute rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.85)]"
                  style={{
                    left: `${8 + ((i * 31) % 84)}%`,
                    top: `${8 + ((i * 47) % 38)}%`,
                    width: `${1 + (i % 3)}px`,
                    height: `${1 + (i % 3)}px`,
                    opacity: 0.35 + ((i * 11) % 55) / 100,
                  }}
                />
              ))}
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute h-1 w-14 rounded-full bg-white/35 shadow-[0_0_14px_rgba(255,255,255,0.7)]"
                  style={{ left: `${12 + i * 17}%`, top: `${13 + ((i * 11) % 24)}%`, transform: `rotate(${-18 + i * 9}deg)` }}
                />
              ))}
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute h-5 w-7 rounded-full border border-cyan-100/45 bg-slate-950/70 shadow-[0_0_14px_rgba(125,249,255,0.35)]"
                  style={{ left: `${18 + i * 20}%`, top: `${27 + ((i * 13) % 16)}%` }}
                >
                  <div className="absolute -left-3 top-1/2 h-px w-3 bg-cyan-100/45" />
                  <div className="absolute -right-3 top-1/2 h-px w-3 bg-cyan-100/45" />
                  <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-200 shadow-[0_0_8px_rgba(125,249,255,0.9)]" />
                </div>
              ))}
              <div className="absolute inset-x-[10%] bottom-0 h-12 bg-gradient-to-t from-cyan-100/10 to-transparent" />
            </div>
            <div className="absolute inset-x-0 top-[17%] h-[22%] border-y border-cyan-100/10 bg-slate-950/55 shadow-[inset_0_0_60px_rgba(34,211,238,0.06)]">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full border-l border-cyan-100/10"
                  style={{ left: `${8 + i * 12}%` }}
                />
              ))}
              <div className="absolute inset-x-0 top-1/2 h-px bg-cyan-100/10" />
              <div className="absolute left-[9%] top-[18%] h-11 w-28 border border-cyan-200/15 bg-cyan-200/5 shadow-[0_0_20px_rgba(125,249,255,0.08)]" />
              <div className="absolute right-[10%] top-[24%] h-12 w-32 border border-pink-200/15 bg-pink-200/5 shadow-[0_0_20px_rgba(255,120,200,0.08)]" />
            </div>

            <div className="absolute inset-x-4 top-[24%] z-0 hidden h-[23%] overflow-hidden rounded-sm border border-cyan-100/10 bg-black/20 shadow-[inset_0_0_48px_rgba(34,211,238,0.06)] sm:block">
              <div className="absolute inset-x-0 top-0 h-px bg-cyan-100/25" />
              <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute left-[3%] top-4 h-3 w-[94%] rounded-full border border-cyan-100/15 bg-slate-950/70" />
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-3 h-[78%] w-px bg-cyan-100/10"
                  style={{ left: `${7 + i * 10}%` }}
                />
              ))}
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-2 h-2 w-2 rounded-full shadow-[0_0_10px_currentColor]"
                  style={{ left: `${9 + i * 11}%`, backgroundColor: i % 3 === 0 ? "#67e8f9" : i % 3 === 1 ? "#facc15" : "#fb7185", color: i % 3 === 0 ? "#67e8f9" : i % 3 === 1 ? "#facc15" : "#fb7185" }}
                />
              ))}
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute bottom-3 h-[76%] w-16 rounded-t-full border border-cyan-100/25 bg-cyan-200/10 shadow-[inset_0_0_22px_rgba(125,249,255,0.18),0_0_18px_rgba(34,211,238,0.08)]"
                  style={{ left: `${10 + i * 18}%` }}
                >
                  <div className="absolute inset-x-2 top-3 h-[72%] rounded-t-full bg-[linear-gradient(180deg,rgba(103,232,249,0.24),rgba(8,47,73,0.48))]" />
                  <div className="absolute left-1/2 top-[32%] h-10 w-5 -translate-x-1/2 rounded-full bg-slate-200/35 shadow-[0_0_16px_rgba(125,249,255,0.25)]" />
                  <div className="absolute left-1/2 top-[28%] h-3 w-4 -translate-x-1/2 rounded-full bg-stone-300/45" />
                  <div className="absolute left-1/2 top-[50%] h-5 w-8 -translate-x-1/2 rounded-full border border-cyan-100/20 bg-cyan-100/10" />
                  <div className="absolute -bottom-2 left-1/2 h-4 w-20 -translate-x-1/2 rounded-sm border border-cyan-100/15 bg-zinc-900" />
                </div>
              ))}
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute bottom-1 h-16 w-12 border border-cyan-100/15 bg-slate-950/80 shadow-[0_0_16px_rgba(34,211,238,0.08)]"
                  style={{ left: `${8 + i * 12}%` }}
                >
                  <div className="absolute left-2 top-2 h-2 w-8 bg-cyan-200/35" />
                  <div className="absolute left-2 top-6 h-1 w-6 bg-lime-200/45" />
                  <div className="absolute left-2 top-9 h-1 w-7 bg-fuchsia-200/35" />
                  <div className="absolute bottom-2 left-2 h-2 w-2 rounded-full bg-red-300/80 shadow-[0_0_8px_rgba(252,165,165,0.8)]" />
                </div>
              ))}
              <div className="absolute bottom-5 right-[8%] h-24 w-32 border border-lime-200/20 bg-lime-200/5 shadow-[0_0_22px_rgba(132,204,22,0.08)]">
                <div className="absolute left-3 top-4 h-12 w-8 rounded-b-full border border-lime-100/25 bg-lime-300/10" />
                <div className="absolute left-14 top-5 h-10 w-10 rounded-full border border-fuchsia-100/20 bg-fuchsia-300/10" />
                <div className="absolute bottom-3 left-3 h-1.5 w-24 bg-lime-200/35" />
                <div className="absolute bottom-7 left-12 h-px w-16 rotate-[-16deg] bg-cyan-200/25" />
              </div>
              <div className="absolute bottom-8 left-[43%] h-24 w-24 rounded-full border border-amber-200/35 bg-amber-300/10 shadow-[0_0_34px_rgba(251,191,36,0.18),inset_0_0_24px_rgba(251,191,36,0.14)]">
                <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-200/35 shadow-[0_0_28px_rgba(251,191,36,0.7)]" />
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="absolute left-1/2 top-1/2 h-px w-14 origin-left bg-amber-100/35" style={{ transform: `rotate(${i * 60}deg)` }} />
                ))}
              </div>
              <div className="absolute bottom-7 left-[78%] h-16 w-24 border border-cyan-100/15 bg-slate-950/70">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="absolute left-2 h-1 rounded-full bg-cyan-200/45" style={{ top: `${10 + i * 9}px`, width: `${26 + ((i * 13) % 34)}px` }} />
                ))}
              </div>
            </div>

            <div className="absolute left-1/2 top-[6%] z-10 -translate-x-1/2 text-center font-mono">
              <div className="text-[10px] font-bold uppercase tracking-[0.45em] text-cyan-200/80">
                Орбитальная база “Старт-7”
              </div>
              <div className="mt-2 text-2xl font-black uppercase tracking-[0.16em] text-white sm:text-4xl">
                Предполётный брифинг
              </div>
            </div>

            <div className="absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-b from-slate-900 via-zinc-900 to-black">
              <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-cyan-300/20 to-transparent" />
              <div className="absolute inset-x-0 top-[9%] h-px bg-cyan-100/20" />
              <div className="absolute left-[42%] top-[38%] h-[30%] w-[60%] bg-[linear-gradient(180deg,#555b63_0%,#2b2f35_42%,#17191d_100%)] shadow-[0_0_70px_rgba(125,249,255,0.12),inset_0_0_28px_rgba(0,0,0,0.55)] [clip-path:polygon(0_12%,100%_12%,100%_88%,0_88%)]" />
              <div className="absolute left-[42%] top-[38%] h-[30%] w-[60%] border-y-2 border-cyan-100/25 [clip-path:polygon(0_12%,100%_12%,100%_88%,0_88%)]" />
              <div className="absolute left-[45%] top-[52%] h-1 w-[53%] bg-yellow-200/75 shadow-[0_0_10px_rgba(254,240,138,0.35)]" />
              <div className="absolute left-[45%] top-[61%] h-1 w-[53%] bg-white/45 shadow-[0_0_8px_rgba(255,255,255,0.25)]" />
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="absolute h-2 w-12 rounded-sm bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.25)]" style={{ left: `${48 + i * 7}%`, top: "56%" }} />
              ))}
              {Array.from({ length: 34 }).map((_, i) => (
                <div key={i} className="absolute h-0.5 w-0.5 rounded-full bg-white/25" style={{ left: `${44 + ((i * 17) % 55)}%`, top: `${42 + ((i * 23) % 20)}%` }} />
              ))}
            </div>

            <div className="absolute left-[5%] top-[31%] z-10 hidden h-32 w-44 border border-cyan-200/20 bg-slate-950/75 shadow-[0_0_28px_rgba(125,249,255,0.16)] sm:block">
              <div className="absolute inset-x-3 top-3 grid grid-cols-3 gap-1">
                {["#60a5fa", "#67e8f9", "#fef08a", "#34d399", "#f472b6", "#93c5fd"].map((color) => (
                  <div key={color} className="h-5 border border-white/10 bg-black/60" style={{ boxShadow: `inset 0 0 14px ${color}55` }} />
                ))}
              </div>
              <div className="absolute bottom-4 left-4 h-9 w-28 border border-cyan-100/20 bg-cyan-200/10" />
              <div className="absolute bottom-0 left-0 h-3 w-full bg-zinc-800" />
            </div>
            <div className="absolute right-[5%] top-[29%] z-10 hidden h-36 w-48 border border-pink-200/20 bg-zinc-950/75 shadow-[0_0_28px_rgba(255,120,200,0.14)] md:block">
              <div className="absolute left-4 top-4 h-16 w-20 border border-pink-100/20 bg-pink-200/10" />
              <div className="absolute right-4 top-5 h-14 w-12 rounded-t-full border border-cyan-100/25 bg-cyan-200/10 shadow-[inset_0_0_20px_rgba(125,249,255,0.14)]" />
              <div className="absolute bottom-5 left-4 h-2 w-32 bg-cyan-200/35" />
              <div className="absolute bottom-0 left-0 h-3 w-full bg-zinc-800" />
            </div>

            <div className="absolute inset-x-0 top-[43%] z-20 hidden h-28 pointer-events-none sm:block">
              {[
                { x: "16%", y: "22px", rot: -12, color: "#67e8f9" },
                { x: "32%", y: "22px", rot: 10, color: "#fb7185" },
                { x: "68%", y: "22px", rot: -10, color: "#facc15" },
                { x: "84%", y: "22px", rot: 12, color: "#a78bfa" },
              ].map((arm, i) => (
                <div key={i} className="absolute h-20 w-28" style={{ left: arm.x, top: arm.y, transform: `rotate(${arm.rot}deg)` }}>
                  <div className="absolute left-0 top-2 h-5 w-8 rounded border border-white/20 bg-zinc-800 shadow-[0_0_12px_rgba(0,0,0,0.45)]" />
                  <div className="absolute left-7 top-4 h-2 w-20 rounded-full bg-slate-300 shadow-[inset_0_0_6px_rgba(0,0,0,0.45)]" />
                  <div className="absolute right-0 top-1 h-8 w-7 rounded border border-white/20 bg-zinc-900" />
                  <div className="absolute right-1 top-2 h-1.5 w-5 rounded-full" style={{ backgroundColor: arm.color, boxShadow: `0 0 10px ${arm.color}` }} />
                  <div className="absolute right-2 top-8 h-5 w-px bg-slate-300" />
                </div>
              ))}
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="absolute top-0 h-24 w-px origin-top bg-cyan-100/20" style={{ left: `${10 + i * 11}%`, transform: `rotate(${-10 + (i % 5) * 5}deg)` }} />
              ))}
            </div>

            <div className={`absolute bottom-[18%] left-1/2 z-20 w-52 -translate-x-1/2 sm:w-72 ${briefingTakeoff ? "briefing-jet-takeoff" : ""}`}>
              <img
                src={playerJetSrc}
                alt=""
                draggable={false}
                className="w-full scale-x-[-1] rotate-[1deg] drop-shadow-[0_18px_30px_rgba(0,0,0,0.75)]"
              />
              {briefingTakeoff && (
                <div className="absolute right-[78%] top-[44%] h-5 w-52 rounded-full bg-gradient-to-l from-cyan-200/80 via-orange-300/55 to-transparent blur-md" />
              )}
              <div className="absolute left-1/2 top-[58%] h-4 w-28 -translate-x-1/2 rounded-full bg-cyan-300/30 blur-xl" />
            </div>

            <div className="absolute bottom-[32%] left-[61%] z-30 flex h-14 w-14 items-center justify-center rounded-full border border-cyan-200/70 bg-black/80 shadow-[0_0_30px_rgba(125,249,255,0.55)]">
              <div className="h-8 w-10 rounded-[45%] border border-cyan-100/80 bg-zinc-950">
                <div className="mx-auto mt-2 h-3 w-3 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(125,249,255,1)]" />
              </div>
            </div>

            <div className="absolute bottom-[24%] left-[4%] z-30 hidden h-[116px] w-[45%] sm:block">
              {[
                { x: 0, y: 10, skin: "#d6a06f", hair: "#24140e", suit: "#e8eef7", vest: "#38bdf8", pose: -10 },
                { x: 12, y: 10, skin: "#f1c29a", hair: "#3a2518", suit: "#f8fafc", vest: "#facc15", pose: 10 },
                { x: 24, y: 10, skin: "#9b6a4d", hair: "#111827", suit: "#dbeafe", vest: "#22c55e", pose: -8 },
                { x: 36, y: 10, skin: "#c98964", hair: "#4b2f20", suit: "#f1f5f9", vest: "#a78bfa", pose: 8 },
                { x: 48, y: 10, skin: "#e0b58d", hair: "#1f2937", suit: "#e2e8f0", vest: "#fb7185", pose: -10 },
                { x: 60, y: 10, skin: "#b77955", hair: "#0f172a", suit: "#f8fafc", vest: "#67e8f9", pose: 10 },
                { x: 72, y: 10, skin: "#f0c7a5", hair: "#5b3725", suit: "#e5e7eb", vest: "#f97316", pose: -8 },
              ].map((p, i) => (
                <div key={i} className="absolute h-[96px] w-12" style={{ left: `${p.x}%`, bottom: `${p.y}px` }}>
                  <div className="absolute left-1/2 top-0 h-6 w-6 -translate-x-1/2 rounded-[42%] border border-black/20 shadow-[inset_0_-4px_6px_rgba(0,0,0,0.18)]" style={{ backgroundColor: p.skin }}>
                    <div className="absolute -top-1 left-0 h-3 w-6 rounded-t-full" style={{ backgroundColor: p.hair }} />
                    <div className="absolute left-1.5 top-3 h-1 w-1 rounded-full bg-slate-950/80" />
                    <div className="absolute right-1.5 top-3 h-1 w-1 rounded-full bg-slate-950/80" />
                    <div className="absolute left-1/2 top-[18px] h-px w-2 -translate-x-1/2 bg-rose-900/50" />
                  </div>
                  <div className="absolute left-1/2 top-[24px] h-10 w-8 -translate-x-1/2 rounded-t-lg border border-white/45 shadow-[inset_0_-10px_10px_rgba(15,23,42,0.18)]" style={{ backgroundColor: p.suit }}>
                    <div className="absolute inset-x-1 top-1 h-6 rounded-sm border border-white/25" style={{ backgroundColor: p.vest }} />
                    <div className="absolute left-1/2 top-2 h-6 w-px -translate-x-1/2 bg-black/20" />
                  </div>
                  <div className="absolute left-[5px] top-[31px] h-2 w-8 rounded-full bg-slate-100 shadow-sm" style={{ transform: `rotate(${p.pose}deg)` }} />
                  <div className="absolute right-[2px] top-[38px] h-5 w-3 rounded-sm border border-cyan-100/30 bg-slate-950/80 shadow-[0_0_8px_rgba(125,249,255,0.25)]" />
                  <div className="absolute bottom-8 left-[15px] h-8 w-2 rounded-b bg-slate-200" style={{ transform: `rotate(${i % 2 ? -5 : 4}deg)` }} />
                  <div className="absolute bottom-8 right-[15px] h-8 w-2 rounded-b bg-slate-200" style={{ transform: `rotate(${i % 2 ? 7 : -6}deg)` }} />
                  <div className="absolute bottom-6 left-[10px] h-2 w-5 rounded bg-slate-700" />
                  <div className="absolute bottom-6 right-[8px] h-2 w-5 rounded bg-slate-700" />
                  <div className="absolute bottom-4 left-1/2 h-2 w-9 -translate-x-1/2 rounded-full bg-black/30 blur-sm" />
                </div>
              ))}
            </div>

            <div className="absolute bottom-[43%] right-[3%] z-30 hidden h-[120px] w-[34%] md:block">
              {[
                { x: 0, y: 12, skin: "#f1c29a", hair: "#2f1b12", coat: "#f8fafc", vest: "#60a5fa" },
                { x: 18, y: 12, skin: "#a66b4a", hair: "#111827", coat: "#e0f2fe", vest: "#34d399" },
                { x: 36, y: 12, skin: "#ddb28d", hair: "#4b2e1c", coat: "#f1f5f9", vest: "#f472b6" },
                { x: 54, y: 12, skin: "#c28a64", hair: "#172033", coat: "#e5e7eb", vest: "#fde047" },
                { x: 72, y: 12, skin: "#ecbea1", hair: "#3f2417", coat: "#dbeafe", vest: "#22d3ee" },
              ].map((p, i) => (
                <div key={i} className="absolute h-[86px] w-11" style={{ left: `${p.x}%`, bottom: `${p.y}px` }}>
                  <div className="absolute left-1/2 top-0 h-6 w-6 -translate-x-1/2 rounded-[44%] border border-black/20" style={{ backgroundColor: p.skin }}>
                    <div className="absolute -top-1 left-0 h-3 w-6 rounded-t-full" style={{ backgroundColor: p.hair }} />
                    <div className="absolute left-1.5 top-3 h-1 w-1 rounded-full bg-black/80" />
                    <div className="absolute right-1.5 top-3 h-1 w-1 rounded-full bg-black/80" />
                  </div>
                  <div className="absolute left-1/2 top-[24px] h-10 w-8 -translate-x-1/2 rounded-t-md border border-white/35" style={{ backgroundColor: p.coat }}>
                    <div className="absolute left-1 top-2 h-5 w-6 rounded-sm" style={{ backgroundColor: p.vest }} />
                  </div>
                  <div className="absolute left-[3px] top-[34px] h-1.5 w-9 rounded-full bg-slate-100" style={{ transform: `rotate(${i % 2 ? 20 : -16}deg)` }} />
                  <div className="absolute bottom-4 left-[13px] h-7 w-2 rounded-b bg-slate-200" />
                  <div className="absolute bottom-4 right-[13px] h-7 w-2 rounded-b bg-slate-200" />
                  <div className="absolute bottom-2 left-[8px] h-2 w-5 rounded bg-slate-700" />
                  <div className="absolute bottom-2 right-[7px] h-2 w-5 rounded bg-slate-700" />
                </div>
              ))}
              <div className="absolute bottom-0 left-[8%] h-5 w-28 rounded-sm border border-cyan-100/15 bg-zinc-900 shadow-[0_0_16px_rgba(34,211,238,0.08)]" />
              <div className="absolute bottom-4 left-[12%] h-8 w-20 border border-cyan-100/20 bg-cyan-200/10" />
              <div className="absolute bottom-2 right-[7%] h-8 w-24 rounded-sm border border-yellow-100/20 bg-yellow-200/10" />
            </div>

            <div className="absolute inset-x-0 bottom-[38%] z-10 hidden h-20 pointer-events-none md:block">
              <div className="absolute left-[12%] top-8 h-px w-[72%] bg-cyan-200/20 shadow-[0_0_12px_rgba(125,249,255,0.3)]" />
              <div className="absolute left-[18%] top-1 h-16 w-px bg-cyan-200/20" />
              <div className="absolute left-[84%] top-1 h-16 w-px bg-cyan-200/20" />
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="absolute top-4 h-3 w-3 rounded-full border border-cyan-100/30 bg-cyan-200/20" style={{ left: `${20 + i * 9}%` }} />
              ))}
            </div>

            <div className="absolute inset-x-4 bottom-4 z-40 mx-auto max-w-2xl rounded-md border border-cyan-200/25 bg-black/68 p-3 font-mono shadow-[0_0_26px_rgba(34,211,238,0.14)] backdrop-blur-md sm:bottom-6 sm:p-4">
              <div className="hidden">
                Главный инженер
              </div>
              <div className="text-xs font-semibold leading-relaxed text-white/90 sm:text-sm">
                Пилот, взлёт разрешён. Твой ИИ-напарник уже подключён к борту:
                он будет сканировать маршрут, предупреждать об опасностях и прикрывать тебя в этом полёте.
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={() => {
                    stopNoseControl();
                    setState("menu");
                  }}
                  className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 hover:bg-white/15"
                >
                  Назад
                </button>
                <button
                  onClick={launchFromBriefing}
                  className="rounded-full bg-gradient-to-r from-cyan-300 via-white to-orange-300 px-5 py-2 text-xs font-black uppercase tracking-widest text-black shadow-[0_0_22px_rgba(125,249,255,0.42)] transition hover:scale-105 active:scale-95"
                >
                  Взлёт
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stats overlay */}
        {state === "menu" && statsOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setStatsOpen(false)}>
            <div
              className="relative w-[90%] max-w-sm rounded-2xl border border-purple-400/40 bg-gradient-to-b from-slate-900 to-purple-950 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-4 text-center text-xl font-black uppercase tracking-widest text-cyan-200">📊 Статистика</h2>
              <div className="space-y-3 font-mono text-sm">
                <div className="flex justify-between rounded-lg bg-black/40 px-3 py-2 text-white/90">
                  <span className="text-white/60">Рекорд</span>
                  <span className="font-bold text-yellow-200">{best.toLocaleString()}</span>
                </div>
                <div className="flex justify-between rounded-lg bg-black/40 px-3 py-2 text-white/90">
                  <span className="text-white/60">Лучшие монеты</span>
                  <span className="font-bold text-yellow-200">🪙 {bestCoins}</span>
                </div>
                <div className="flex justify-between rounded-lg bg-black/40 px-3 py-2 text-white/90">
                  <span className="text-white/60">Баланс</span>
                  <span className="font-bold text-yellow-200">🪙 {wallet}</span>
                </div>
              </div>
              <button
                onClick={() => setStatsOpen(false)}
                className="mt-5 w-full rounded-full bg-purple-600 px-4 py-2 text-sm font-bold uppercase tracking-wider text-white hover:bg-purple-500 active:scale-95"
              >
                Закрыть
              </button>
            </div>
          </div>
        )}

        {/* Settings overlay */}
        {state === "menu" && settingsOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setSettingsOpen(false)}>
            <div
              className="relative w-[90%] max-w-sm rounded-2xl border border-purple-400/40 bg-gradient-to-b from-slate-900 to-purple-950 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-4 text-center text-xl font-black uppercase tracking-widest text-cyan-200">⚙️ Настройки</h2>
              <div className="space-y-3">
                <button
                  onClick={() => setMuted((m) => !m)}
                  className="flex w-full items-center justify-between rounded-lg bg-black/40 px-4 py-3 text-white hover:bg-black/60"
                >
                  <span className="font-semibold">Звук</span>
                  <span className="text-lg">{muted ? "🔇 Выкл" : "🔊 Вкл"}</span>
                </button>
                {user && (
                  <div className="rounded-lg bg-black/40 px-4 py-3 text-sm text-white/70">
                    <div className="text-[10px] uppercase tracking-widest text-white/40">Аккаунт</div>
                    <div className="mt-1 truncate font-mono">{user.email}</div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setSettingsOpen(false)}
                className="mt-5 w-full rounded-full bg-purple-600 px-4 py-2 text-sm font-bold uppercase tracking-wider text-white hover:bg-purple-500 active:scale-95"
              >
                Закрыть
              </button>
            </div>
          </div>
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

        {/* Daily rewards modal */}
        {state === "menu" && rewardsOpen && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setRewardsOpen(false)}
          >
            <div
              className="relative w-full max-w-2xl rounded-2xl border border-rose-400/40 bg-gradient-to-b from-slate-900 to-rose-950 p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xl font-black uppercase tracking-wider text-rose-200">
                  🎁 Ежедневные награды
                </h2>
                <button
                  onClick={() => setRewardsOpen(false)}
                  className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold text-white hover:bg-white/20"
                >
                  ✕
                </button>
              </div>

              <p className="mb-3 text-center text-xs text-rose-200/80">
                День {dailyRewards.day} из 30 ·{" "}
                {canClaimDaily ? (
                  <span className="font-bold text-emerald-300">награда доступна!</span>
                ) : (
                  <span className="text-white/60">приходите завтра</span>
                )}
              </p>

              <div className="grid max-h-[55vh] grid-cols-5 gap-2 overflow-y-auto pr-1 sm:grid-cols-6">
                {DAILY_REWARDS.map((r, i) => {
                  const day = i + 1;
                  const claimed = day < dailyRewards.day || (day === dailyRewards.day && !canClaimDaily);
                  const isToday = day === dailyRewards.day && canClaimDaily;
                  const icon = r.type === "coins" ? "🪙" : r.type === "skin" ? "👤" : "🗺️";
                  const label =
                    r.type === "coins"
                      ? `+${r.amount}`
                      : r.type === "skin"
                        ? r.name
                        : r.name;
                  return (
                    <div
                      key={day}
                      className={`relative flex flex-col items-center justify-center gap-0.5 rounded-xl border p-2 text-center transition-all ${
                        isToday
                          ? "animate-pulse border-emerald-300 bg-emerald-500/20 ring-2 ring-emerald-300/60"
                          : claimed
                            ? "border-white/10 bg-white/5 opacity-50"
                            : "border-white/15 bg-white/8"
                      }`}
                    >
                      <span className="text-[10px] font-bold text-white/70">День {day}</span>
                      <span className="text-2xl">{icon}</span>
                      <span className="line-clamp-1 text-[10px] font-bold text-white">{label}</span>
                      {claimed && (
                        <span className="absolute right-1 top-1 text-xs text-emerald-300">✓</span>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                onClick={claimDailyReward}
                disabled={!canClaimDaily}
                className={`mt-4 w-full rounded-full px-6 py-3 text-base font-black uppercase tracking-wider text-white shadow-lg transition-all ${
                  canClaimDaily
                    ? "bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:scale-105 active:scale-95"
                    : "cursor-not-allowed bg-white/10 text-white/40"
                }`}
              >
                {canClaimDaily ? `Забрать награду (День ${dailyRewards.day})` : "Уже получено сегодня"}
              </button>
            </div>
          </div>
        )}

        {/* Reward toast */}
        {rewardToast && (
          <div className="pointer-events-none absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-full border border-emerald-300/60 bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2 text-sm font-black text-white shadow-2xl">
            🎉 {rewardToast}
          </div>
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
            <RankDisplay totalDistance={totalDistance} />
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
                onClick={() => {
                  stopNoseControl();
                  setState("menu");
                }}
                className="w-full rounded-full border border-white/20 bg-white/10 px-6 py-2.5 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-white/20 sm:px-8"
              >
                🏠  Главное меню
              </button>
            </div>
          </Overlay>
        )}

        {state === "over" && (
          <Overlay bgImage={gameOverBg}>
            <div className="absolute inset-0 bg-black/30" />
            <div className="relative z-10 flex flex-col items-center gap-4">
            <h2 className="text-3xl font-black uppercase tracking-wider text-red-400 drop-shadow-[0_2px_8px_rgba(255,60,40,0.8)]">
              Crashed
            </h2>
            <div className="flex flex-col items-center gap-1">
              <div className="font-mono text-4xl font-bold text-white">
                {score.toLocaleString()}
              </div>
              <div className="font-mono text-base text-yellow-300">● {coins}</div>
            </div>
            <RankDisplay totalDistance={totalDistance} />
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
            </div>
          </Overlay>
        )}
      </div>
      <p className="text-center text-xs text-white/50">
        ↑ / ↓ или тапай по экрану · Space — старт
      </p>
    </div>
  );
}

function Overlay({ children, bgImage }: { children: React.ReactNode; bgImage?: string }) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-hidden rounded-lg px-3 ${bgImage ? "" : "bg-black/60 backdrop-blur-sm"}`}
      style={bgImage ? { backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      {children}
    </div>
  );
}

function RankDisplay({ totalDistance }: { totalDistance: number }) {
  const { current, next, progress } = getRank(totalDistance);
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur-sm"
        style={{ borderColor: `${current.color}60`, color: current.color, backgroundColor: `${current.color}15` }}
      >
        <span className="text-base leading-none">{current.emoji}</span>
        <span>{current.name}</span>
      </div>
      {next && (
        <div className="flex flex-col items-center gap-0.5">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress}%`, backgroundColor: current.color }}
            />
          </div>
          <span className="text-[10px] text-white/40">
            {totalDistance.toLocaleString()} / {next.threshold.toLocaleString()} → {next.name}
          </span>
        </div>
      )}
    </div>
  );
}

interface ShopOverlayProps {
  tab: "skins" | "maps" | "vehicles";
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
          {tab === "skins" ? "Скины" : tab === "maps" ? "Карты" : "Транспорт"}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="grid grid-cols-1 gap-2.5">
          {(tab === "skins" || tab === "vehicles") &&
            SKINS.filter((s) => (tab === "vehicles" ? s.category === "vehicle" : s.category !== "vehicle")).map((s) => {
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
                      className="flex h-12 w-16 items-center justify-center rounded-md border border-white/20 text-2xl"
                      style={{
                        background: `linear-gradient(180deg, ${s.fuse[0]}, ${s.fuse[1]} 55%, ${s.fuse[2]})`,
                        textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                      }}
                    >
                      {s.emoji}
                    </div>
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
                      className="flex h-12 w-16 items-center justify-center rounded-md border border-white/20 text-2xl"
                      style={{
                        background: `linear-gradient(180deg, ${m.sky[0]}, ${m.sky[1]} 40%, ${m.sky[2]} 75%, ${m.sky[3]})`,
                        textShadow: "0 1px 3px rgba(0,0,0,0.7)",
                      }}
                    >
                      {m.emoji}
                    </div>
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

type RareEventKindLocal = "star" | "asteroids" | "wreck" | "chase";
function drawRareEvent(
  ctx: CanvasRenderingContext2D,
  e: { kind: RareEventKindLocal; t: number; duration: number; seed: number },
  tick: number,
) {
  const p = e.t / e.duration; // 0..1
  const fade = Math.min(1, Math.min(e.t, e.duration - e.t) / 80);
  ctx.save();
  ctx.globalAlpha = fade;

  if (e.kind === "star") {
    // ======= STAR (close flyby) =======
    const cx = W + 280 - p * (W + 560);
    const cy = H * 0.32 + Math.sin(p * Math.PI) * -20;
    const pulse = 1 + Math.sin(tick * 0.08) * 0.04;
    const R = 180 * pulse;

    // 1) full-screen warm tint (sun bath)
    const tint = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, Math.max(W, H));
    tint.addColorStop(0, "rgba(255,210,140,0.45)");
    tint.addColorStop(0.4, "rgba(255,140,70,0.18)");
    tint.addColorStop(1, "rgba(120,30,10,0)");
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);

    // 2) god rays (radial light beams)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + tick * 0.005;
      const len = Math.max(W, H) * 1.4;
      const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
      grad.addColorStop(0, "rgba(255,220,160,0.25)");
      grad.addColorStop(1, "rgba(255,220,160,0)");
      ctx.fillStyle = grad;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, -18);
      ctx.lineTo(len, 18);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // 3) outer corona (soft halo)
    const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2.6);
    halo.addColorStop(0, "rgba(255,200,120,0.7)");
    halo.addColorStop(0.35, "rgba(255,130,60,0.3)");
    halo.addColorStop(1, "rgba(255,60,20,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 2.6, 0, Math.PI * 2);
    ctx.fill();

    // 4) plasma flares (curved tongues)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + tick * 0.015;
      const flareLen = R * (1.0 + Math.sin(tick * 0.06 + i * 1.3) * 0.25);
      const fx = cx + Math.cos(a) * R * 0.95;
      const fy = cy + Math.sin(a) * R * 0.95;
      const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, flareLen * 0.5);
      fg.addColorStop(0, "rgba(255,230,180,0.85)");
      fg.addColorStop(0.5, "rgba(255,140,60,0.4)");
      fg.addColorStop(1, "rgba(255,80,30,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(fx, fy, flareLen * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 5) star body — multi-layer with surface granulation
    const core = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.25, 0, cx, cy, R);
    core.addColorStop(0, "#ffffff");
    core.addColorStop(0.25, "#fff2c0");
    core.addColorStop(0.6, "#ffb24a");
    core.addColorStop(0.9, "#ff6a1a");
    core.addColorStop(1, "#c43a08");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // 6) surface convection cells (dark sunspots + bright granules)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    for (let i = 0; i < 24; i++) {
      const sa = (i * 137 + tick * 0.4) * 0.01;
      const sr = R * (0.2 + ((i * 53) % 70) / 100);
      const sx = cx + Math.cos(sa + i) * sr;
      const sy = cy + Math.sin(sa * 1.3 + i) * sr;
      const sz = 8 + ((i * 17) % 18);
      const bright = (i + Math.floor(tick / 8)) % 5 === 0;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sz);
      if (bright) {
        g.addColorStop(0, "rgba(255,255,230,0.7)");
        g.addColorStop(1, "rgba(255,200,120,0)");
      } else {
        g.addColorStop(0, "rgba(180,60,10,0.35)");
        g.addColorStop(1, "rgba(180,60,10,0)");
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 7) bright rim (limb brightening)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const rim = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.05);
    rim.addColorStop(0, "rgba(255,200,100,0)");
    rim.addColorStop(0.6, "rgba(255,240,200,0.5)");
    rim.addColorStop(1, "rgba(255,200,100,0)");
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 8) lens flare streak across screen
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const streak = ctx.createLinearGradient(0, cy, W, cy);
    streak.addColorStop(0, "rgba(255,220,160,0)");
    streak.addColorStop(Math.max(0, Math.min(1, cx / W)), "rgba(255,250,220,0.6)");
    streak.addColorStop(1, "rgba(255,220,160,0)");
    ctx.fillStyle = streak;
    ctx.fillRect(0, cy - 2, W, 4);
    ctx.restore();
  } else if (e.kind === "asteroids") {
    // ======= ASTEROID FIELD =======
    // subtle dust haze
    ctx.fillStyle = "rgba(60,50,40,0.15)";
    ctx.fillRect(0, 0, W, H);
    const seed = e.seed;
    for (let i = 0; i < 55; i++) {
      const r = ((seed * 1000 + i * 73) % 1000) / 1000;
      const depth = 0.3 + r * 0.7; // parallax
      const speed = 2 + depth * 6;
      const baseX = (i * 137) % (W + 500);
      const x = (((baseX - e.t * speed) % (W + 500)) + (W + 500)) % (W + 500) - 250;
      const y = 20 + ((i * 53 + Math.floor(seed * 500)) % (H - 40));
      const size = (5 + ((i * 17) % 28)) * depth;
      const rot = tick * (0.01 + r * 0.03) + i;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      // body
      const ag = ctx.createRadialGradient(-size * 0.3, -size * 0.3, 0, 0, 0, size);
      ag.addColorStop(0, "#9a8a76");
      ag.addColorStop(0.6, "#6a5a4a");
      ag.addColorStop(1, "#2a2218");
      ctx.fillStyle = ag;
      ctx.beginPath();
      for (let k = 0; k < 9; k++) {
        const aa = (k / 9) * Math.PI * 2;
        const rr = size * (0.7 + ((i * k * 31) % 100) / 350);
        const px = Math.cos(aa) * rr;
        const py = Math.sin(aa) * rr;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      // craters
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      for (let c = 0; c < 3; c++) {
        const ca = c * 2.1;
        ctx.beginPath();
        ctx.arc(Math.cos(ca) * size * 0.4, Math.sin(ca) * size * 0.4, size * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  } else if (e.kind === "wreck") {
    // ======= DERELICT CRUISER =======
    const cx = W + 320 - p * (W + 640);
    const cy = H * 0.45 + Math.sin(tick * 0.02) * 6;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.12);
    // hull main
    const hg = ctx.createLinearGradient(0, -40, 0, 40);
    hg.addColorStop(0, "#4a4a5a");
    hg.addColorStop(0.5, "#2e2e3a");
    hg.addColorStop(1, "#1a1a24");
    ctx.fillStyle = hg;
    ctx.fillRect(-200, -32, 270, 64);
    // upper deck
    ctx.fillStyle = "#3a3a48";
    ctx.fillRect(-180, -42, 200, 12);
    // lower fin
    ctx.fillStyle = "#202028";
    ctx.beginPath();
    ctx.moveTo(-200, 32);
    ctx.lineTo(-60, 50);
    ctx.lineTo(40, 32);
    ctx.closePath();
    ctx.fill();
    // jagged break (right side torn off)
    ctx.fillStyle = "#0d0d14";
    ctx.beginPath();
    ctx.moveTo(70, -42);
    ctx.lineTo(95, -20);
    ctx.lineTo(60, -5);
    ctx.lineTo(100, 10);
    ctx.lineTo(55, 22);
    ctx.lineTo(85, 35);
    ctx.lineTo(70, 50);
    ctx.lineTo(70, -42);
    ctx.fill();
    // exposed beams
    ctx.strokeStyle = "#554";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(60, -20 + i * 12);
      ctx.lineTo(95 + (i % 2) * 8, -15 + i * 14);
      ctx.stroke();
    }
    // flickering windows
    for (let i = 0; i < 7; i++) {
      const on = (i * 7 + Math.floor(tick / 15)) % 5 !== 0;
      ctx.fillStyle = on ? "#6a5520" : "#1a1612";
      ctx.fillRect(-180 + i * 28, -14, 12, 8);
    }
    // reactor leak: pulsing green-orange glow + sparks
    const leakPulse = 0.5 + Math.sin(tick * 0.2) * 0.4;
    const leak = ctx.createRadialGradient(75, 5, 0, 75, 5, 60);
    leak.addColorStop(0, `rgba(255,180,60,${leakPulse})`);
    leak.addColorStop(0.5, `rgba(255,80,30,${leakPulse * 0.5})`);
    leak.addColorStop(1, "rgba(180,40,10,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = leak;
    ctx.fillRect(20, -50, 120, 110);
    ctx.restore();
    // sparks
    for (let i = 0; i < 8; i++) {
      const sx = 70 + Math.sin(tick * 0.4 + i * 1.7) * 18;
      const sy = -5 + Math.cos(tick * 0.3 + i * 2) * 22;
      ctx.fillStyle = i % 2 ? "rgba(255,220,120,0.9)" : "rgba(255,140,60,0.8)";
      ctx.fillRect(sx, sy, 2, 2);
    }
    // smoke trail
    ctx.fillStyle = "rgba(180,180,200,0.14)";
    for (let i = 0; i < 12; i++) {
      const sx = 80 + i * 16 + (tick * 0.4) % 16;
      const sy = -10 + Math.sin(tick * 0.04 + i) * 28;
      ctx.beginPath();
      ctx.arc(sx, sy, 12 + i * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (e.kind === "chase") {
    // ======= MYSTERY SHIP CHASE =======
    // erratic darting motion + occasional jump
    const dart = Math.sin(tick * 0.07) * 60 + Math.sin(tick * 0.23) * 20;
    const cx = W * 0.62 + Math.sin(tick * 0.04) * 100 + dart * 0.3;
    const cy = H * 0.38 + Math.cos(tick * 0.03) * 60;
    // motion blur trail
    for (let i = 6; i > 0; i--) {
      const tx = cx - i * 14;
      const ty = cy + Math.sin(tick * 0.05 + i) * 3;
      ctx.fillStyle = `rgba(120,200,255,${0.06 * i})`;
      ctx.beginPath();
      ctx.ellipse(tx, ty, 28, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(cx, cy);
    // engine plume
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const eg = ctx.createRadialGradient(-30, 0, 0, -30, 0, 40);
    eg.addColorStop(0, "rgba(180,230,255,0.9)");
    eg.addColorStop(0.4, "rgba(80,160,255,0.5)");
    eg.addColorStop(1, "rgba(60,100,200,0)");
    ctx.fillStyle = eg;
    ctx.fillRect(-80, -35, 70, 70);
    ctx.restore();
    // hull dark
    const hg = ctx.createLinearGradient(0, -14, 0, 14);
    hg.addColorStop(0, "#2a2a3e");
    hg.addColorStop(0.5, "#15151f");
    hg.addColorStop(1, "#0a0a14");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(-32, 0);
    ctx.lineTo(18, -14);
    ctx.lineTo(42, 0);
    ctx.lineTo(18, 14);
    ctx.closePath();
    ctx.fill();
    // top fin
    ctx.fillStyle = "#3d3d55";
    ctx.beginPath();
    ctx.moveTo(-10, -10);
    ctx.lineTo(8, -22);
    ctx.lineTo(20, -10);
    ctx.closePath();
    ctx.fill();
    // cockpit glow (cyan)
    const cg = ctx.createRadialGradient(15, 0, 0, 15, 0, 8);
    cg.addColorStop(0, "rgba(120,255,220,0.9)");
    cg.addColorStop(1, "rgba(120,255,220,0)");
    ctx.fillStyle = cg;
    ctx.fillRect(5, -8, 25, 16);
    // blinking red beacon
    if (Math.floor(tick / 10) % 2 === 0) {
      ctx.fillStyle = "#ff3030";
      ctx.beginPath();
      ctx.arc(12, -12, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,60,60,0.4)";
      ctx.beginPath();
      ctx.arc(12, -12, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore();
}

function drawDistantMountains(ctx: CanvasRenderingContext2D, off: number) {
  const mountainNoise = (index: number, salt: number) => {
    const n = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  const drawLayer = (baseY: number, step: number, color: string, amp: number, speed: number, salt: number) => {
    const scroll = off * speed;
    const phase = scroll % step;
    const firstIndex = Math.floor(scroll / step) - 1;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-step, baseY);
    for (let i = -1; i <= Math.ceil(W / step) + 2; i++) {
      const index = firstIndex + i;
      const x = i * step - phase;
      const n =
        (mountainNoise(index, salt) - 0.5) * amp +
        (mountainNoise(index, salt + 1) - 0.5) * amp * 0.45;
      ctx.lineTo(x, baseY + n);
    }
    ctx.lineTo(W + step, H);
    ctx.lineTo(-step, H);
    ctx.closePath();
    ctx.fill();
  };

  drawLayer(H * 0.55, 36, "rgba(40,20,40,0.55)", 42, 0.55, 12);
  drawLayer(H * 0.62, 30, "rgba(25,12,25,0.7)", 50, 0.82, 77);
}

function drawCanyon(
  ctx: CanvasRenderingContext2D,
  segs: Segment[],
  offset: number,
  distance: number,
  tick: number = 0,
  otherWorld: boolean = false,
  chernobyl: boolean = false,
) {
  const baseIndex = Math.floor(distance / SEG_W);
  const stableNoise = (index: number, salt: number) => {
    const n = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  const edgeY = (i: number, isTop: boolean) => {
    const seg = segs[i];
    const roughness = (stableNoise(baseIndex + i, isTop ? 1 : 2) - 0.5) * 8;
    return isTop ? seg.topH + roughness : H - seg.botH - roughness;
  };
  const drawEdgePath = (isTop: boolean) => {
    for (let i = 0; i < segs.length; i++) {
      const x = i * SEG_W - offset;
      const y = edgeY(i, isTop);
      if (i === 0) ctx.lineTo(x, y);
      ctx.lineTo(x + SEG_W, y);
    }
  };

  const drawBand = (isTop: boolean) => {
    ctx.beginPath();
    if (isTop) {
      ctx.moveTo(-SEG_W, -10);
      drawEdgePath(true);
      ctx.lineTo(W + SEG_W, -10);
    } else {
      ctx.moveTo(-SEG_W, H + 10);
      drawEdgePath(false);
      ctx.lineTo(W + SEG_W, H + 10);
    }
    ctx.closePath();

    const grd = isTop
      ? ctx.createLinearGradient(0, 0, 0, H / 2)
      : ctx.createLinearGradient(0, H / 2, 0, H);
    if (otherWorld) {
      // shifting alien rainbow rock
      const h1 = (tick * 0.6) % 360;
      const h2 = (tick * 0.6 + 80) % 360;
      const h3 = (tick * 0.6 + 200) % 360;
      if (isTop) {
        grd.addColorStop(0, `hsl(${h1}, 80%, 12%)`);
        grd.addColorStop(0.6, `hsl(${h2}, 85%, 28%)`);
        grd.addColorStop(1, `hsl(${h3}, 90%, 50%)`);
      } else {
        grd.addColorStop(0, `hsl(${h3}, 90%, 50%)`);
        grd.addColorStop(0.4, `hsl(${h2}, 85%, 28%)`);
        grd.addColorStop(1, `hsl(${h1}, 80%, 10%)`);
      }
    } else if (chernobyl) {
      if (isTop) {
        grd.addColorStop(0, "#000000");
        grd.addColorStop(0.6, "#0a0a08");
        grd.addColorStop(1, "#181814");
      } else {
        grd.addColorStop(0, "#181814");
        grd.addColorStop(0.4, "#0a0a08");
        grd.addColorStop(1, "#000000");
      }
    } else if (isTop) {
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
      const y = edgeY(i, isTop);
      if (i === 0) ctx.moveTo(x, y);
      ctx.lineTo(x + SEG_W, y);
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
      const r1 = stableNoise(baseIndex + i, isTop ? 333 : 777);
      const r2 = stableNoise(baseIndex + i, isTop ? 334 : 778);
      const y = edgeY(i, isTop);
      ctx.beginPath();
      if (isTop) {
        ctx.moveTo(x, y - 8 - r1 * 30);
        ctx.lineTo(x + SEG_W * 1.5, y - 18 - r2 * 46);
      } else {
        ctx.moveTo(x, y + 8 + r1 * 30);
        ctx.lineTo(x + SEG_W * 1.5, y + 18 + r2 * 46);
      }
      ctx.stroke();
    }

    // speckles (sun-touched edges)
    ctx.fillStyle = "rgba(255,210,150,0.25)";
    for (let i = 0; i < segs.length; i++) {
      const x = i * SEG_W - offset;
      const r = stableNoise(baseIndex + i, isTop ? 111 : 555);
      if (r > 0.65) {
        const y = isTop ? edgeY(i, true) - 6 - r * 20 : edgeY(i, false) + 6 + r * 20;
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
  const trailRgb = m.trailColor ?? "220,220,230";
  for (let t = 0; t < m.trail.length; t++) {
    const p = m.trail[t];
    const a = (t / m.trail.length) * 0.55;
    const r = 1.5 + (t / m.trail.length) * 4;
    ctx.fillStyle = `rgba(${trailRgb},${a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (m.emoji) {
    ctx.save();
    ctx.translate(m.x, m.y);
    const spin = (m.spin ?? 0) + (m.x + m.y) * 0.02;
    ctx.rotate(spin);
    ctx.font = "20px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(m.emoji, 0, 0);
    ctx.restore();
    return;
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

function drawAiBuddy(ctx: CanvasRenderingContext2D, buddy: AiBuddy, tick: number) {
  const bob = Math.sin(tick * 0.055) * 1.6;
  const x = buddy.x;
  const y = buddy.y + bob;
  const danger = buddy.mood === "danger";
  const coin = buddy.mood === "coin";
  const glow = danger ? "255,90,90" : coin ? "255,220,110" : "125,249,255";
  const accent = danger ? "#ff6b6b" : coin ? "#ffd86b" : "#7df9ff";
  const lookAmount = buddy.faceTimer > 0 ? Math.min(1, buddy.faceTimer / 18) : 0;
  const lookingBack = lookAmount > 0;

  ctx.save();

  // subtle scan glow, quieter than the player's shield
  const aura = ctx.createRadialGradient(x, y, 3, x, y, 34);
  aura.addColorStop(0, `rgba(${glow},0.28)`);
  aura.addColorStop(1, `rgba(${glow},0)`);
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(x, y, 34, 0, Math.PI * 2);
  ctx.fill();

  if (buddy.shieldPulse > 0) {
    const pulse = buddy.shieldPulse / 42;
    ctx.strokeStyle = `rgba(170,245,255,${pulse})`;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = "rgba(125,249,255,0.95)";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(x, y, 24 + (1 - pulse) * 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  if (!danger && (lookingBack || buddy.mood === "scan")) {
    const sweep = ((tick * 0.018) % 1) * Math.PI * 2;
    ctx.strokeStyle = `rgba(${glow},${lookingBack ? 0.24 : 0.1})`;
    ctx.lineWidth = lookingBack ? 0.9 : 0.55;
    ctx.beginPath();
    ctx.arc(x, y, 22 + Math.sin(tick * 0.07) * 1.2, sweep, sweep + Math.PI * 0.55);
    ctx.stroke();
  }

  // small black companion plane; it only glances back briefly instead of snapping around
  const pitch = clamp(buddy.vy * 0.035, -0.09, 0.09);
  ctx.save();
  ctx.translate(x, y);

  if (lookingBack) {
    const blink = Math.sin(tick * 0.16) > 0.96;
    ctx.rotate(pitch - lookAmount * 0.08);

    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = `rgba(${glow},${0.18 - i * 0.05})`;
      ctx.beginPath();
      ctx.ellipse(-22 - i * 7, Math.sin(tick * 0.1 + i) * 1.2, 7 - i * 1.5, 2.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const jet = getJetImg();
    if (jet) {
      const w = 58;
      const h = (jet.naturalHeight / jet.naturalWidth) * w;
      const tinted = getTintedJet(jet, {
        id: "ai-buddy-black",
        name: "AI Buddy",
        price: 0,
        fuse: ["#151515", "#050505", "#000000"],
        wing: ["#151515", "#050505", "#000000"],
        accent,
        emoji: "",
      });
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(tinted, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = "#050505";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(24, 0);
      ctx.lineTo(6, -5);
      ctx.lineTo(-18, -4);
      ctx.lineTo(-18, 4);
      ctx.lineTo(6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = blink ? "rgba(255,255,255,0.9)" : accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(8 - lookAmount * 10, -1, blink ? 1.8 : 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    ctx.rotate(pitch);

    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = `rgba(${glow},${0.34 - i * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(-23 - i * 7, Math.sin(tick * 0.1 + i) * 1.2, 8 - i * 1.7, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const jet = getJetImg();
    if (jet) {
      const w = 58;
      const h = (jet.naturalHeight / jet.naturalWidth) * w;
      const tinted = getTintedJet(jet, {
        id: "ai-buddy-black",
        name: "AI Buddy",
        price: 0,
        fuse: ["#151515", "#050505", "#000000"],
        wing: ["#151515", "#050505", "#000000"],
        accent,
        emoji: "",
      });
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(tinted, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = "#050505";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(24, 0);
      ctx.lineTo(6, -5);
      ctx.lineTo(-18, -4);
      ctx.lineTo(-18, 4);
      ctx.lineTo(6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(10, -1, danger ? 3.2 + Math.sin(tick * 0.35) : 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (buddy.messageTimer > 0 && buddy.message) {
    const text = buddy.message;
    ctx.font = "bold 11px system-ui, sans-serif";
    const w = Math.min(170, Math.max(74, ctx.measureText(text).width + 18));
    const bx = clamp(x - w / 2, 8, W - w - 8);
    const by = clamp(y - 55, 8, H - 48);
    ctx.fillStyle = "rgba(0,0,0,0.68)";
    ctx.strokeStyle = `rgba(${glow},0.75)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, w, 26, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + w / 2, by + 13);
  }

  ctx.restore();
}

function drawJet(
  ctx: CanvasRenderingContext2D,
  y: number,
  isBoost: boolean,
  hasShield: boolean,
  tick: number,
  skin: Skin,
  tilt: number = 0,
) {
  ctx.save();
  ctx.translate(PLANE_X, y);
  const pitch = clamp(tilt, -0.22, 0.22);
  ctx.rotate(pitch);
  ctx.scale(1, 1 + Math.abs(pitch) * 0.08);

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

  // Vehicle skins replace the jet geometry with a giant emoji
  if (skin.vehicle) {
    // body glow tinted with accent
    const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 30);
    glow.addColorStop(0, withAlpha(skin.accent, 0.45));
    glow.addColorStop(1, withAlpha(skin.accent, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();

    // helicopter spinning rotor
    if (skin.vehicle === "helicopter") {
      const spin = tick * 0.9;
      ctx.save();
      ctx.translate(0, -14);
      ctx.rotate(spin);
      ctx.strokeStyle = "rgba(30,30,30,0.85)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-22, 0);
      ctx.lineTo(22, 0);
      ctx.stroke();
      ctx.restore();
    }

    // UFO under-glow
    if (skin.vehicle === "ufo") {
      const pulse = 0.5 + Math.sin(tick * 0.25) * 0.3;
      const beam = ctx.createRadialGradient(0, 14, 2, 0, 14, 20);
      beam.addColorStop(0, `rgba(120,255,200,${pulse})`);
      beam.addColorStop(1, "rgba(120,255,200,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.arc(0, 14, 20, 0, Math.PI * 2);
      ctx.fill();
    }

    // Dragon fire breath
    if (skin.vehicle === "dragon") {
      const fl = 14 + Math.random() * 8;
      const fg = ctx.createLinearGradient(18, 0, 18 + fl, 0);
      fg.addColorStop(0, "rgba(255,220,80,1)");
      fg.addColorStop(0.6, "rgba(255,80,20,0.8)");
      fg.addColorStop(1, "rgba(255,0,0,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(18, -4);
      ctx.lineTo(18 + fl, 0);
      ctx.lineTo(18, 4);
      ctx.closePath();
      ctx.fill();
    }

    // Giant emoji as the vehicle body
    ctx.save();
    // counter-rotate so emoji stays upright relative to screen
    ctx.rotate(-pitch);
    const wob = Math.sin(tick * 0.15) * 0.04;
    ctx.rotate(wob);
    ctx.font = "36px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(skin.emoji, 0, 0);
    ctx.restore();

    // sci-fi hex energy shield
    if (hasShield) {
      drawHexShield(ctx, tick, 24);
    }
    ctx.restore();
    return;
  }

  // ============ REALISTIC JET SPRITE (Su-34 style) ============
  // outer glow halo tinted with accent
  const halo = ctx.createRadialGradient(0, 0, 6, 0, 0, 38);
  halo.addColorStop(0, withAlpha(skin.accent, 0.22));
  halo.addColorStop(1, withAlpha(skin.accent, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, 38, 0, Math.PI * 2);
  ctx.fill();

  const jet = getJetImg();
  if (jet) {
    // Sprite faces right (+x = flight direction). Sized to roughly match prior body.
    const w = 78;
    const h = (jet.naturalHeight / jet.naturalWidth) * w;
    const tinted = getTintedJet(jet, skin);
    // Sprite faces left in source — flip horizontally so nose points in flight direction (+x)
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(tinted, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else {
    // Fallback while image loads — simple silhouette
    ctx.fillStyle = "#2a6a72";
    ctx.beginPath();
    ctx.moveTo(30, 0);
    ctx.lineTo(10, -6);
    ctx.lineTo(-20, -5);
    ctx.lineTo(-20, 5);
    ctx.lineTo(10, 6);
    ctx.closePath();
    ctx.fill();
  }

  // sci-fi hex energy shield
  if (hasShield) {
    drawHexShield(ctx, tick, 26);
  }

  ctx.restore();
}

function drawHexShield(ctx: CanvasRenderingContext2D, tick: number, r: number) {
  // movie-style hex energy shield: rotating hex tiles, bright rim, impact flicker
  const pulse = 0.55 + Math.sin(tick * 0.18) * 0.18;
  const rot = tick * 0.012;
  ctx.save();

  // forward-facing dome (right half-circle, flat side at back)
  const R = r * 1.15;
  const a0 = -Math.PI / 2;
  const a1 = Math.PI / 2;

  const domePath = () => {
    ctx.beginPath();
    ctx.moveTo(0, -R);
    ctx.arc(0, 0, R, a0, a1);
    ctx.closePath();
  };

  // inner cyan haze
  const haze = ctx.createRadialGradient(R * 0.15, 0, R * 0.15, R * 0.15, 0, R);
  haze.addColorStop(0, "rgba(120,220,255,0)");
  haze.addColorStop(0.65, "rgba(120,210,255,0.10)");
  haze.addColorStop(1, `rgba(140,230,255,${0.32 * pulse})`);
  ctx.fillStyle = haze;
  domePath();
  ctx.fill();

  // hex tessellation clipped to dome
  ctx.save();
  domePath();
  ctx.clip();
  // slow forward-sweep instead of full rotation
  const sweep = Math.sin(tick * 0.04) * 0.1;
  ctx.rotate(sweep);
  const hr = 5.2;
  const hw = Math.sqrt(3) * hr;
  const hh = 1.5 * hr;
  ctx.lineWidth = 0.7;
  for (let row = -6; row <= 6; row++) {
    for (let col = -2; col <= 6; col++) {
      const cx = col * hw + (row % 2 ? hw / 2 : 0);
      const cy = row * hh;
      const sh = 0.2 + 0.25 * (0.5 + 0.5 * Math.sin(tick * 0.08 + col * 1.3 + row * 0.7));
      ctx.strokeStyle = `rgba(150,235,255,${sh})`;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const px = cx + Math.cos(a) * hr;
        const py = cy + Math.sin(a) * hr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();

  // bright outer arc rim (no flat back line for cleaner look)
  ctx.strokeStyle = `rgba(190,245,255,${0.9 * pulse})`;
  ctx.lineWidth = 1.8;
  ctx.shadowColor = "rgba(120,220,255,0.95)";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(0, 0, R, a0, a1);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // thin inner arc rim
  ctx.strokeStyle = "rgba(220,250,255,0.55)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(0, 0, R - 2.2, a0, a1);
  ctx.stroke();

  // anchor nubs at top/bottom where dome meets plane
  ctx.fillStyle = `rgba(200,245,255,${0.85 * pulse})`;
  ctx.beginPath();
  ctx.arc(0, -R, 1.6, 0, Math.PI * 2);
  ctx.arc(0, R, 1.6, 0, Math.PI * 2);
  ctx.fill();

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

function drawPortal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tick: number,
  kind: "other" | "normal" | "chernobyl" = "other",
  anchor: "top" | "bottom" = "bottom",
) {
  // Horizontal tunnel embedded in the canyon wall — open mouth faces the player,
  // the back recedes into endless darkness (you can't see the end).
  ctx.save();
  ctx.translate(x, y);

  const mouthR = 36;

  // Color palettes per portal kind (rim color around the opening)
  const palette =
    kind === "normal"
      ? { rim: "#2a78d0", rimHi: "#9ed4ff", rimLo: "#062048", glow: "rgba(120,200,255,0.55)" }
      : kind === "chernobyl"
        ? { rim: "#3a3a2a", rimHi: "#7a7a55", rimLo: "#050505", glow: "rgba(140,170,90,0.4)" }
        : { rim: "#2ea02a", rimHi: "#b0ff8a", rimLo: "#062808", glow: "rgba(140,255,120,0.55)" };

  // outer rocky frame around the mouth — wider so the canyon "swallows" the tunnel
  const frameR = mouthR + 10;
  const rockGrad = ctx.createRadialGradient(-6, -6, mouthR * 0.5, 0, 0, frameR);
  rockGrad.addColorStop(0, "#3a2418");
  rockGrad.addColorStop(0.6, "#241208");
  rockGrad.addColorStop(1, "#0c0604");
  ctx.fillStyle = rockGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, frameR, frameR * 0.96, 0, 0, Math.PI * 2);
  ctx.fill();

  // colored rim around the opening (the "portal energy ring")
  ctx.strokeStyle = palette.rim;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, 0, mouthR, mouthR * 0.95, 0, 0, Math.PI * 2);
  ctx.stroke();
  // top-left highlight on the rim
  ctx.strokeStyle = palette.rimHi;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, mouthR, Math.PI * 1.05, Math.PI * 1.75);
  ctx.stroke();
  // bottom shadow on the rim
  ctx.strokeStyle = palette.rimLo;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, mouthR, Math.PI * 0.1, Math.PI * 0.9);
  ctx.stroke();

  // depth: concentric receding rings going darker, slightly offset back-and-up
  // so the tunnel looks like it bores into the mountain (vanishing point).
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, mouthR - 2, mouthR * 0.93, 0, 0, Math.PI * 2);
  ctx.clip();

  const rings = 14;
  for (let i = 0; i < rings; i++) {
    const k = i / rings;
    const rr = (mouthR - 2) * (1 - k);
    const ox = -k * 10; // vanishing point shifts backward (into the wall, "left")
    const oy = -k * 2;
    const shade = Math.round(20 * (1 - k));
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.beginPath();
    ctx.ellipse(ox, oy, rr, rr * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // pitch-black core — the "end" you cannot see
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.ellipse(-10, -2, mouthR * 0.18, mouthR * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  // faint swirling energy near the mouth (in front of the dark depth)
  const t = tick * 0.08;
  for (let i = 0; i < 3; i++) {
    const hue = (t * 50 + i * 60) % 360;
    ctx.fillStyle = `hsla(${hue}, 95%, 60%, 0.18)`;
    const ang = t + i;
    const rx = (mouthR - 6) * (0.9 - i * 0.15);
    const ry = mouthR * 0.85 * (0.9 - i * 0.15);
    ctx.beginPath();
    ctx.ellipse(Math.cos(ang) * 3, Math.sin(ang * 1.3) * 2, rx, ry, ang, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // outer glow halo around the mouth
  const halo = ctx.createRadialGradient(0, 0, mouthR * 0.9, 0, 0, mouthR * 1.6);
  halo.addColorStop(0, palette.glow);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(0, 0, mouthR * 1.6, mouthR * 1.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // sparkles spilling forward from the mouth
  for (let i = 0; i < 5; i++) {
    const a = t * 1.4 + (i * Math.PI * 2) / 5;
    const r = mouthR + 4 + Math.sin(t * 2 + i) * 3;
    ctx.fillStyle = `hsla(${(t * 120 + i * 80) % 360}, 100%, 75%, 0.85)`;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.6, 1.6, 0, Math.PI * 2);
    ctx.fill();
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

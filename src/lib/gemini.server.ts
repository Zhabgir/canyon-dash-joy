import { getServerConfig } from "./config.server";

type GeminiPart = {
  text?: string;
};

type GeminiResponse = {
  candidates?: {
    content?: {
      parts?: GeminiPart[];
    };
  }[];
  error?: {
    message?: string;
  };
};

export interface BuddyLineInput {
  event: "danger" | "narrow" | "shield" | "coin" | "revive" | "start";
  score: number;
  coins: number;
  mapName?: string;
}

const FALLBACK_LINES: Record<BuddyLineInput["event"], string> = {
  danger: "Опасность впереди!",
  narrow: "Узкий проход!",
  shield: "Аварийный щит!",
  coin: "Монеты справа!",
  revive: "Держись, пилот!",
  start: "Сканирую маршрут.",
};

function cleanLine(text: string, fallback: string) {
  const firstLine = text
    .replace(/["'`]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) return fallback;
  return firstLine.length > 32 ? `${firstLine.slice(0, 29).trim()}...` : firstLine;
}

export async function generateBuddyLine(input: BuddyLineInput) {
  const config = getServerConfig();
  const fallback = FALLBACK_LINES[input.event];
  const apiKey = config.geminiApiKey?.trim();

  if (!apiKey || apiKey.startsWith("replace-with")) {
    return { line: fallback, source: "fallback" as const };
  }

  const model = config.geminiModel;
  const prompt = [
    "Ты AI-напарник в аркадной игре Space Rush.",
    "Ответь одной короткой репликой на русском для пилота.",
    "Максимум 3 слова. Без кавычек, эмодзи и пояснений.",
    `Событие: ${input.event}.`,
    `Счет: ${Math.max(0, Math.floor(input.score))}.`,
    `Монеты за забег: ${Math.max(0, Math.floor(input.coins))}.`,
    input.mapName ? `Карта: ${input.mapName}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent`,
  );
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 10,
      },
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as GeminiResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Gemini request failed: ${response.status}`);
  }

  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  return {
    line: cleanLine(text ?? "", fallback),
    source: "gemini" as const,
  };
}

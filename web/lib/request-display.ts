import type { Locale } from "@/lib/i18n";
import type { PetRequest, RequestStatus } from "@/lib/request-catalog";

export function isOpenRequest(request: Pick<PetRequest, "state" | "status">) {
  return (
    request.state === "open" &&
    request.status !== "completed" &&
    request.status !== "declined"
  );
}

const defaultFieldLabels: Record<string, Record<Locale, string>> = {
  "Not provided": {
    en: "Not provided",
    zh: "未提供",
    ko: "제공되지 않음",
    ja: "未提供",
    es: "No se proporcionó",
  },
  "Let the community maker decide.": {
    en: "Let the community maker decide.",
    zh: "由社区制作者决定。",
    ko: "커뮤니티 제작자에게 맡깁니다.",
    ja: "コミュニティの制作者にお任せします。",
    es: "A elección del creador de la comunidad.",
  },
};

export function getRequestDisplayText(value: string, locale: Locale) {
  return defaultFieldLabels[value]?.[locale] ?? value;
}

const statusLabels: Record<RequestStatus, Record<Locale, string>> = {
  triage: {
    en: "Awaiting production",
    zh: "待制作",
    ko: "제작 대기",
    ja: "制作待ち",
    es: "Pendiente de producción",
  },
  open: {
    en: "Open",
    zh: "待认领",
    ko: "모집 중",
    ja: "募集中",
    es: "Abierta",
  },
  "in-progress": {
    en: "In production",
    zh: "制作中",
    ko: "제작 중",
    ja: "制作中",
    es: "En producción",
  },
  review: {
    en: "In review",
    zh: "审查中",
    ko: "검토 중",
    ja: "レビュー中",
    es: "En revisión",
  },
  completed: {
    en: "Published",
    zh: "已完成",
    ko: "게시됨",
    ja: "公開済み",
    es: "Publicada",
  },
  declined: {
    en: "Closed",
    zh: "已关闭",
    ko: "종료",
    ja: "終了",
    es: "Cerrada",
  },
};

const categoryLabels: Record<string, Record<Locale, string>> = {
  animal: {
    en: "Animals",
    zh: "动物",
    ko: "동물",
    ja: "動物",
    es: "Animales",
  },
  anime: {
    en: "Anime",
    zh: "动漫角色",
    ko: "애니메이션",
    ja: "アニメ",
    es: "Anime",
  },
  game: {
    en: "Games",
    zh: "游戏角色",
    ko: "게임",
    ja: "ゲーム",
    es: "Videojuegos",
  },
  mascot: {
    en: "Mascots",
    zh: "吉祥物",
    ko: "마스코트",
    ja: "マスコット",
    es: "Mascotas",
  },
  meme: { en: "Memes", zh: "梗图", ko: "밈", ja: "ミーム", es: "Memes" },
  object: {
    en: "Objects",
    zh: "物品",
    ko: "사물",
    ja: "オブジェクト",
    es: "Objetos",
  },
  original: {
    en: "Original",
    zh: "原创角色",
    ko: "오리지널",
    ja: "オリジナル",
    es: "Original",
  },
  other: { en: "Other", zh: "其他", ko: "기타", ja: "その他", es: "Otros" },
  robot: {
    en: "Robots",
    zh: "机器人",
    ko: "로봇",
    ja: "ロボット",
    es: "Robots",
  },
};

export function getRequestStatusLabel(status: RequestStatus, locale: Locale) {
  return statusLabels[status][locale];
}

export function getRequestCategoryLabel(category: string, locale: Locale) {
  return categoryLabels[category]?.[locale] ?? category;
}

export function formatRequestDate(value: string, locale: Locale) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const dateLocale = {
    en: "en-US",
    zh: "zh-CN",
    ko: "ko-KR",
    ja: "ja-JP",
    es: "es-ES",
  }[locale];
  return new Intl.DateTimeFormat(dateLocale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

export function requestExcerpt(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

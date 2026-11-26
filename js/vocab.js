/** Shared closet vocabulary: palette, slots, and image paths. */

export const OCCASIONS = [
  "everyday",
  "work",
  "party",
  "date",
  "night-out",
  "interview",
  "referee-travel",
  "gym",
  "2000s",
];

export const OCCASION_LABELS = {
  everyday: "Everyday",
  work: "Work",
  party: "Party",
  date: "Date",
  "night-out": "Night out",
  interview: "Interview",
  "referee-travel": "Referee travel",
  gym: "Gym",
  "2000s": "2000s",
};

export const COLORS = [
  "black",
  "white",
  "ecru",
  "grey",
  "charcoal",
  "navy",
  "blue",
  "light-blue",
  "beige",
  "camel",
  "brown",
  "olive",
  "green",
  "burgundy",
  "red",
  "purple",
  "silver",
  "gold",
  "other",
];

export const COLOR_HEX = {
  black: "#1c1c1c",
  white: "#f7f7f5",
  ecru: "#f3ead7",
  grey: "#9b9b96",
  charcoal: "#3a3a3a",
  navy: "#1c2744",
  blue: "#3d6f9a",
  "light-blue": "#b7d0e4",
  beige: "#e0d0b0",
  camel: "#c4a06a",
  brown: "#6d4a2e",
  olive: "#6d7348",
  green: "#3f6b4e",
  burgundy: "#722838",
  red: "#b4232c",
  purple: "#6d4f86",
  silver: "#c8c8cc",
  gold: "#c6a15b",
  other: "#b7b3ab",
};

export const STATUSES = ["owned", "wishlist", "ordered", "archived"];
export const CATEGORIES = ["outerwear", "top", "bottom", "shoes", "accessory"];
export const FORMALITIES = ["formal", "smart-casual", "casual", "sport"];
export const FITS = ["slim", "regular", "relaxed", "oversized", "cropped"];
export const LAYERS = ["base", "mid", "outer"];
export const TONES = ["neutral", "earth", "cool", "warm", "accent"];
export const PATTERNS = ["solid", "striped", "dotted", "checked", "graphic", "textured"];
export const SEASONS = ["spring", "summer", "autumn", "winter"];
export const WASH_METHODS = ["machine", "delicate", "hand", "dry-clean", "wipe"];
export const IRONS = ["none", "low", "medium", "high", "steam"];

export const FORMALITY_RANK = {
  sport: 0,
  casual: 1,
  "smart-casual": 2,
  formal: 3,
};

/** Neutrals pair freely — no clash penalty between these. */
export const NEUTRALS = new Set([
  "black",
  "white",
  "ecru",
  "grey",
  "charcoal",
  "navy",
  "beige",
  "camel",
]);

export const LIGHT_COLORS = new Set([
  "white",
  "ecru",
  "beige",
  "camel",
  "light-blue",
  "grey",
  "silver",
  "gold",
]);

export const DARK_COLORS = new Set([
  "black",
  "charcoal",
  "navy",
  "brown",
  "burgundy",
  "olive",
  "blue",
]);

export const HEAVY_OUTER = new Set(["puffer", "coat"]);

export function colorHex(name) {
  return COLOR_HEX[name] || COLOR_HEX.other;
}

export function labelize(value) {
  if (value == null || value === "") return "";
  if (OCCASION_LABELS[value]) return OCCASION_LABELS[value];
  return String(value)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Resolve `items[].image` for the page.
 * Relative paths stay relative to the app root (GitHub Pages project site).
 * Absolute URLs and data-URLs pass through. Null stays null.
 */
export function imageSrc(image) {
  if (image == null || image === "") return null;
  const value = String(image).trim();
  if (!value) return null;
  if (/^(data:|https?:|blob:)/i.test(value)) return value;
  return value.replace(/^\/+/, "");
}

import { compatiblePieces, scoreOutfit, suggestOutfits, swapPiece } from "./engine.js";
import { forecastFromMeteo } from "./weather.js";
import { mergeCloset } from "./merge.js";
import {
  archiveItem,
  blankItem,
  lisbonToday,
  lisbonTimestamp,
  logWorn,
  newItemId,
  normalizeCloset,
  rateWear,
  saveOutfit,
  setStatus,
  toggleFavorite,
  upsertItem,
} from "./model.js";
import {
  CATEGORIES,
  COLORS,
  FITS,
  FORMALITIES,
  IRONS,
  LAYERS,
  OCCASIONS,
  PATTERNS,
  SEASONS,
  STATUSES,
  TONES,
  WASH_METHODS,
  colorHex,
  imageSrc,
  labelize,
} from "./vocab.js";

globalThis.ClosetMerge = { mergeCloset };

const STORAGE_KEY = "closet-v1";
const WEATHER_KEY = "closet-weather";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=41.4425&longitude=-8.2918&current=temperature_2m,apparent_temperature,precipitation,precipitation_probability&daily=apparent_temperature_mean,precipitation_sum,precipitation_probability_max&timezone=Europe%2FLisbon&forecast_days=1";

const SILHOUETTE = {
  outerwear: '<path d="M40 12c5 7 11 9 18 9l7 58H15l7-58c7 0 13-2 18-9z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M40 14v64M27 38h26" stroke="currentColor" stroke-width="2.2" fill="none"/>',
  coat: '<path d="M40 12c5 7 11 9 18 9l7 58H15l7-58c7 0 13-2 18-9z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M40 14v64M27 38h26" stroke="currentColor" stroke-width="2.2" fill="none"/>',
  puffer: '<path d="M30 16h20l6 62H24L30 16z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M28 34h24M28 48h24M28 62h24" stroke="currentColor" stroke-width="2.2"/>',
  top: '<path d="M28 18 18 28l6 6 4-4v42h24V30l4 4 6-6-10-10c-4 5-8 7-14 7s-10-2-14-7z" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  bottom: '<path d="M30 16h20l4 68H42l-2-40-2 40H26L30 16z" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  shoes: '<path d="M16 46h30l14 6c4 2 6 6 4 8H18c-6 0-10-4-8-10z" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  sneakers: '<path d="M16 46h30l14 6c4 2 6 6 4 8H18c-6 0-10-4-8-10z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M24 46l4 14M34 44l3 16" stroke="currentColor" stroke-width="2.2"/>',
  watch: '<circle cx="40" cy="50" r="14" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M34 18h12l-2 16H36zm0 48h12l-2-16H36zM40 50V42" stroke="currentColor" stroke-width="2.2" fill="none"/>',
  ring: '<ellipse cx="40" cy="58" rx="16" ry="10" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M32 52c2-16 14-16 16 0" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  sunglasses: '<rect x="12" y="42" width="22" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="46" y="42" width="22" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M34 48h12M10 46H6M70 46h4" stroke="currentColor" stroke-width="2.2" fill="none"/>',
  chain: '<ellipse cx="28" cy="42" rx="8" ry="12" fill="none" stroke="currentColor" stroke-width="2.2"/><ellipse cx="44" cy="54" rx="8" ry="12" fill="none" stroke="currentColor" stroke-width="2.2"/><ellipse cx="56" cy="40" rx="7" ry="10" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  belt: '<path d="M14 46h52v12H14z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M34 44h12v16H34zM38 52h4" stroke="currentColor" stroke-width="2.2" fill="none"/>',
  accessory: '<circle cx="40" cy="48" r="14" fill="none" stroke="currentColor" stroke-width="2.2"/>',
};

const SUBCATEGORIES = ["coat", "puffer", "jacket", "shirt-jacket", "t-shirt", "shirt", "turtleneck", "crewneck", "hoodie", "trousers", "chinos", "jeans", "sneakers", "boots", "watch", "chain", "ring", "belt", "sunglasses"];

let state = null;
const ui = {
  view: "today",
  occasion: "everyday",
  weather: { tempC: 16, rain: false, source: "loading", manual: false },
  suggestions: [],
  index: 0,
  savedId: null,
  filters: { status: "owned", category: "all", formality: "all", color: "all", occasion: "all", q: "" },
  sheet: null,
  detailId: null,
  editItem: null,
  imageOverride: undefined,
  swapSlot: null,
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

function githubLinked() {
  try {
    const cfg = JSON.parse(localStorage.getItem("dong-gh-sync") || "null");
    return !!(cfg && cfg.token);
  } catch {
    return false;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast("Saved in memory only — this phone is out of storage space.");
  }
}

function currentCtx() {
  return {
    tempC: Number(ui.weather.tempC),
    rain: !!ui.weather.rain,
    occasion: ui.occasion,
    today: lisbonToday(),
    wearLog: state?.wearLog || [],
  };
}

function recompute() {
  if (!state) return;
  ui.suggestions = suggestOutfits(state.items, state.wearLog, currentCtx());
  if (ui.index >= ui.suggestions.length) ui.index = 0;
}

function itemById(id) {
  return state.items.find((item) => item.id === id) || null;
}

function savedOutfit() {
  if (!ui.savedId) return null;
  return state.outfits.find((outfit) => outfit.id === ui.savedId) || null;
}

function slotsFromIds(itemIds) {
  const slots = { outer: null, mid: null, base: null, bottom: null, shoes: null, accessories: [] };
  for (const id of itemIds || []) {
    const piece = itemById(id);
    if (!piece) continue;
    if (piece.category === "accessory") slots.accessories.push(piece);
    else if (piece.category === "bottom") slots.bottom = piece;
    else if (piece.category === "shoes") slots.shoes = piece;
    else if (piece.layer === "mid") slots.mid = piece;
    else if (piece.layer === "outer" || piece.category === "outerwear") slots.outer = piece;
    else slots.base = piece;
  }
  return slots;
}

function activeLook() {
  const saved = savedOutfit();
  if (saved) {
    const slots = slotsFromIds(saved.itemIds);
    const scored = scoreOutfit(slots, currentCtx());
    return {
      ...scored,
      slots,
      itemIds: saved.itemIds.slice(),
      why: saved.notes || scored.why,
      saved,
    };
  }
  return ui.suggestions[ui.index] || null;
}

function prettyDate(iso) {
  const [year, month, day] = String(iso || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "—";
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function weatherSourceLabel() {
  if (ui.weather.source === "loading") return "Checking Guimarães…";
  if (ui.weather.source === "manual") return "Manual weather";
  if (ui.weather.source === "offline") return "Offline — set the weather yourself";
  return "Live · Guimarães";
}

function placeholderInner(item) {
  const hex = colorHex(item.colors?.primary);
  const icon = SILHOUETTE[item.subCategory] || SILHOUETTE[item.category] || SILHOUETTE.top;
  return `<span class="swatch" style="background:${hex}"></span>
    <svg viewBox="0 0 80 100" aria-hidden="true">${icon}</svg>
    <span class="ph-label">${esc(labelize(item.colors?.primary || "color"))}</span>`;
}

function frameHtml(item, alt) {
  const src = imageSrc(item?.image);
  if (!item) return `<div class="frame"><div class="ph"><span class="ph-label">Missing</span></div></div>`;
  if (!src) return `<div class="frame"><div class="ph">${placeholderInner(item)}</div></div>`;
  return `<div class="frame"><img src="${esc(src)}" alt="${esc(alt || item.name)}" data-ph="1"><div class="ph" hidden>${placeholderInner(item)}</div></div>`;
}

function carePills(item) {
  const care = item.care || {};
  const pills = [];
  if (care.washTempC != null) pills.push(care.washTempC === 0 ? "No wash" : `${care.washTempC}°`);
  if (care.washMethod) pills.push(labelize(care.washMethod));
  if (care.tumbleDry === false) pills.push("No tumble");
  if (care.tumbleDry === true) pills.push("Tumble dry");
  if (care.iron) pills.push(`Iron ${care.iron}`);
  return pills;
}

function tagsHtml(item) {
  const hex = colorHex(item.colors?.primary);
  const pills = [
    `<span class="pill"><span class="dot" style="background:${hex}"></span>${esc(labelize(item.colors?.primary))}</span>`,
    `<span class="pill">${esc(labelize(item.formality))}</span>`,
  ];
  if (item.fit) pills.push(`<span class="pill">${esc(labelize(item.fit))}</span>`);
  for (const care of carePills(item).slice(0, 2)) pills.push(`<span class="pill">${esc(care)}</span>`);
  if (item.status && item.status !== "owned") pills.push(`<span class="pill status-${esc(item.status)}">${esc(labelize(item.status))}</span>`);
  return `<div class="tags">${pills.join("")}</div>`;
}

function tileHtml(item, slot, label) {
  if (!item) return "";
  return `<button type="button" class="tile" data-action="swap" data-slot="${esc(slot)}">
    ${frameHtml(item)}
    <p class="slot-label">${esc(label)}</p>
    <p class="piece-name">${esc(item.name)}</p>
    <p class="piece-sub">${esc(labelize(item.subCategory || item.category))}</p>
    ${tagsHtml(item)}
  </button>`;
}

function lookTiles(look) {
  const slots = look.slots;
  const tiles = [];
  if (slots.outer) tiles.push(tileHtml(slots.outer, "outer", "Outerwear"));
  if (slots.mid) tiles.push(tileHtml(slots.mid, "mid", "Mid layer"));
  if (slots.base) tiles.push(tileHtml(slots.base, "base", "Top"));
  if (slots.bottom) tiles.push(tileHtml(slots.bottom, "bottom", "Bottom"));
  if (slots.shoes) tiles.push(tileHtml(slots.shoes, "shoes", "Shoes"));
  (slots.accessories || []).forEach((item, index) => {
    tiles.push(tileHtml(item, `accessory:${index}`, labelize(item.subCategory || "Accessory")));
  });
  return tiles.join("");
}

function safeHref(url) {
  return /^https?:\/\//i.test(url || "") ? url : "";
}

function lookHtml() {
  const look = activeLook();
  if (!look) {
    return `<div class="empty"><h2>Nothing fits this brief</h2><p class="muted">No owned pieces match this occasion and temperature. Try Everyday, or move the temperature a little.</p></div>`;
  }
  const saved = look.saved;
  const unowned = (look.itemIds || []).map(itemById).filter((item) => item && item.status !== "owned");
  const ranks = ui.savedId ? "" : `<div class="ranks" role="tablist" aria-label="Suggested looks">${ui.suggestions.map((outfit, index) => `<button type="button" class="rank" role="tab" data-action="rank" data-index="${index}" aria-selected="${index === ui.index ? "true" : "false"}">${index + 1}</button>`).join("")}</div>`;
  const banner = saved
    ? `<p class="banner"><strong>${esc(saved.name)}</strong>${unowned.length ? " · includes pieces that are not owned yet." : ""} <button type="button" class="text-btn" data-action="clear-saved">Back to suggestions</button></p>`
    : "";
  return `${banner}${ranks}<p class="hint">Tap a piece to swap it.</p><div class="board" id="look-board">${lookTiles(look)}</div><p class="why">${esc(look.why || "")}</p><div class="actions"><button type="button" class="ui-btn" data-action="log">Log as worn today</button><button type="button" class="ui-btn ui-btn-ghost" data-action="open-save">Save outfit</button><button type="button" class="ui-btn ui-btn-ghost" data-action="open-saved">Saved outfits</button></div>`;
}

function todayHtml() {
  const temp = Math.round(Number(ui.weather.tempC));
  return `<section class="view" id="view-today">
    <section class="ui-card weather">
      <div class="weather-top">
        <div>
          <p class="eyebrow">Today</p>
          <p class="temp-readout" id="temp-readout">${temp}°C</p>
          <p class="weather-source" id="weather-source">${esc(weatherSourceLabel())}</p>
        </div>
      </div>
      <div class="weather-controls">
        <button type="button" class="stepper" data-action="temp-step" data-delta="-1" aria-label="Cooler">−</button>
        <input class="temp-slider" id="temp" type="range" min="-5" max="38" step="1" value="${temp}" aria-label="Temperature" />
        <button type="button" class="stepper" data-action="temp-step" data-delta="1" aria-label="Warmer">+</button>
      </div>
      <div class="weather-row">
        <button type="button" class="rain-toggle" id="rain-toggle" data-action="rain" aria-pressed="${ui.weather.rain ? "true" : "false"}">${ui.weather.rain ? "Rain" : "Dry"}</button>
        <button type="button" class="text-btn" data-action="use-live">Use live weather</button>
      </div>
    </section>
    <div class="chips" role="group" aria-label="Occasion">${OCCASIONS.map((occasion) => `<button type="button" class="chip" data-action="occasion" data-occasion="${esc(occasion)}" aria-pressed="${ui.occasion === occasion ? "true" : "false"}">${esc(labelize(occasion))}</button>`).join("")}</div>
    <div id="look-root">${lookHtml()}</div>
  </section>`;
}

function filteredItems() {
  const filters = ui.filters;
  const query = filters.q.trim().toLowerCase();
  return state.items.filter((item) => {
    if (filters.status !== "all" && item.status !== filters.status) return false;
    if (filters.category !== "all" && item.category !== filters.category) return false;
    if (filters.formality !== "all" && item.formality !== filters.formality) return false;
    if (filters.color !== "all" && item.colors?.primary !== filters.color) return false;
    if (filters.occasion !== "all" && !(item.occasions || []).includes(filters.occasion)) return false;
    if (!query) return true;
    const hay = [item.name, item.care?.brand, item.subCategory, item.colors?.primary, item.pairing?.notes, ...(item.occasions || [])].join(" ").toLowerCase();
    return hay.includes(query);
  }).sort((a, b) => Number(b.meta?.favorite) - Number(a.meta?.favorite) || a.name.localeCompare(b.name));
}

function chipRow(label, key, options) {
  const current = ui.filters[key];
  return `<div class="chips" role="group" aria-label="${esc(label)}">${options.map(([value, text]) => `<button type="button" class="chip" data-action="filter" data-key="${esc(key)}" data-value="${esc(value)}" aria-pressed="${current === value ? "true" : "false"}">${esc(text)}</button>`).join("")}</div>`;
}

function closetHtml() {
  const items = filteredItems();
  const counts = STATUSES.map((status) => [status, state.items.filter((item) => item.status === status).length]);
  return `<section class="view" id="view-closet">
    <div class="toolbar">
      <input class="search" id="search" type="search" placeholder="Search name, brand, color" value="${esc(ui.filters.q)}" aria-label="Search wardrobe" />
      <button type="button" class="ui-btn" data-action="open-new">Add</button>
    </div>
    ${chipRow("Status", "status", [["all", "All"], ...counts.map(([status, count]) => [status, `${labelize(status)} ${count}`])])}
    ${chipRow("Category", "category", [["all", "All"], ...CATEGORIES.map((category) => [category, labelize(category)])])}
    <div class="weather-row">
      <button type="button" class="text-btn" data-action="open-filters">Formality, color, occasion</button>
      <p class="muted" id="result-count" style="margin:0">${items.length} pieces</p>
    </div>
    <div class="grid" id="grid-root">${items.map(cardHtml).join("") || `<p class="empty muted">No pieces match these filters.</p>`}</div>
  </section>`;
}

function cardHtml(item) {
  return `<button type="button" class="card-hit catalog-card" data-action="open-detail" data-id="${esc(item.id)}">
    ${frameHtml(item)}
    <p class="piece-name">${esc(item.name)}</p>
    <div class="tags">
      <span class="pill"><span class="dot" style="background:${colorHex(item.colors?.primary)}"></span>${esc(labelize(item.colors?.primary))}</span>
      <span class="pill">${esc(labelize(item.formality))}</span>
      <span class="pill status-${esc(item.status)}">${esc(labelize(item.status))}</span>
    </div>
  </button>`;
}

function historyHtml() {
  const entries = state.wearLog.map((entry, index) => ({ entry, index })).sort((a, b) => {
    if (a.entry.date === b.entry.date) return b.index - a.index;
    return a.entry.date < b.entry.date ? 1 : -1;
  });
  if (!entries.length) {
    return `<section class="view" id="view-history"><div class="empty"><h2>No wears yet</h2><p class="muted">Log today's look and it will show up here, newest first.</p></div></section>`;
  }
  return `<section class="view" id="view-history"><div class="history-list">${entries.map(({ entry }) => historyCard(entry)).join("")}</div></section>`;
}

function historyCard(entry) {
  const pieces = (entry.itemIds || []).map((id) => itemById(id)).filter(Boolean);
  const stars = [1, 2, 3, 4, 5].map((star) => `<button type="button" class="star" data-action="rate" data-id="${esc(entry.id)}" data-star="${star}" aria-pressed="${entry.rating >= star ? "true" : "false"}" aria-label="${star} star${star === 1 ? "" : "s"}">★</button>`).join("");
  const chips = (entry.itemIds || []).map((id) => {
    const piece = itemById(id);
    const name = piece?.name || id;
    const dot = piece ? `<span class="dot" style="background:${colorHex(piece.colors?.primary)}"></span>` : "";
    return `<button type="button" class="mini-chip" data-action="open-detail" data-id="${esc(id)}">${dot}${esc(name)}</button>`;
  }).join("");
  return `<article class="ui-card history-card">
    <p class="eyebrow">${esc(prettyDate(entry.date))}</p>
    <h2>${esc(labelize(entry.occasion || "everyday"))}</h2>
    <p class="muted">${entry.tempC == null ? "Weather not recorded" : `${esc(entry.tempC)}°C · ${entry.rain ? "rain" : "dry"}`}${entry.notes ? ` · ${esc(entry.notes)}` : ""}</p>
    <div class="piece-chips">${chips}</div>
    ${pieces.length ? `<div class="grid" style="margin-top:0.7rem">${pieces.slice(0, 4).map((piece) => `<div>${frameHtml(piece)}</div>`).join("")}</div>` : ""}
    <div class="stars" role="group" aria-label="Rating">${stars}</div>
  </article>`;
}

function viewHtml() {
  if (!state) return `<section class="view"><p>Loading wardrobe…</p></section>`;
  if (ui.view === "closet") return closetHtml();
  if (ui.view === "history") return historyHtml();
  return todayHtml();
}

function sheetWrap(title, body) {
  return `<div class="sheet-back" data-action="sheet-back"><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-handle"></div><div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-action="close" aria-label="Close">×</button></div>${body}</section></div>`;
}

function detailHtml(item) {
  const care = item.care || {};
  const weather = item.weather || {};
  const pairing = item.pairing || {};
  const meta = item.meta || {};
  const lines = [
    care.brand || "Unbranded",
    [care.size, care.fabric].filter(Boolean).join(" · "),
    care.washTempC == null ? "" : care.washTempC === 0 ? "Do not machine wash" : `Wash ${care.washTempC}°C${care.washMethod ? ` · ${labelize(care.washMethod)}` : ""}`,
    care.tumbleDry == null ? "" : care.tumbleDry ? "Tumble dry allowed" : "Do not tumble dry",
    care.iron ? `Iron ${care.iron}` : "",
    care.notes || "",
  ].filter(Boolean);
  const range = weather.tempMinC == null && weather.tempMaxC == null
    ? "Any temperature"
    : `${weather.tempMinC ?? "–"}–${weather.tempMaxC ?? "–"}°C`;
  return sheetWrap(item.name, `
    <div class="detail-hero">${frameHtml(item)}</div>
    <div class="tags">
      <span class="pill status-${esc(item.status)}">${esc(labelize(item.status))}</span>
      <span class="pill">${esc(labelize(item.category))}${item.subCategory ? ` · ${esc(labelize(item.subCategory))}` : ""}</span>
      <span class="pill">${esc(labelize(item.formality))}</span>
      ${item.fit ? `<span class="pill">${esc(labelize(item.fit))}</span>` : ""}
      <span class="pill"><span class="dot" style="background:${colorHex(item.colors?.primary)}"></span>${esc(labelize(item.colors?.primary))} · ${esc(labelize(item.colors?.tone))} · ${esc(labelize(item.colors?.pattern))}</span>
    </div>
    <div class="care-label"><strong>Care label</strong>${lines.map((line) => `<p>${esc(line)}</p>`).join("")}</div>
    <div class="block"><h3>Weather</h3><p class="muted">${esc(range)} · ${weather.rainOk ? "Rain ok" : "Avoid rain"} · ${weather.windOk ? "Wind ok" : "Avoid wind"}</p><div class="tags">${(weather.seasons || []).map((season) => `<span class="pill">${esc(labelize(season))}</span>`).join("")}</div></div>
    <div class="block"><h3>Occasions</h3><div class="tags">${(item.occasions || []).map((occasion) => `<span class="pill">${esc(labelize(occasion))}</span>`).join("") || "<span class='muted'>None</span>"}</div></div>
    <div class="block"><h3>Pairing</h3><p>${esc(pairing.notes || "No styling note yet.")}</p><p class="muted">Works with ${esc((pairing.pairsWellWith || []).join(", ") || "—")}</p><p class="muted">Avoid ${esc((pairing.avoidWith || []).join(", ") || "—")}</p></div>
    <div class="block"><h3>Wear</h3><p>${meta.wearCount || 0} wears · last ${meta.lastWornAt ? esc(prettyDate(meta.lastWornAt)) : "not worn yet"}${meta.favorite ? " · favorite" : ""}</p>${meta.priceEur != null ? `<p>${esc(meta.priceEur)} EUR</p>` : ""}${safeHref(meta.productUrl) ? `<p><a class="link" href="${esc(safeHref(meta.productUrl))}" target="_blank" rel="noopener noreferrer">Product page</a></p>` : ""}</div>
    <div class="stack">
      <button type="button" class="ui-btn ui-btn-ghost" data-action="favorite" data-id="${esc(item.id)}">${meta.favorite ? "Unfavorite" : "Favorite"}</button>
      ${item.status !== "owned" ? `<button type="button" class="ui-btn" data-action="mark-owned" data-id="${esc(item.id)}">Mark as owned</button>` : ""}
      <button type="button" class="ui-btn" data-action="open-edit" data-id="${esc(item.id)}">Edit piece</button>
      ${item.status !== "archived" ? `<button type="button" class="ui-btn danger" data-action="archive" data-id="${esc(item.id)}">Archive</button>` : ""}
    </div>`);
}

function optionList(values, selected, labels = {}) {
  return values.map((value) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(labels[value] || labelize(value))}</option>`).join("");
}

function checks(name, values, selected) {
  const set = new Set(selected || []);
  return `<div class="check-grid">${values.map((value) => `<label><input type="checkbox" name="${esc(name)}" value="${esc(value)}"${set.has(value) ? " checked" : ""} />${esc(labelize(value))}</label>`).join("")}</div>`;
}

function editHtml() {
  const item = ui.editItem;
  const creating = !state.items.some((row) => row.id === item.id);
  const pathOverride = ui.imageOverride && !String(ui.imageOverride).startsWith("data:") ? ui.imageOverride : "";
  const imageValue = ui.imageOverride === null ? "" : pathOverride || (item.image && !String(item.image).startsWith("data:") ? item.image : "");
  const preview = ui.imageOverride === null ? null : (ui.imageOverride || item.image);
  const previewItem = preview ? { ...item, image: preview } : null;
  return sheetWrap(creating ? "Add piece" : "Edit piece", `
    <form id="piece-form" class="stack">
      <div class="form-grid two">
        <label class="field">Name<input name="name" required value="${esc(item.name)}" /></label>
        <label class="field">Status<select name="status">${optionList(STATUSES, item.status)}</select></label>
        <label class="field">Category<select name="category">${optionList(CATEGORIES, item.category)}</select></label>
        <label class="field">Subcategory<input name="subCategory" list="subcats" value="${esc(item.subCategory || "")}" /></label>
        <label class="field">Layer<select name="layer"><option value="">None</option>${optionList(LAYERS, item.layer || "")}</select></label>
        <label class="field">Formality<select name="formality">${optionList(FORMALITIES, item.formality)}</select></label>
        <label class="field">Fit<select name="fit"><option value="">None</option>${optionList(FITS, item.fit || "")}</select></label>
        <label class="field">Primary color<select name="primary">${optionList(COLORS, item.colors?.primary || "black")}</select></label>
        <label class="field">Tone<select name="tone">${optionList(TONES, item.colors?.tone || "neutral")}</select></label>
        <label class="field">Pattern<select name="pattern">${optionList(PATTERNS, item.colors?.pattern || "solid")}</select></label>
      </div>
      <label class="field">Secondary colors<input name="secondary" value="${esc((item.colors?.secondary || []).join(", "))}" placeholder="white, navy" /></label>
      <datalist id="subcats">${SUBCATEGORIES.map((value) => `<option value="${esc(value)}"></option>`).join("")}</datalist>
      <div class="block"><h3>Care label</h3><div class="form-grid two">
        <label class="field">Brand<input name="brand" value="${esc(item.care?.brand || "")}" /></label>
        <label class="field">Size<input name="size" value="${esc(item.care?.size || "")}" /></label>
        <label class="field">Fabric<input name="fabric" value="${esc(item.care?.fabric || "")}" /></label>
        <label class="field">Wash °C<input name="washTempC" inputmode="numeric" value="${item.care?.washTempC ?? ""}" /></label>
        <label class="field">Wash method<select name="washMethod"><option value="">Unknown</option>${optionList(WASH_METHODS, item.care?.washMethod || "")}</select></label>
        <label class="field">Tumble dry<select name="tumbleDry"><option value="">Unknown</option><option value="yes"${item.care?.tumbleDry === true ? " selected" : ""}>Yes</option><option value="no"${item.care?.tumbleDry === false ? " selected" : ""}>No</option></select></label>
        <label class="field">Iron<select name="iron"><option value="">Unknown</option>${optionList(IRONS, item.care?.iron || "")}</select></label>
      </div><label class="field">Care notes<textarea name="careNotes">${esc(item.care?.notes || "")}</textarea></label></div>
      <div class="block"><h3>Weather</h3>
        <label class="field">Seasons${checks("season", SEASONS, item.weather?.seasons)}</label>
        <div class="form-grid two">
          <label class="field">Min °C<input name="tempMinC" inputmode="numeric" value="${item.weather?.tempMinC ?? ""}" /></label>
          <label class="field">Max °C<input name="tempMaxC" inputmode="numeric" value="${item.weather?.tempMaxC ?? ""}" /></label>
        </div>
        <div class="check-grid">
          <label><input type="checkbox" name="rainOk"${item.weather?.rainOk ? " checked" : ""} /> Rain ok</label>
          <label><input type="checkbox" name="windOk"${item.weather?.windOk ? " checked" : ""} /> Wind ok</label>
          <label><input type="checkbox" name="favorite"${item.meta?.favorite ? " checked" : ""} /> Favorite</label>
        </div>
      </div>
      <div class="block"><h3>Occasions</h3>${checks("occasion", OCCASIONS, item.occasions)}</div>
      <div class="block"><h3>Pairing</h3>
        <label class="field">Pairs well with<input name="pairsWellWith" value="${esc((item.pairing?.pairsWellWith || []).join(", "))}" placeholder="ids, colors, or subcategories" /></label>
        <label class="field">Avoid with<input name="avoidWith" value="${esc((item.pairing?.avoidWith || []).join(", "))}" /></label>
        <label class="field">Styling notes<textarea name="pairingNotes">${esc(item.pairing?.notes || "")}</textarea></label>
      </div>
      <div class="block"><h3>Photo</h3>
        <div id="image-preview" class="preview-frame">${previewItem ? frameHtml(previewItem) : ""}</div>
        <label class="field">Image path or URL<input name="image" value="${esc(imageValue)}" placeholder="images/${esc(item.id)}.webp" /></label>
        <label class="field">Upload a thumbnail<input name="file" type="file" accept="image/*" /></label>
        <button type="button" class="text-btn" data-action="clear-image">Remove image</button>
      </div>
      <div class="form-grid two">
        <label class="field">Price EUR<input name="priceEur" inputmode="decimal" value="${item.meta?.priceEur ?? ""}" /></label>
        <label class="field">Purchased<input name="purchasedAt" type="date" value="${esc(item.meta?.purchasedAt || "")}" /></label>
      </div>
      <label class="field">Product URL<input name="productUrl" value="${esc(item.meta?.productUrl || "")}" /></label>
      <div class="form-actions"><button type="submit" class="ui-btn">Save piece</button></div>
    </form>`);
}

function swapHtml() {
  const look = activeLook();
  const options = look ? compatiblePieces(look, ui.swapSlot, state.items, currentCtx()) : [];
  const body = options.length
    ? `<div class="stack">${options.map((item) => `<button type="button" class="swap-row" data-action="pick-swap" data-id="${esc(item.id)}">${frameHtml(item)}<span><strong>${esc(item.name)}</strong><br><span class="muted">${esc(labelize(item.formality))} · ${esc(labelize(item.colors?.primary))}</span></span></button>`).join("")}</div>`
    : `<p class="muted">No other owned piece fits this slot without breaking the outfit rules.</p>`;
  return sheetWrap(`Swap ${labelize(String(ui.swapSlot || "").split(":")[0])}`, body);
}

function savedHtml() {
  if (!state.outfits.length) return sheetWrap("Saved outfits", `<p class="muted">Save a look from Today and it will live here.</p>`);
  const cards = state.outfits.slice().reverse().map((outfit) => {
    const pieces = (outfit.itemIds || []).map((id) => itemById(id)).filter(Boolean);
    return `<article class="ui-card" style="padding:0.8rem">
      <h3 style="margin:0 0 0.25rem">${esc(outfit.name)}</h3>
      <p class="muted">${esc((outfit.occasions || []).map(labelize).join(" · "))}</p>
      <p>${esc(outfit.notes || "")}</p>
      <div class="piece-chips">${pieces.map((piece) => `<span class="mini-chip"><span class="dot" style="background:${colorHex(piece.colors?.primary)}"></span>${esc(piece.name)}</span>`).join("")}</div>
      <div class="actions" style="margin-top:0.7rem">
        <button type="button" class="ui-btn" data-action="show-saved" data-id="${esc(outfit.id)}">Open look</button>
        <button type="button" class="ui-btn ui-btn-ghost" data-action="log-saved" data-id="${esc(outfit.id)}">Log as worn</button>
      </div>
    </article>`;
  }).join("");
  return sheetWrap("Saved outfits", `<div class="stack">${cards}</div>`);
}

function saveSheetHtml() {
  const look = activeLook();
  const name = `${labelize(ui.occasion)} · ${prettyDate(lisbonToday())}`;
  return sheetWrap("Save outfit", `<form id="outfit-form" class="stack">
    <label class="field">Name<input name="name" required value="${esc(name)}" /></label>
    <label class="field">Notes<textarea name="notes">${esc(look?.saved?.notes || "")}</textarea></label>
    <button type="submit" class="ui-btn">Add to saved outfits</button>
  </form>`);
}

function filtersHtml() {
  return sheetWrap("More filters", `
    <div class="block"><h3>Formality</h3>${chipRow("Formality", "formality", [["all", "All"], ...FORMALITIES.map((value) => [value, labelize(value)])])}</div>
    <div class="block"><h3>Color</h3>${chipRow("Color", "color", [["all", "All"], ...COLORS.map((value) => [value, labelize(value)])])}</div>
    <div class="block"><h3>Occasion</h3>${chipRow("Occasion", "occasion", [["all", "All"], ...OCCASIONS.map((value) => [value, labelize(value)])])}</div>`);
}

function syncHtml() {
  const linked = githubLinked();
  return sheetWrap("GitHub sync", `<div class="stack">
    <p class="muted">${linked ? "This browser already has a progress-sync token. Load and save talk to closet.json." : "No token yet. Load or Save will ask once for a fine-grained token with Contents access to Dong-Xuyong/progress-sync. It stays in this browser."}</p>
    <button type="button" class="ui-btn" data-action="gh-load">Load from GitHub</button>
    <button type="button" class="ui-btn ui-btn-ghost" data-action="gh-save">Save to GitHub</button>
  </div>`);
}

function sheetHtml() {
  if (!ui.sheet || !state) return "";
  if (ui.sheet === "detail") {
    const item = itemById(ui.detailId);
    return item ? detailHtml(item) : "";
  }
  if (ui.sheet === "edit" && ui.editItem) return editHtml();
  if (ui.sheet === "swap") return swapHtml();
  if (ui.sheet === "saved") return savedHtml();
  if (ui.sheet === "save") return saveSheetHtml();
  if (ui.sheet === "filters") return filtersHtml();
  if (ui.sheet === "sync") return syncHtml();
  return "";
}

function render() {
  document.body.classList.toggle("sheet-open", !!ui.sheet);
  const app = document.getElementById("app");
  const sheets = document.getElementById("sheet-root");
  if (app) app.innerHTML = viewHtml();
  if (sheets) sheets.innerHTML = sheetHtml();
  document.querySelectorAll(".tabbar button").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.view === ui.view ? "page" : "false");
  });
  const city = document.getElementById("city-label");
  if (city && state?.profile?.city) city.textContent = state.profile.city;
}

function paintLook() {
  const root = document.getElementById("look-root");
  if (root) root.innerHTML = lookHtml();
  const readout = document.getElementById("temp-readout");
  if (readout) readout.textContent = `${Math.round(ui.weather.tempC)}°C`;
  const source = document.getElementById("weather-source");
  if (source) source.textContent = weatherSourceLabel();
  const rain = document.getElementById("rain-toggle");
  if (rain) {
    rain.setAttribute("aria-pressed", ui.weather.rain ? "true" : "false");
    rain.textContent = ui.weather.rain ? "Rain" : "Dry";
  }
  const slider = document.getElementById("temp");
  if (slider && document.activeElement !== slider) slider.value = String(Math.round(ui.weather.tempC));
}

function paintGrid() {
  const root = document.getElementById("grid-root");
  const items = filteredItems();
  if (root) root.innerHTML = items.map(cardHtml).join("") || `<p class="empty muted">No pieces match these filters.</p>`;
  const count = document.getElementById("result-count");
  if (count) count.textContent = `${items.length} pieces`;
}

function setWeather(partial, manual) {
  ui.weather = { ...ui.weather, ...partial };
  if (manual) {
    ui.weather.manual = true;
    ui.weather.source = "manual";
    localStorage.setItem(WEATHER_KEY, JSON.stringify({ tempC: ui.weather.tempC, rain: ui.weather.rain, manual: true }));
  }
  ui.savedId = null;
  recompute();
  if (ui.view === "today" && !ui.sheet) paintLook();
  else render();
}

function commit(next, message) {
  state = next;
  persist();
  recompute();
  render();
  if (message) toast(message);
  scheduleSync();
}

let syncing = false;
let syncQueued = false;

function applyRemote(remote) {
  if (!remote || typeof remote !== "object") return;
  state = normalizeCloset(mergeCloset(null, state || remote, remote));
  persist();
  recompute();
  if (!ui.sheet) render();
}

function scheduleSync() {
  if (!githubLinked() || !globalThis.GhSync) return;
  if (syncing) {
    syncQueued = true;
    return;
  }
  syncing = true;
  globalThis.GhSync.save("closet", () => state, applyRemote, { quiet: true }).then((message) => {
    toast(message);
  }).catch((error) => {
    toast(error.message || "Sync failed");
  }).finally(() => {
    syncing = false;
    if (syncQueued) {
      syncQueued = false;
      scheduleSync();
    }
  });
}

function sameSet(a, b) {
  const left = [...(a || [])].sort().join("|");
  const right = [...(b || [])].sort().join("|");
  return left === right;
}

function logIds(itemIds, occasion) {
  if (!itemIds?.length) return;
  if (state.wearLog.some((entry) => entry.date === lisbonToday() && sameSet(entry.itemIds, itemIds))) {
    toast("That look is already in today's log.");
    return;
  }
  commit(logWorn(state, itemIds, {
    date: lisbonToday(),
    occasion: occasion || ui.occasion,
    tempC: Math.round(ui.weather.tempC),
    rain: ui.weather.rain,
    rating: null,
    notes: "",
    now: lisbonTimestamp(),
  }), "Logged as worn today");
}

function numOrNull(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function splitList(value) {
  return String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
}

function checkedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function triBool(value) {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

async function fileToThumb(file) {
  const bitmap = await createImageBitmap(file);
  const maxEdge = 480;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#F5F5F3";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  let quality = 0.68;
  let data = canvas.toDataURL("image/jpeg", quality);
  while (data.length > 90000 && quality > 0.42) {
    quality -= 0.08;
    data = canvas.toDataURL("image/jpeg", quality);
  }
  if (data.length > 140000) throw new Error("That photo is still too large after compression.");
  return data;
}

function readPieceForm(form) {
  const existing = ui.editItem;
  const creating = !state.items.some((row) => row.id === existing.id);
  const name = form.elements.name.value.trim();
  if (!name) return null;
  const typed = form.elements.image.value.trim();
  let image;
  if (typed) image = typed;
  else if (ui.imageOverride !== undefined) image = ui.imageOverride;
  else image = existing.image || null;
  const now = lisbonTimestamp();
  return {
    ...existing,
    id: creating ? newItemId(name, state.items) : existing.id,
    name,
    status: form.elements.status.value,
    category: form.elements.category.value,
    subCategory: form.elements.subCategory.value.trim(),
    layer: form.elements.layer.value || null,
    formality: form.elements.formality.value,
    fit: form.elements.fit.value || null,
    colors: {
      primary: form.elements.primary.value,
      secondary: splitList(form.elements.secondary.value),
      tone: form.elements.tone.value,
      pattern: form.elements.pattern.value,
    },
    care: {
      brand: form.elements.brand.value.trim() || null,
      size: form.elements.size.value.trim() || null,
      fabric: form.elements.fabric.value.trim() || null,
      washTempC: numOrNull(form.elements.washTempC.value),
      washMethod: form.elements.washMethod.value || null,
      tumbleDry: triBool(form.elements.tumbleDry.value),
      iron: form.elements.iron.value || null,
      notes: form.elements.careNotes.value.trim(),
    },
    weather: {
      seasons: checkedValues(form, "season"),
      tempMinC: numOrNull(form.elements.tempMinC.value),
      tempMaxC: numOrNull(form.elements.tempMaxC.value),
      rainOk: form.elements.rainOk.checked,
      windOk: form.elements.windOk.checked,
    },
    occasions: checkedValues(form, "occasion"),
    pairing: {
      pairsWellWith: splitList(form.elements.pairsWellWith.value),
      avoidWith: splitList(form.elements.avoidWith.value),
      notes: form.elements.pairingNotes.value.trim(),
    },
    image,
    meta: {
      ...(existing.meta || {}),
      priceEur: numOrNull(form.elements.priceEur.value),
      productUrl: form.elements.productUrl.value.trim() || null,
      purchasedAt: form.elements.purchasedAt.value || null,
      favorite: form.elements.favorite.checked,
      createdAt: existing.meta?.createdAt || now,
      updatedAt: now,
    },
  };
}

async function loadWeather() {
  try {
    const response = await fetch(WEATHER_URL, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error("weather");
    const forecast = forecastFromMeteo(await response.json());
    if (!forecast) throw new Error("weather");
    if (ui.weather.manual) return;
    ui.weather.tempC = forecast.tempC;
    ui.weather.rain = forecast.rain;
    ui.weather.source = "live";
    recompute();
    if (ui.view === "today" && !ui.sheet) paintLook();
    else if (!ui.sheet) render();
  } catch {
    if (!ui.weather.manual) {
      ui.weather.source = "offline";
      if (ui.view === "today" && !ui.sheet) paintLook();
    }
  }
}

function openEdit(item) {
  ui.editItem = item;
  ui.imageOverride = undefined;
  ui.sheet = "edit";
  render();
}

function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "sheet-back" && event.target !== button) return;
  const action = button.dataset.action;
  if (action === "view") {
    ui.view = button.dataset.view;
    ui.sheet = null;
    render();
    return;
  }
  if (action === "occasion") {
    ui.occasion = button.dataset.occasion;
    ui.savedId = null;
    recompute();
    render();
    return;
  }
  if (action === "rank") {
    ui.index = Number(button.dataset.index);
    paintLook();
    return;
  }
  if (action === "temp-step") {
    const next = Math.min(38, Math.max(-5, Math.round(ui.weather.tempC) + Number(button.dataset.delta)));
    setWeather({ tempC: next }, true);
    return;
  }
  if (action === "rain") {
    setWeather({ rain: !ui.weather.rain }, true);
    return;
  }
  if (action === "use-live") {
    ui.weather.manual = false;
    ui.weather.source = "loading";
    localStorage.removeItem(WEATHER_KEY);
    paintLook();
    loadWeather();
    return;
  }
  if (action === "swap") {
    ui.swapSlot = button.dataset.slot;
    ui.sheet = "swap";
    render();
    return;
  }
  if (action === "pick-swap") {
    const look = activeLook();
    const piece = itemById(button.dataset.id);
    if (!look || !piece) return;
    const swapped = swapPiece(look, ui.swapSlot, piece, state.items, currentCtx());
    if (ui.savedId) {
      const saved = savedOutfit();
      const ids = swapped.itemIds;
      state = {
        ...state,
        outfits: state.outfits.map((outfit) => outfit.id === saved.id ? { ...outfit, itemIds: ids, updatedAt: lisbonTimestamp() } : outfit),
        updatedAt: lisbonTimestamp(),
      };
      persist();
      scheduleSync();
    } else {
      ui.suggestions[ui.index] = swapped;
    }
    ui.sheet = null;
    render();
    return;
  }
  if (action === "log") {
    const look = activeLook();
    if (look) logIds(look.itemIds, look.saved?.occasions?.[0] || ui.occasion);
    return;
  }
  if (action === "open-save") {
    if (!activeLook()) return;
    ui.sheet = "save";
    render();
    return;
  }
  if (action === "open-saved") {
    ui.sheet = "saved";
    render();
    return;
  }
  if (action === "show-saved") {
    ui.savedId = button.dataset.id;
    ui.sheet = null;
    ui.view = "today";
    render();
    return;
  }
  if (action === "clear-saved") {
    ui.savedId = null;
    render();
    return;
  }
  if (action === "log-saved") {
    const outfit = state.outfits.find((row) => row.id === button.dataset.id);
    if (!outfit) return;
    ui.sheet = null;
    logIds(outfit.itemIds, outfit.occasions?.[0] || "everyday");
    return;
  }
  if (action === "open-detail") {
    ui.detailId = button.dataset.id;
    ui.sheet = "detail";
    render();
    return;
  }
  if (action === "open-edit") {
    const item = itemById(button.dataset.id);
    if (item) openEdit(JSON.parse(JSON.stringify(item)));
    return;
  }
  if (action === "open-new") {
    openEdit(blankItem({ id: "draft", name: "", now: lisbonTimestamp() }, state.profile));
    return;
  }
  if (action === "favorite") {
    commit(toggleFavorite(state, button.dataset.id, lisbonTimestamp()));
    ui.sheet = "detail";
    ui.detailId = button.dataset.id;
    render();
    return;
  }
  if (action === "mark-owned") {
    commit(setStatus(state, button.dataset.id, "owned", lisbonTimestamp()), "Marked as owned");
    ui.sheet = "detail";
    ui.detailId = button.dataset.id;
    render();
    return;
  }
  if (action === "archive") {
    if (!confirm("Archive this piece? It stays in the wardrobe, but leaves the daily suggestions.")) return;
    commit(archiveItem(state, button.dataset.id, lisbonTimestamp()), "Archived");
    ui.sheet = null;
    render();
    return;
  }
  if (action === "filter") {
    ui.filters[button.dataset.key] = button.dataset.value;
    if (ui.sheet === "filters") render();
    else render();
    return;
  }
  if (action === "open-filters") {
    ui.sheet = "filters";
    render();
    return;
  }
  if (action === "open-sync") {
    ui.sheet = "sync";
    render();
    return;
  }
  if (action === "gh-load") {
    globalThis.GhSync.load("closet", applyRemote).then((message) => {
      ui.sheet = null;
      render();
      toast(message);
    }).catch((error) => toast(error.message || "Load failed"));
    return;
  }
  if (action === "gh-save") {
    globalThis.GhSync.save("closet", () => state, applyRemote).then((message) => {
      toast(message);
    }).catch((error) => toast(error.message || "Save failed"));
    return;
  }
  if (action === "clear-image") {
    ui.imageOverride = null;
    const form = document.getElementById("piece-form");
    if (form?.elements?.image) form.elements.image.value = "";
    const preview = document.getElementById("image-preview");
    if (preview) preview.innerHTML = "";
    return;
  }
  if (action === "close" || action === "sheet-back") {
    ui.sheet = null;
    render();
    return;
  }
  if (action === "rate") {
    commit(rateWear(state, button.dataset.id, Number(button.dataset.star), lisbonTimestamp()));
  }
}

function onInput(event) {
  if (event.target.id === "temp") {
    setWeather({ tempC: Number(event.target.value) }, true);
    return;
  }
  if (event.target.id === "search") {
    ui.filters.q = event.target.value;
    paintGrid();
  }
}

async function onChange(event) {
  if (event.target.name !== "file" || !event.target.files?.[0]) return;
  try {
    ui.imageOverride = await fileToThumb(event.target.files[0]);
    const form = event.target.form;
    if (form?.elements?.image) form.elements.image.value = "";
    const preview = document.getElementById("image-preview");
    if (preview && ui.editItem) preview.innerHTML = frameHtml({ ...ui.editItem, image: ui.imageOverride });
    toast("Thumbnail compressed");
  } catch (error) {
    toast(error.message || "Couldn't read that image");
  }
}

function onSubmit(event) {
  if (event.target.id === "piece-form") {
    event.preventDefault();
    const piece = readPieceForm(event.target);
    if (!piece) {
      toast("Name the piece first.");
      return;
    }
    ui.detailId = piece.id;
    ui.sheet = "detail";
    ui.editItem = null;
    ui.imageOverride = undefined;
    commit(upsertItem(state, piece, lisbonTimestamp()), "Piece saved");
    return;
  }
  if (event.target.id === "outfit-form") {
    event.preventDefault();
    const look = activeLook();
    if (!look) return;
    const name = event.target.elements.name.value.trim() || "Saved look";
    const notes = event.target.elements.notes.value.trim();
    ui.sheet = "saved";
    commit(saveOutfit(state, {
      name,
      notes,
      itemIds: look.itemIds,
      occasions: look.saved?.occasions || [ui.occasion],
      now: lisbonTimestamp(),
    }), "Outfit saved");
  }
}

function restoreWeather() {
  try {
    const saved = JSON.parse(localStorage.getItem(WEATHER_KEY) || "null");
    if (saved && saved.manual && Number.isFinite(saved.tempC)) {
      ui.weather = { tempC: saved.tempC, rain: !!saved.rain, source: "manual", manual: true };
    }
  } catch {
    /* ignore broken override */
  }
}

async function boot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = normalizeCloset(JSON.parse(raw));
  } catch {
    state = null;
  }
  if (!state) {
    try {
      const response = await fetch("data/seed-closet.json");
      if (!response.ok) throw new Error("seed");
      state = normalizeCloset(await response.json());
    } catch {
      state = normalizeCloset({});
      toast("Couldn't load the starter wardrobe.");
    }
    persist();
  }
  restoreWeather();
  recompute();
  render();
  if (!ui.weather.manual) loadWeather();
}

document.addEventListener("click", onClick);
document.addEventListener("input", onInput);
document.addEventListener("change", onChange);
document.addEventListener("submit", onSubmit);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && ui.sheet) {
    ui.sheet = null;
    render();
  }
});
window.addEventListener("error", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLImageElement) || !target.dataset.ph) return;
  target.hidden = true;
  const fallback = target.parentElement?.querySelector(".ph");
  if (fallback) fallback.hidden = false;
}, true);

boot();

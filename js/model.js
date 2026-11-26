/** Pure closet document mutations. The UI persists and syncs the result. */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function lisbonTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  let hour = get("hour");
  if (hour === "24") hour = "00";
  const local = `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;
  const offsetMin = Math.round((Date.parse(`${local}Z`) - date.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${local}${sign}${hh}:${mm}`;
}

export function lisbonToday(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function wearEntryId(date, rand = Math.random) {
  const ymd = String(date).replace(/-/g, "").slice(0, 8);
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 4; i += 1) {
    const index = Math.floor(rand() * alphabet.length);
    suffix += alphabet[index] || "a";
  }
  return `wear_${ymd}_${suffix}`;
}

function hash4(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  return hash.toString(36).padStart(4, "0").slice(-4);
}

function clampRating(rating) {
  const value = Number(rating);
  if (!Number.isFinite(value)) return null;
  return Math.min(5, Math.max(1, Math.round(value)));
}

export function normalizeItem(item) {
  if (!item || item.id == null) return null;
  const image = item.image || item.photo?.url || item.photo?.thumb || null;
  const rest = { ...item };
  delete rest.photo;
  return {
    ...rest,
    id: String(item.id),
    name: item.name || "Untitled piece",
    status: item.status || "owned",
    category: item.category || "top",
    subCategory: item.subCategory || "",
    layer: item.layer ?? null,
    colors: {
      primary: "other",
      secondary: [],
      tone: "neutral",
      pattern: "solid",
      ...(item.colors || {}),
      secondary: Array.isArray(item.colors?.secondary) ? item.colors.secondary : [],
    },
    formality: item.formality || "casual",
    fit: item.fit ?? null,
    care: {
      brand: null,
      size: null,
      fabric: null,
      washTempC: null,
      washMethod: null,
      tumbleDry: null,
      iron: null,
      notes: "",
      ...(item.care || {}),
    },
    weather: {
      seasons: [],
      tempMinC: null,
      tempMaxC: null,
      rainOk: false,
      windOk: false,
      ...(item.weather || {}),
      seasons: Array.isArray(item.weather?.seasons) ? item.weather.seasons : [],
    },
    occasions: Array.isArray(item.occasions) ? item.occasions : [],
    pairing: {
      pairsWellWith: [],
      avoidWith: [],
      notes: "",
      ...(item.pairing || {}),
      pairsWellWith: Array.isArray(item.pairing?.pairsWellWith) ? item.pairing.pairsWellWith : [],
      avoidWith: Array.isArray(item.pairing?.avoidWith) ? item.pairing.avoidWith : [],
    },
    image,
    meta: {
      priceEur: null,
      productUrl: null,
      purchasedAt: null,
      lastWornAt: null,
      wearCount: 0,
      favorite: false,
      createdAt: null,
      updatedAt: null,
      ...(item.meta || {}),
    },
  };
}

function normalizeWear(entry, index) {
  if (!entry || typeof entry !== "object") return null;
  const date = entry.date || lisbonToday();
  const itemIds = Array.isArray(entry.itemIds) ? entry.itemIds : [];
  const id = entry.id || `wear_${String(date).replace(/-/g, "").slice(0, 8)}_${hash4(itemIds.join("|") + index)}`;
  return {
    ...entry,
    id: String(id),
    date,
    itemIds,
    occasion: entry.occasion || "everyday",
    tempC: entry.tempC ?? null,
    rain: !!entry.rain,
    rating: entry.rating == null ? null : clampRating(entry.rating),
    notes: entry.notes || "",
  };
}

export function normalizeCloset(data) {
  const src = data && typeof data === "object" ? data : {};
  const profile = src.profile || {};
  return {
    ...src,
    app: "closet",
    version: src.version || 1,
    updatedAt: src.updatedAt || null,
    profile: {
      heightCm: 171,
      city: "Guimarães",
      lat: 41.4425,
      lon: -8.2918,
      ...profile,
      sizes: {
        top: "M",
        bottom: "38",
        shoesEu: 42,
        ...(profile.sizes || {}),
      },
    },
    items: (Array.isArray(src.items) ? src.items : []).map(normalizeItem).filter(Boolean),
    outfits: Array.isArray(src.outfits) ? src.outfits.map((outfit) => ({ ...outfit })) : [],
    wearLog: (Array.isArray(src.wearLog) ? src.wearLog : []).map(normalizeWear).filter(Boolean),
  };
}

export function newItemId(name, items) {
  const slug = String(name || "piece")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "piece";
  const ids = new Set((items || []).map((item) => item.id));
  let id = `cl_${slug}`;
  if (!ids.has(id)) return id;
  let n = 2;
  while (ids.has(`${id}_${n}`)) n += 1;
  return `${id}_${n}`;
}

export function blankItem(partial, profile) {
  const now = partial.now || lisbonTimestamp();
  const category = partial.category || "top";
  const sizes = profile?.sizes || {};
  const size = category === "bottom" ? sizes.bottom : category === "shoes" ? String(sizes.shoesEu ?? "") : category === "top" || category === "outerwear" ? sizes.top : null;
  const layer = partial.layer !== undefined ? partial.layer : category === "top" ? "base" : category === "outerwear" ? "outer" : null;
  return normalizeItem({
    id: partial.id,
    name: partial.name || "",
    status: partial.status || "owned",
    category,
    subCategory: partial.subCategory || "",
    layer,
    colors: { primary: "black", secondary: [], tone: "neutral", pattern: "solid" },
    formality: "casual",
    fit: category === "accessory" || category === "shoes" ? null : "regular",
    care: { brand: null, size: size || null, fabric: null, washTempC: null, washMethod: null, tumbleDry: null, iron: null, notes: "" },
    weather: { seasons: ["spring", "summer", "autumn", "winter"], tempMinC: null, tempMaxC: null, rainOk: true, windOk: true },
    occasions: ["everyday"],
    pairing: { pairsWellWith: [], avoidWith: [], notes: "" },
    image: null,
    meta: {
      priceEur: null,
      productUrl: null,
      purchasedAt: null,
      lastWornAt: null,
      wearCount: 0,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    },
  });
}

export function logWorn(state, itemIds, opts = {}) {
  const next = clone(state);
  const now = opts.now || lisbonTimestamp();
  const date = opts.date || lisbonToday();
  const ids = Array.isArray(itemIds) ? itemIds.filter(Boolean) : [];
  const entry = {
    id: opts.id || wearEntryId(date),
    date,
    itemIds: ids,
    occasion: opts.occasion || "everyday",
    tempC: opts.tempC ?? null,
    rain: !!opts.rain,
    rating: opts.rating == null ? null : clampRating(opts.rating),
    notes: opts.notes || "",
  };
  next.wearLog = [...(next.wearLog || []), entry];
  const worn = new Set(ids);
  next.items = (next.items || []).map((item) => {
    if (!worn.has(item.id)) return item;
    return {
      ...item,
      meta: {
        ...item.meta,
        lastWornAt: date,
        wearCount: Number(item.meta?.wearCount || 0) + 1,
        updatedAt: now,
      },
    };
  });
  next.updatedAt = now;
  return next;
}

export function rateWear(state, id, rating, now = lisbonTimestamp()) {
  const next = clone(state);
  next.wearLog = (next.wearLog || []).map((entry) => (
    entry.id === id ? { ...entry, rating: clampRating(rating) } : entry
  ));
  next.updatedAt = now;
  return next;
}

export function upsertItem(state, item, now = lisbonTimestamp()) {
  const next = clone(state);
  const prepared = normalizeItem({
    ...item,
    meta: {
      ...(item.meta || {}),
      createdAt: item.meta?.createdAt || now,
      updatedAt: now,
    },
  });
  const index = next.items.findIndex((row) => row.id === prepared.id);
  if (index >= 0) next.items[index] = prepared;
  else next.items.push(prepared);
  next.updatedAt = now;
  return next;
}

export function archiveItem(state, id, now = lisbonTimestamp()) {
  const next = clone(state);
  next.items = next.items.map((item) => (
    item.id === id
      ? { ...item, status: "archived", meta: { ...item.meta, updatedAt: now } }
      : item
  ));
  next.updatedAt = now;
  return next;
}

export function setStatus(state, id, status, now = lisbonTimestamp()) {
  const next = clone(state);
  next.items = next.items.map((item) => (
    item.id === id
      ? { ...item, status, meta: { ...item.meta, updatedAt: now } }
      : item
  ));
  next.updatedAt = now;
  return next;
}

export function toggleFavorite(state, id, now = lisbonTimestamp()) {
  const next = clone(state);
  next.items = next.items.map((item) => (
    item.id === id
      ? { ...item, meta: { ...item.meta, favorite: !item.meta?.favorite, updatedAt: now } }
      : item
  ));
  next.updatedAt = now;
  return next;
}

export function saveOutfit(state, fields, now = lisbonTimestamp()) {
  const next = clone(state);
  const outfit = {
    id: fields.id || `out_${String(now).slice(0, 10).replace(/-/g, "")}_${Math.random().toString(36).slice(2, 6)}`,
    name: fields.name || "Saved look",
    itemIds: (fields.itemIds || []).slice(),
    occasions: fields.occasions?.length ? fields.occasions.slice() : ["everyday"],
    notes: fields.notes || "",
    createdAt: fields.createdAt || now,
    updatedAt: now,
  };
  next.outfits = [...(next.outfits || []), outfit];
  next.updatedAt = now;
  return next;
}

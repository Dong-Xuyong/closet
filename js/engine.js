/**
 * Daily outfit suggestion engine.
 * Rules follow closet-schema-v1: owned-only pool, occasion fallback,
 * ±3°C window, rain preference, layering, formality, color, scoring.
 */

import {
  DARK_COLORS,
  FORMALITY_RANK,
  HEAVY_OUTER,
  LIGHT_COLORS,
} from "./vocab.js";

export function layerPlan(tempC) {
  if (tempC >= 20) {
    return { mode: "base", requireOuter: false, allowMid: false, lightOuterOnly: false };
  }
  if (tempC >= 14) {
    return { mode: "shoulder", requireOuter: false, allowMid: true, lightOuterOnly: true };
  }
  if (tempC < 11) {
    return { mode: "cold-mid", requireOuter: true, allowMid: true, lightOuterOnly: false };
  }
  return { mode: "cold", requireOuter: true, allowMid: false, lightOuterOnly: false };
}

export function tempOk(item, tempC) {
  const min = item?.weather?.tempMinC;
  const max = item?.weather?.tempMaxC;
  if (typeof min === "number" && tempC < min - 3) return false;
  if (typeof max === "number" && tempC > max + 3) return false;
  return true;
}

function isOuter(item) {
  if (!item || item.layer === "mid") return false;
  return item.layer === "outer" || item.category === "outerwear";
}

function isLightOuter(item) {
  return isOuter(item) && !HEAVY_OUTER.has(item.subCategory);
}

function isMid(item) {
  return item?.layer === "mid";
}

function isBase(item) {
  return item?.category === "top" && item?.layer === "base";
}

function matchesKind(item, kind) {
  if (kind === "bottom") return item.category === "bottom";
  if (kind === "base") return isBase(item);
  if (kind === "mid") return isMid(item);
  if (kind === "outer") return isOuter(item);
  if (kind === "shoes") return item.category === "shoes";
  if (kind === "accessory") return item.category === "accessory";
  return false;
}

function tempDistance(item, tempC) {
  const min = item?.weather?.tempMinC;
  const max = item?.weather?.tempMaxC;
  let distance = 0;
  if (typeof min === "number" && tempC < min - 3) distance = Math.max(distance, min - 3 - tempC);
  if (typeof max === "number" && tempC > max + 3) distance = Math.max(distance, tempC - (max + 3));
  return distance;
}

function tagged(item, occasion) {
  return (item.occasions || []).includes(occasion);
}

/** Exact occasion, then everyday. Anything else is a closest-occasion fallback. */
function preferOccasion(list, occasion) {
  const exact = list.filter((item) => tagged(item, occasion));
  if (exact.length) return { pool: exact, closest: false };
  if (occasion !== "everyday") {
    const everyday = list.filter((item) => tagged(item, "everyday"));
    if (everyday.length) return { pool: everyday, closest: false };
  }
  return { pool: list, closest: list.length > 0 };
}

const SLOT_CAP = { bottom: 10, base: 10, shoes: 8, outer: 8, mid: 5, accessory: 5 };

function pieceRank(a, b) {
  const favorite = Number(!!b.meta?.favorite) - Number(!!a.meta?.favorite);
  if (favorite) return favorite;
  const worn = (a.meta?.wearCount || 0) - (b.meta?.wearCount || 0);
  if (worn) return worn;
  return String(a.id).localeCompare(String(b.id));
}

/** Keep every formality represented when a slot is too wide to search in full. */
function trimPool(pool, kind) {
  const cap = SLOT_CAP[kind] || pool.length;
  const sorted = pool.slice().sort(pieceRank);
  if (sorted.length <= cap) return sorted;
  const buckets = new Map();
  for (const item of sorted) {
    const key = item.formality || "casual";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const keys = [...buckets.keys()].sort();
  const out = [];
  for (let row = 0; out.length < cap; row += 1) {
    let grew = false;
    for (const key of keys) {
      const item = buckets.get(key)[row];
      if (!item) continue;
      out.push(item);
      grew = true;
      if (out.length === cap) break;
    }
    if (!grew) break;
  }
  return out;
}

function uniqueNotes(notes) {
  return [...new Set((notes || []).filter(Boolean))];
}

/**
 * Required-slot pool, relaxed only when the stricter pool is empty:
 * temp window → nearest range ("widest temp fit"),
 * occasion → everyday → any owned piece ("closest occasion"),
 * rain → rainOk, else the dry pieces ("not rain-ready").
 */
function fillSlot(items, predicate, ctx, kind, trim = true) {
  const owned = (items || []).filter((item) => item && item.status === "owned" && predicate(item));
  const occasion = ctx.occasion || "everyday";
  const notes = [];
  const inTemp = owned.filter((item) => tempOk(item, ctx.tempC));
  let picked = preferOccasion(inTemp, occasion);
  if (!picked.pool.length && owned.length) {
    let nearest = Infinity;
    for (const item of owned) nearest = Math.min(nearest, tempDistance(item, ctx.tempC));
    const closest = owned.filter((item) => tempDistance(item, ctx.tempC) === nearest);
    picked = preferOccasion(closest, occasion);
    notes.push("widest temp fit");
  }
  if (picked.closest) notes.push("closest occasion");
  let pool = picked.pool;
  if (ctx.rain && (kind === "outer" || kind === "shoes") && pool.length) {
    const wet = pool.filter((item) => item.weather?.rainOk);
    if (wet.length) pool = wet;
    else notes.push("not rain-ready");
  }
  return {
    pool: trim ? trimPool(pool, kind) : pool.slice().sort(pieceRank),
    notes: uniqueNotes(notes),
  };
}

function mainPieces(slots) {
  return [slots.outer, slots.mid, slots.base, slots.bottom, slots.shoes].filter(Boolean);
}

function allPieces(slots) {
  return [...mainPieces(slots), ...(slots.accessories || [])];
}

export function itemIdsOf(slots) {
  return allPieces(slots).map((item) => item.id);
}

function parseSlot(slot) {
  if (typeof slot === "string" && slot.startsWith("accessory:")) {
    return { kind: "accessory", index: Number(slot.slice("accessory:".length)) };
  }
  return { kind: slot, index: -1 };
}

function daysAgo(today, date) {
  const a = String(today).slice(0, 10).split("-").map(Number);
  const b = String(date).slice(0, 10).split("-").map(Number);
  if (a.length < 3 || b.length < 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) return Infinity;
  const utcA = Date.UTC(a[0], a[1] - 1, a[2]);
  const utcB = Date.UTC(b[0], b[1] - 1, b[2]);
  return Math.round((utcA - utcB) / 86400000);
}

function wearPenalty(item, wearLog, today) {
  if (!item) return 0;
  if (item.category !== "top" && item.category !== "bottom" && item.category !== "outerwear") return 0;
  let newest = Infinity;
  for (const entry of wearLog || []) {
    if (!entry?.itemIds?.includes(item.id)) continue;
    const age = daysAgo(today, entry.date);
    if (age < 0) continue;
    if (age < newest) newest = age;
  }
  if (newest <= 2) return -4;
  if (newest <= 4) return -2;
  return 0;
}

function listsPartner(item, other) {
  const list = item?.pairing?.pairsWellWith || [];
  return list.includes(other.id) || list.includes(other.subCategory) || list.includes(other.colors?.primary);
}

function avoids(item, other) {
  const list = item?.pairing?.avoidWith || [];
  return list.includes(other.id) || list.includes(other.subCategory) || list.includes(other.colors?.primary);
}

function formalitySpread(slots) {
  const ranks = mainPieces(slots)
    .map((item) => FORMALITY_RANK[item.formality])
    .filter((rank) => rank != null);
  if (!ranks.length) return 0;
  return Math.max(...ranks) - Math.min(...ranks);
}

function sportClash(slots) {
  const ranks = allPieces(slots)
    .map((item) => FORMALITY_RANK[item.formality])
    .filter((rank) => rank != null);
  return ranks.includes(0) && ranks.some((rank) => rank >= 2);
}

function dominantFormality(slots) {
  const ranks = mainPieces(slots)
    .map((item) => FORMALITY_RANK[item.formality])
    .filter((rank) => rank != null);
  if (!ranks.length) return "casual";
  const max = Math.max(...ranks);
  return Object.keys(FORMALITY_RANK).find((key) => FORMALITY_RANK[key] === max) || "casual";
}

function paletteKind(slots) {
  const colors = mainPieces(slots).map((item) => item.colors?.primary).filter(Boolean);
  if (colors.length && colors.every((color) => color === "black")) return "mono";
  const light = colors.some((color) => LIGHT_COLORS.has(color));
  const dark = colors.some((color) => DARK_COLORS.has(color));
  if (light && dark) return "contrast";
  if (allPieces(slots).some((item) => item.colors?.tone === "accent")) return "accent";
  return "neutral";
}

export function whyItWorks(slots, ctx, breakdown) {
  const temp = Math.round(Number(ctx.tempC));
  const sky = ctx.rain ? "rainy" : "dry";
  const palette = {
    mono: "all-black monochrome",
    contrast: "light and dark balanced",
    accent: "one accent tone",
    neutral: "a quiet neutral palette",
  }[breakdown.palette] || "a quiet neutral palette";
  const formality = String(dominantFormality(slots)).replace("-", " ");
  const layer = slots.outer?.name || slots.mid?.name || "no extra layer";
  const occasion = ctx.occasion && ctx.occasion !== "everyday" ? `${String(ctx.occasion).replace("-", " ")} · ` : "";
  const line = `${occasion}${temp}°C ${sky} — ${formality}, ${palette}, ${layer}.`;
  const notes = [...new Set((slots.notes || []).filter(Boolean))];
  return notes.length ? `${line} ${notes.join(", ")}.` : line;
}

export function scoreOutfit(slots, ctx) {
  const wearLog = ctx.wearLog || [];
  const today = ctx.today;
  const occasion = ctx.occasion || "everyday";
  const pieces = allPieces(slots);
  const mains = mainPieces(slots);
  const breakdown = {
    occasion: 0,
    pairs: 0,
    contrast: 0,
    favorites: 0,
    wear: 0,
    blackNavy: 0,
    brownBlack: 0,
    oversized: 0,
    avoid: 0,
    palette: paletteKind(slots),
    spread: formalitySpread(slots),
    rejected: false,
  };

  if (sportClash(slots) || breakdown.spread > 1) breakdown.rejected = true;

  const accents = pieces.filter((item) => item.colors?.tone === "accent").length;
  const patterns = pieces.filter((item) => item.colors?.pattern && item.colors.pattern !== "solid").length;
  if (accents > 1 || patterns > 1) breakdown.rejected = true;

  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = 0; j < pieces.length; j += 1) {
      if (i === j) continue;
      if (avoids(pieces[i], pieces[j])) {
        breakdown.avoid = -10;
        breakdown.rejected = true;
      }
    }
  }

  if (mains.length && mains.every((item) => (item.occasions || []).includes(occasion))) {
    breakdown.occasion = 3;
  }

  for (const item of pieces) {
    for (const other of pieces) {
      if (item.id === other.id) continue;
      if (listsPartner(item, other)) breakdown.pairs += 2;
    }
  }

  if (breakdown.palette === "mono" || breakdown.palette === "contrast") breakdown.contrast = 2;

  for (const item of pieces) {
    if (item.meta?.favorite) breakdown.favorites += 1;
  }

  for (const item of pieces) breakdown.wear += wearPenalty(item, wearLog, today);

  const blacks = mains.filter((item) => item.colors?.primary === "black");
  const navies = mains.filter((item) => item.colors?.primary === "navy");
  if (blacks.length && navies.length) {
    let uncovered = false;
    for (const black of blacks) {
      for (const navy of navies) {
        if (!listsPartner(black, navy) && !listsPartner(navy, black)) uncovered = true;
      }
    }
    if (uncovered) breakdown.blackNavy = -2;
  }

  const browns = mains.filter((item) => item.colors?.primary === "brown");
  if (browns.length && blacks.length) breakdown.brownBlack = -1;

  const oversized = mains.filter((item) => item.fit === "oversized").length;
  if (oversized >= 2) breakdown.oversized = -2;

  const score = breakdown.occasion + breakdown.pairs + breakdown.contrast + breakdown.favorites
    + breakdown.wear + breakdown.blackNavy + breakdown.brownBlack + breakdown.oversized + breakdown.avoid;

  return {
    score,
    rejected: breakdown.rejected,
    breakdown,
    why: whyItWorks(slots, ctx, breakdown),
    slots,
    itemIds: itemIdsOf(slots),
  };
}

function accessorySets(list) {
  const pool = list.slice(0, 6);
  const sets = [[]];
  for (const item of pool) {
    const extra = [];
    for (const set of sets) {
      if (set.length >= 3) continue;
      if (set.some((other) => other.subCategory && other.subCategory === item.subCategory)) continue;
      extra.push(set.concat([item]));
    }
    for (const set of extra) sets.push(set);
  }
  return sets;
}

function layerChoices(tempC, mids, outers) {
  if (tempC >= 20) return [{ mid: null, outer: null, note: null }];
  if (tempC < 14) {
    const outerChoices = outers.length ? outers : [null];
    const midChoices = tempC < 11 ? [null, ...mids] : [null];
    const note = outers.length ? null : "layer relaxed";
    const choices = [];
    for (const outer of outerChoices) {
      for (const mid of midChoices) choices.push({ mid, outer, note });
    }
    return choices;
  }
  const choices = [];
  for (const mid of mids) choices.push({ mid, outer: null, note: null });
  for (const outer of outers) choices.push({ mid: null, outer, note: null });
  if (!choices.length) choices.push({ mid: null, outer: null, note: "layer relaxed" });
  return choices;
}

function finish(slots, ctx) {
  const scored = scoreOutfit(slots, ctx);
  if (scored.rejected) return null;
  if (!slots.base || !slots.bottom || !slots.shoes) return null;
  return scored;
}

function remember(bestByCore, key, scored) {
  const prev = bestByCore.get(key);
  if (!prev || scored.score > prev.score || (scored.score === prev.score && scored.itemIds.join() < prev.itemIds.join())) {
    bestByCore.set(key, scored);
  }
}

function withAccessories(cores, accessorySlot, ctx) {
  const sets = accessorySets(accessorySlot.pool.slice().sort((a, b) => a.id.localeCompare(b.id)));
  if (sets.length <= 1) return cores;
  const ranked = cores.slice().sort((a, b) => b.score - a.score || a.itemIds.join().localeCompare(b.itemIds.join()));
  const upgrade = new Set(ranked.slice(0, 24).map((outfit) => outfit.itemIds.join()));
  const bestByCore = new Map();
  for (const outfit of cores) {
    const key = [outfit.slots.outer?.id || "-", outfit.slots.mid?.id || "-", outfit.slots.base.id, outfit.slots.bottom.id, outfit.slots.shoes.id].join("/");
    if (!upgrade.has(outfit.itemIds.join())) {
      remember(bestByCore, key, outfit);
      continue;
    }
    for (const set of sets) {
      const notes = set.length ? uniqueNotes([...(outfit.slots.notes || []), ...accessorySlot.notes]) : outfit.slots.notes;
      const slots = {
        outer: outfit.slots.outer,
        mid: outfit.slots.mid,
        base: outfit.slots.base,
        bottom: outfit.slots.bottom,
        shoes: outfit.slots.shoes,
        accessories: set,
        notes,
      };
      const scored = finish(slots, ctx);
      if (scored) remember(bestByCore, key, scored);
    }
  }
  return [...bestByCore.values()];
}

export function assembleOutfits(items, wearLog, ctx) {
  const context = {
    tempC: ctx?.tempC ?? 16,
    rain: !!ctx?.rain,
    occasion: ctx?.occasion || "everyday",
    today: ctx?.today,
    wearLog: wearLog || ctx?.wearLog || [],
  };
  const list = items || [];
  const bottoms = fillSlot(list, (item) => item.category === "bottom", context, "bottom");
  const bases = fillSlot(list, isBase, context, "base");
  const shoes = fillSlot(list, (item) => item.category === "shoes", context, "shoes");
  const plan = layerPlan(context.tempC);
  let outers = fillSlot(list, isOuter, context, "outer");
  if (plan.lightOuterOnly) {
    const light = outers.pool.filter(isLightOuter);
    outers = { pool: light, notes: light.length ? outers.notes : [] };
  }
  const mids = plan.allowMid ? fillSlot(list, isMid, context, "mid") : { pool: [], notes: [] };
  const accessories = fillSlot(list, (item) => item.category === "accessory", context, "accessory");
  const layers = layerChoices(context.tempC, mids.pool, outers.pool);
  const coreNotes = uniqueNotes([...bottoms.notes, ...bases.notes, ...shoes.notes]);
  const bestByCore = new Map();

  for (const bottom of bottoms.pool) {
    for (const base of bases.pool) {
      for (const shoe of shoes.pool) {
        for (const layer of layers) {
          const notes = uniqueNotes([
            ...coreNotes,
            ...(layer.outer ? outers.notes : []),
            ...(layer.mid ? mids.notes : []),
            layer.note,
          ]);
          const slots = {
            outer: layer.outer,
            mid: layer.mid,
            base,
            bottom,
            shoes: shoe,
            accessories: [],
            notes,
          };
          const scored = finish(slots, context);
          if (!scored) continue;
          const coreKey = [layer.outer?.id || "-", layer.mid?.id || "-", base.id, bottom.id, shoe.id].join("/");
          remember(bestByCore, coreKey, scored);
        }
      }
    }
  }

  return withAccessories([...bestByCore.values()], accessories, context).sort((a, b) => (
    b.score - a.score || a.itemIds.join().localeCompare(b.itemIds.join())
  ));
}

export function suggestOutfits(items, wearLog, ctx) {
  return assembleOutfits(items, wearLog, ctx).slice(0, 3);
}

function replaceSlot(slots, parsed, item) {
  const next = {
    outer: slots.outer,
    mid: slots.mid,
    base: slots.base,
    bottom: slots.bottom,
    shoes: slots.shoes,
    accessories: (slots.accessories || []).slice(),
  };
  if (parsed.kind === "accessory") next.accessories[parsed.index] = item;
  else next[parsed.kind] = item;
  return next;
}

export function compatiblePieces(outfit, slot, items, ctx) {
  const parsed = parseSlot(slot);
  const slots = outfit.slots || outfit;
  const current = parsed.kind === "accessory" ? slots.accessories?.[parsed.index] : slots[parsed.kind];
  const context = {
    tempC: ctx?.tempC ?? 16,
    rain: !!ctx?.rain,
    occasion: ctx?.occasion || "everyday",
    today: ctx?.today,
    wearLog: ctx?.wearLog || [],
  };
  const plan = layerPlan(context.tempC);
  let pool = fillSlot(items, (item) => matchesKind(item, parsed.kind), context, parsed.kind, false).pool;
  if (current) pool = pool.filter((item) => item.id !== current.id);
  if (parsed.kind === "outer" && plan.lightOuterOnly) {
    const light = pool.filter(isLightOuter);
    if (light.length) pool = light;
  }
  return pool
    .filter((item) => {
      if (parsed.kind === "accessory") {
        const others = (slots.accessories || []).filter((_, index) => index !== parsed.index);
        if (others.some((other) => other.subCategory === item.subCategory)) return false;
      }
      const next = replaceSlot(slots, parsed, item);
      return !scoreOutfit(next, context).rejected;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function swapPiece(outfit, slot, item, _items, ctx) {
  const parsed = parseSlot(slot);
  const slots = replaceSlot(outfit.slots || outfit, parsed, item);
  slots.notes = (outfit.slots || outfit).notes;
  const context = {
    tempC: ctx?.tempC ?? 16,
    rain: !!ctx?.rain,
    occasion: ctx?.occasion || "everyday",
    today: ctx?.today,
    wearLog: ctx?.wearLog || [],
  };
  return scoreOutfit(slots, context);
}

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

function occasionPool(items, predicate, ctx) {
  const owned = (items || []).filter(
    (item) => item && item.status === "owned" && predicate(item) && tempOk(item, ctx.tempC)
  );
  const occasion = ctx.occasion || "everyday";
  const matched = owned.filter((item) => (item.occasions || []).includes(occasion));
  if (matched.length) return matched;
  if (occasion !== "everyday") {
    return owned.filter((item) => (item.occasions || []).includes("everyday"));
  }
  return matched;
}

function preferRain(pool, rain) {
  if (!rain) return pool;
  const ok = pool.filter((item) => item.weather?.rainOk);
  return ok.length ? ok : pool;
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
  return `${occasion}${temp}°C ${sky} — ${formality}, ${palette}, ${layer}.`;
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
  if (tempC >= 20) return [{ mid: null, outer: null }];
  if (tempC < 14) {
    const outerChoices = outers.length ? outers : [null];
    const midChoices = tempC < 11 ? [null, ...mids] : [null];
    const choices = [];
    for (const outer of outerChoices) {
      for (const mid of midChoices) choices.push({ mid, outer });
    }
    return choices;
  }
  const choices = [];
  for (const mid of mids) choices.push({ mid, outer: null });
  for (const outer of outers) choices.push({ mid: null, outer });
  return choices;
}

function finish(slots, ctx) {
  const scored = scoreOutfit(slots, ctx);
  if (scored.rejected) return null;
  if (!slots.base || !slots.bottom || !slots.shoes) return null;
  return scored;
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
  const bottoms = occasionPool(list, (item) => item.category === "bottom", context);
  const bases = occasionPool(list, isBase, context);
  const shoes = preferRain(occasionPool(list, (item) => item.category === "shoes", context), context.rain);
  let outers = preferRain(occasionPool(list, isOuter, context), context.rain);
  const plan = layerPlan(context.tempC);
  if (plan.lightOuterOnly) outers = outers.filter(isLightOuter);
  const mids = plan.allowMid ? occasionPool(list, isMid, context) : [];
  let accessories = occasionPool(list, (item) => item.category === "accessory", context);
  accessories = accessories.slice().sort((a, b) => a.id.localeCompare(b.id));
  const sets = accessorySets(accessories);
  const layers = layerChoices(context.tempC, mids, outers);
  const bestByCore = new Map();

  for (const bottom of bottoms) {
    for (const base of bases) {
      for (const shoe of shoes) {
        for (const layer of layers) {
          const coreKey = [layer.outer?.id || "-", layer.mid?.id || "-", base.id, bottom.id, shoe.id].join("/");
          for (const accessoriesOfLook of sets) {
            const slots = {
              outer: layer.outer,
              mid: layer.mid,
              base,
              bottom,
              shoes: shoe,
              accessories: accessoriesOfLook,
            };
            const scored = finish(slots, context);
            if (!scored) continue;
            const prev = bestByCore.get(coreKey);
            if (!prev || scored.score > prev.score || (scored.score === prev.score && scored.itemIds.join() < prev.itemIds.join())) {
              bestByCore.set(coreKey, scored);
            }
          }
        }
      }
    }
  }

  return [...bestByCore.values()].sort((a, b) => (
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
  const pool = (items || []).filter((item) => {
    if (!item || item.status !== "owned") return false;
    if (current && item.id === current.id) return false;
    if (!matchesKind(item, parsed.kind)) return false;
    if (!tempOk(item, context.tempC)) return false;
    if (parsed.kind === "outer" && plan.lightOuterOnly && !isLightOuter(item)) return false;
    return true;
  });
  const rainLimited = (parsed.kind === "outer" || parsed.kind === "shoes") && context.rain && pool.some((item) => item.weather?.rainOk);
  return pool
    .filter((item) => {
      if (rainLimited && !item.weather?.rainOk) return false;
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
  const context = {
    tempC: ctx?.tempC ?? 16,
    rain: !!ctx?.rain,
    occasion: ctx?.occasion || "everyday",
    today: ctx?.today,
    wearLog: ctx?.wearLog || [],
  };
  return scoreOutfit(slots, context);
}

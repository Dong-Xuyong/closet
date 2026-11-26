import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { assembleOutfits, compatiblePieces, layerPlan, scoreOutfit, suggestOutfits, swapPiece, tempOk } from "../js/engine.js";
import { archiveItem, logWorn, saveOutfit, wearEntryId } from "../js/model.js";

const seed = JSON.parse(fs.readFileSync(new URL("../data/seed-closet.json", import.meta.url), "utf8"));
const TODAY = "2026-11-26";

function item(overrides) {
  const base = {
    id: overrides.id,
    name: overrides.name || overrides.id,
    status: "owned",
    category: "top",
    subCategory: "t-shirt",
    layer: "base",
    colors: { primary: "black", secondary: [], tone: "neutral", pattern: "solid" },
    formality: "casual",
    fit: "regular",
    care: { brand: null, size: null, fabric: null, washTempC: null, washMethod: null, tumbleDry: null, iron: null, notes: "" },
    weather: { seasons: ["spring", "summer", "autumn", "winter"], tempMinC: -5, tempMaxC: 40, rainOk: true, windOk: true },
    occasions: ["everyday"],
    pairing: { pairsWellWith: [], avoidWith: [], notes: "" },
    image: null,
    meta: { priceEur: null, productUrl: null, purchasedAt: null, lastWornAt: null, wearCount: 0, favorite: false, createdAt: "2026-11-01T00:00:00+00:00", updatedAt: "2026-11-01T00:00:00+00:00" },
  };
  return {
    ...base,
    ...overrides,
    colors: { ...base.colors, ...(overrides.colors || {}) },
    weather: { ...base.weather, ...(overrides.weather || {}) },
    pairing: { ...base.pairing, ...(overrides.pairing || {}) },
    care: { ...base.care, ...(overrides.care || {}) },
    meta: { ...base.meta, ...(overrides.meta || {}) },
  };
}

function slotsOf(pieces) {
  return {
    outer: pieces.outer || null,
    mid: pieces.mid || null,
    base: pieces.base,
    bottom: pieces.bottom,
    shoes: pieces.shoes,
    accessories: pieces.accessories || [],
  };
}

function ctx(extra = {}) {
  return { tempC: 18, rain: false, occasion: "everyday", today: TODAY, wearLog: [], ...extra };
}

function pieceList(slots) {
  return [slots.outer, slots.mid, slots.base, slots.bottom, slots.shoes, ...(slots.accessories || [])].filter(Boolean);
}

test("temperature window keeps a 3°C margin and treats null bounds as open", () => {
  const coat = item({ id: "coat", weather: { tempMinC: 2, tempMaxC: 16, rainOk: true, windOk: true } });
  assert.equal(tempOk(coat, 16), true);
  assert.equal(tempOk(coat, 19), true);
  assert.equal(tempOk(coat, 20), false);
  assert.equal(tempOk(coat, -1), true);
  assert.equal(tempOk(coat, -2), false);
  const open = item({ id: "open", weather: { tempMinC: null, tempMaxC: null, rainOk: true, windOk: true } });
  assert.equal(tempOk(open, -20), true);
  assert.equal(tempOk(open, 45), true);
});

test("layer plan follows the cold, shoulder, and warm bands", () => {
  assert.deepEqual(layerPlan(8), { mode: "cold-mid", requireOuter: true, allowMid: true, lightOuterOnly: false });
  assert.equal(layerPlan(11).allowMid, false);
  assert.equal(layerPlan(13).requireOuter, true);
  assert.equal(layerPlan(14).mode, "shoulder");
  assert.equal(layerPlan(19).lightOuterOnly, true);
  assert.equal(layerPlan(20).mode, "base");
  assert.equal(layerPlan(27).allowMid, false);
});

test("seed wardrobe layers for cold, cool, shoulder, and warm days", () => {
  const cold = assembleOutfits(seed.items, [], ctx({ tempC: 8 }));
  assert.ok(cold.length >= 1);
  assert.ok(cold.some((outfit) => outfit.slots.mid));
  assert.ok(cold.some((outfit) => !outfit.slots.mid));
  for (const outfit of cold) {
    assert.ok(outfit.slots.outer, "under 14°C includes outerwear");
    assert.equal(outfit.slots.base.layer, "base");
    assert.equal(outfit.slots.bottom.category, "bottom");
    assert.equal(outfit.slots.shoes.category, "shoes");
  }

  const cool = assembleOutfits(seed.items, [], ctx({ tempC: 12 }));
  assert.ok(cool.length >= 1);
  for (const outfit of cool) {
    assert.ok(outfit.slots.outer);
    assert.equal(outfit.slots.mid, null);
  }

  const shoulder = assembleOutfits(seed.items, [], ctx({ tempC: 16 }));
  assert.ok(shoulder.length >= 1);
  for (const outfit of shoulder) {
    const hasMid = !!outfit.slots.mid;
    const hasOuter = !!outfit.slots.outer;
    assert.notEqual(hasMid, hasOuter);
    if (outfit.slots.outer) {
      assert.equal(["puffer", "coat"].includes(outfit.slots.outer.subCategory), false);
    }
  }

  const warm = assembleOutfits(seed.items, [], ctx({ tempC: 22 }));
  assert.ok(warm.length >= 1);
  for (const outfit of warm) {
    assert.equal(outfit.slots.outer, null);
    assert.equal(outfit.slots.mid, null);
    assert.ok(outfit.slots.base);
  }
});

test("rain prefers rainOk outerwear and shoes when any exist", () => {
  const wet = assembleOutfits(seed.items, [], ctx({ tempC: 8, rain: true }));
  assert.ok(wet.length >= 1);
  for (const outfit of wet) {
    assert.equal(outfit.slots.outer.weather.rainOk, true);
    assert.equal(outfit.slots.shoes.weather.rainOk, true);
  }

  const onlyDry = item({ id: "dry-shoe", category: "shoes", layer: null, subCategory: "sneakers", weather: { rainOk: false, tempMinC: 0, tempMaxC: 40, windOk: true } });
  const looks = assembleOutfits(
    [
      item({ id: "tee", category: "top", layer: "base" }),
      item({ id: "pants", category: "bottom", layer: null, subCategory: "trousers" }),
      onlyDry,
    ],
    [],
    ctx({ tempC: 22, rain: true })
  );
  assert.equal(looks.length, 1);
  assert.equal(looks[0].slots.shoes.id, "dry-shoe");
});

test("gym with no gym pieces falls back to everyday", () => {
  const looks = suggestOutfits(seed.items, [], ctx({ tempC: 18, occasion: "gym" }));
  assert.ok(looks.length >= 1);
  for (const outfit of looks) {
    for (const piece of [outfit.slots.base, outfit.slots.bottom, outfit.slots.shoes, outfit.slots.mid, outfit.slots.outer].filter(Boolean)) {
      const occasions = piece.occasions || [];
      assert.ok(occasions.includes("gym") || occasions.includes("everyday"));
    }
  }
});

test("formality spread stays within 1 and sport never mixes with smart or formal", () => {
  const casualTop = item({ id: "tee", formality: "casual" });
  const smartTop = item({ id: "shirt", formality: "smart-casual", subCategory: "shirt" });
  const formalTop = item({ id: "dress-shirt", formality: "formal", subCategory: "shirt" });
  const sportTop = item({ id: "singlet", formality: "sport", subCategory: "t-shirt" });
  const casualBottom = item({ id: "jeans", category: "bottom", layer: null, subCategory: "jeans", formality: "casual" });
  const smartBottom = item({ id: "trousers", category: "bottom", layer: null, subCategory: "trousers", formality: "smart-casual" });
  const sportShoes = item({ id: "trainers", category: "shoes", layer: null, subCategory: "sneakers", formality: "sport" });
  const casualShoes = item({ id: "sneakers", category: "shoes", layer: null, subCategory: "sneakers", formality: "casual" });
  const smartShoes = item({ id: "derbies", category: "shoes", layer: null, subCategory: "boots", formality: "smart-casual" });

  const spreadOk = scoreOutfit(slotsOf({ base: smartTop, bottom: casualBottom, shoes: casualShoes }), ctx());
  assert.equal(spreadOk.breakdown.spread, 1);
  assert.equal(spreadOk.rejected, false);

  const spreadWide = scoreOutfit(slotsOf({ base: formalTop, bottom: casualBottom, shoes: casualShoes }), ctx());
  assert.equal(spreadWide.breakdown.spread, 2);
  assert.equal(spreadWide.rejected, true);

  const sportWithSmart = scoreOutfit(slotsOf({ base: sportTop, bottom: smartBottom, shoes: sportShoes }), ctx());
  assert.equal(sportWithSmart.rejected, true);

  const sportWithCasual = scoreOutfit(slotsOf({ base: sportTop, bottom: casualBottom, shoes: sportShoes }), ctx());
  assert.equal(sportWithCasual.rejected, false);

  const sportWatch = item({ id: "chrono", category: "accessory", layer: null, subCategory: "watch", formality: "smart-casual" });
  const sportPlusWatch = scoreOutfit(slotsOf({
    base: sportTop,
    bottom: casualBottom,
    shoes: sportShoes,
    accessories: [sportWatch],
  }), ctx());
  assert.equal(sportPlusWatch.rejected, true);

  const looks = assembleOutfits(
    [casualTop, smartTop, formalTop, sportTop, casualBottom, smartBottom, sportShoes, casualShoes, smartShoes],
    [],
    ctx({ tempC: 22 })
  );
  for (const outfit of looks) {
    assert.ok(outfit.breakdown.spread <= 1);
    const ranks = pieceList(outfit.slots).map((piece) => piece.formality);
    if (ranks.includes("sport")) {
      assert.equal(ranks.includes("smart-casual"), false);
      assert.equal(ranks.includes("formal"), false);
    }
  }
});

test("at most one accent tone and one non-solid pattern", () => {
  const solid = item({ id: "tee" });
  const striped = item({ id: "stripe", colors: { primary: "red", tone: "accent", pattern: "striped" }, formality: "casual" });
  const dotted = item({ id: "dots", category: "bottom", layer: null, subCategory: "trousers", colors: { primary: "purple", tone: "accent", pattern: "dotted" } });
  const shoes = item({ id: "sneakers", category: "shoes", layer: null, subCategory: "sneakers" });
  const plainBottom = item({ id: "jeans", category: "bottom", layer: null, subCategory: "jeans" });

  assert.equal(scoreOutfit(slotsOf({ base: striped, bottom: dotted, shoes }), ctx()).rejected, true);
  assert.equal(scoreOutfit(slotsOf({ base: striped, bottom: plainBottom, shoes }), ctx()).rejected, false);

  const textured = item({
    id: "cord",
    category: "outerwear",
    layer: "outer",
    subCategory: "jacket",
    colors: { primary: "brown", tone: "earth", pattern: "textured" },
  });
  assert.equal(scoreOutfit(slotsOf({ base: striped, bottom: plainBottom, shoes, outer: textured }), ctx({ tempC: 16 })).rejected, true);

  const shoulder = assembleOutfits(seed.items, [], ctx({ tempC: 16 }));
  for (const outfit of shoulder) {
    const pieces = pieceList(outfit.slots);
    assert.ok(pieces.filter((piece) => piece.colors.tone === "accent").length <= 1);
    assert.ok(pieces.filter((piece) => piece.colors.pattern !== "solid").length <= 1);
  }
});

test("avoidWith rejects id, subcategory, and color matches with a -10 penalty", () => {
  const top = item({ id: "black-tee", colors: { primary: "black", tone: "neutral", pattern: "solid" } });
  const shoes = item({ id: "sneakers", category: "shoes", layer: null, subCategory: "sneakers", colors: { primary: "white", tone: "neutral", pattern: "solid" } });
  const byColor = item({
    id: "navy-trousers",
    category: "bottom",
    layer: null,
    subCategory: "trousers",
    colors: { primary: "navy", tone: "neutral", pattern: "solid" },
    pairing: { pairsWellWith: [], avoidWith: ["black"], notes: "" },
  });
  const byId = item({
    id: "safe-jeans",
    category: "bottom",
    layer: null,
    subCategory: "jeans",
    colors: { primary: "blue", tone: "cool", pattern: "solid" },
    pairing: { pairsWellWith: [], avoidWith: ["black-tee"], notes: "" },
  });
  const bySub = item({
    id: "no-tees",
    category: "bottom",
    layer: null,
    subCategory: "chinos",
    colors: { primary: "beige", tone: "earth", pattern: "solid" },
    pairing: { pairsWellWith: [], avoidWith: ["t-shirt"], notes: "" },
  });

  for (const bottom of [byColor, byId, bySub]) {
    const scored = scoreOutfit(slotsOf({ base: top, bottom, shoes }), ctx());
    assert.equal(scored.breakdown.avoid, -10);
    assert.equal(scored.rejected, true);
  }

  const looks = assembleOutfits(seed.items, [], ctx({ tempC: 22 }));
  for (const outfit of looks) {
    const ids = outfit.itemIds;
    if (ids.includes("cl_navy_trousers")) {
      const mains = [outfit.slots.base, outfit.slots.bottom, outfit.slots.shoes].filter(Boolean);
      assert.equal(mains.some((piece) => piece.colors.primary === "black" && piece.category !== "accessory"), false);
    }
  }
});

test("soft clashes: black+navy, brown+black, and double oversized", () => {
  const shoes = item({ id: "sneakers", category: "shoes", layer: null, subCategory: "sneakers", colors: { primary: "grey", tone: "neutral", pattern: "solid" } });
  const blackBottom = item({ id: "black-trouser", category: "bottom", layer: null, subCategory: "trousers", colors: { primary: "black", tone: "neutral", pattern: "solid" } });
  const navyTop = item({ id: "navy-tee", colors: { primary: "navy", tone: "neutral", pattern: "solid" } });
  const charcoalTop = item({ id: "charcoal-tee", colors: { primary: "charcoal", tone: "neutral", pattern: "solid" } });
  const friendlyNavy = item({
    id: "navy-knit",
    colors: { primary: "navy", tone: "neutral", pattern: "solid" },
    pairing: { pairsWellWith: ["black"], avoidWith: [], notes: "" },
  });

  const clash = scoreOutfit(slotsOf({ base: navyTop, bottom: blackBottom, shoes }), ctx());
  const calm = scoreOutfit(slotsOf({ base: charcoalTop, bottom: blackBottom, shoes }), ctx());
  assert.equal(clash.breakdown.blackNavy, -2);
  assert.equal(calm.breakdown.blackNavy, 0);
  assert.equal(calm.score - clash.score, 2);

  const waived = scoreOutfit(slotsOf({ base: friendlyNavy, bottom: blackBottom, shoes }), ctx());
  assert.equal(waived.breakdown.blackNavy, 0);

  const brownJacket = item({
    id: "brown-jacket",
    category: "outerwear",
    layer: "outer",
    subCategory: "jacket",
    colors: { primary: "brown", tone: "earth", pattern: "solid" },
  });
  const charcoalJacket = item({
    id: "charcoal-jacket",
    category: "outerwear",
    layer: "outer",
    subCategory: "jacket",
    colors: { primary: "charcoal", tone: "neutral", pattern: "solid" },
  });
  const brownLook = scoreOutfit(slotsOf({ base: charcoalTop, bottom: blackBottom, shoes, outer: brownJacket }), ctx());
  const charcoalLook = scoreOutfit(slotsOf({ base: charcoalTop, bottom: blackBottom, shoes, outer: charcoalJacket }), ctx());
  assert.equal(brownLook.breakdown.brownBlack, -1);
  assert.equal(charcoalLook.breakdown.brownBlack, 0);
  assert.equal(charcoalLook.score - brownLook.score, 1);

  const bigTop = item({ id: "big-tee", fit: "oversized" });
  const bigBottom = item({ id: "big-trouser", category: "bottom", layer: null, subCategory: "trousers", fit: "oversized" });
  const regularBottom = item({ id: "reg-trouser", category: "bottom", layer: null, subCategory: "trousers", fit: "regular" });
  const doubled = scoreOutfit(slotsOf({ base: bigTop, bottom: bigBottom, shoes }), ctx());
  const single = scoreOutfit(slotsOf({ base: bigTop, bottom: regularBottom, shoes }), ctx());
  assert.equal(doubled.breakdown.oversized, -2);
  assert.equal(single.breakdown.oversized, 0);
  assert.equal(single.score - doubled.score, 2);
});

test("scoring awards occasion, pairing, contrast, monochrome, and favorites", () => {
  const tee = item({
    id: "white-tee",
    colors: { primary: "white", tone: "neutral", pattern: "solid" },
    occasions: ["everyday", "work"],
    pairing: { pairsWellWith: ["black"], avoidWith: [], notes: "" },
    meta: { favorite: true },
  });
  const trousers = item({
    id: "black-trouser",
    category: "bottom",
    layer: null,
    subCategory: "trousers",
    colors: { primary: "black", tone: "neutral", pattern: "solid" },
    occasions: ["everyday", "work"],
    pairing: { pairsWellWith: ["white"], avoidWith: [], notes: "" },
  });
  const shoes = item({
    id: "sneakers",
    category: "shoes",
    layer: null,
    subCategory: "sneakers",
    colors: { primary: "grey", tone: "neutral", pattern: "solid" },
    occasions: ["everyday"],
  });
  const work = scoreOutfit(slotsOf({ base: tee, bottom: trousers, shoes }), ctx({ occasion: "work" }));
  assert.equal(work.breakdown.occasion, 0);
  const everyday = scoreOutfit(slotsOf({ base: tee, bottom: trousers, shoes }), ctx());
  assert.equal(everyday.breakdown.occasion, 3);
  assert.equal(everyday.breakdown.pairs, 4);
  assert.equal(everyday.breakdown.contrast, 2);
  assert.equal(everyday.breakdown.favorites, 1);

  const blackTee = item({ id: "black-tee", colors: { primary: "black", tone: "neutral", pattern: "solid" }, occasions: ["everyday"] });
  const blackShoes = item({ id: "black-shoes", category: "shoes", layer: null, subCategory: "boots", colors: { primary: "black", tone: "neutral", pattern: "solid" }, occasions: ["everyday"] });
  const mono = scoreOutfit(slotsOf({ base: blackTee, bottom: trousers, shoes: blackShoes }), ctx());
  assert.equal(mono.breakdown.palette, "mono");
  assert.equal(mono.breakdown.contrast, 2);
});

test("wear log penalises core pieces from the last 2 and 4 days, not shoes", () => {
  const top = item({ id: "tee" });
  const bottom = item({ id: "jeans", category: "bottom", layer: null, subCategory: "jeans" });
  const shoes = item({ id: "sneakers", category: "shoes", layer: null, subCategory: "sneakers" });
  const fresh = scoreOutfit(slotsOf({ base: top, bottom, shoes }), ctx());
  const recent = scoreOutfit(slotsOf({ base: top, bottom, shoes }), ctx({
    wearLog: [{ id: "wear_20261125_abcd", date: "2026-11-25", itemIds: ["tee"], occasion: "everyday", tempC: 16, rain: false, rating: null, notes: "" }],
  }));
  const four = scoreOutfit(slotsOf({ base: top, bottom, shoes }), ctx({
    wearLog: [{ id: "wear_20261122_abcd", date: "2026-11-22", itemIds: ["jeans"], occasion: "everyday", tempC: 16, rain: false, rating: null, notes: "" }],
  }));
  const five = scoreOutfit(slotsOf({ base: top, bottom, shoes }), ctx({
    wearLog: [{ id: "wear_20261121_abcd", date: "2026-11-21", itemIds: ["tee"], occasion: "everyday", tempC: 16, rain: false, rating: null, notes: "" }],
  }));
  const shoeWear = scoreOutfit(slotsOf({ base: top, bottom, shoes }), ctx({
    wearLog: [{ id: "wear_20261126_shoe", date: "2026-11-26", itemIds: ["sneakers"], occasion: "everyday", tempC: 16, rain: false, rating: null, notes: "" }],
  }));
  assert.equal(fresh.score - recent.score, 4);
  assert.equal(fresh.score - four.score, 2);
  assert.equal(five.score, fresh.score);
  assert.equal(shoeWear.score, fresh.score);

  const ranked = suggestOutfits(
    [top, bottom, shoes, item({ id: "other-tee", name: "Other tee" })],
    [{ id: "wear_20261126_tee", date: TODAY, itemIds: ["tee"], occasion: "everyday", tempC: 18, rain: false, rating: null, notes: "" }],
    ctx({ tempC: 22 })
  );
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].slots.base.id, "other-tee");
});

test("top 3 are ranked, explained in one line, and distinct in the core", () => {
  const looks = suggestOutfits(seed.items, [], ctx({ tempC: 15, rain: true, occasion: "work" }));
  assert.ok(looks.length >= 1);
  assert.ok(looks.length <= 3);
  for (let i = 1; i < looks.length; i += 1) assert.ok(looks[i - 1].score >= looks[i].score);
  const cores = new Set(looks.map((outfit) => [outfit.slots.outer?.id, outfit.slots.mid?.id, outfit.slots.base.id, outfit.slots.bottom.id, outfit.slots.shoes.id].join()));
  assert.equal(cores.size, looks.length);
  for (const outfit of looks) {
    assert.equal(outfit.why.includes("\n"), false);
    assert.match(outfit.why, /15°C/);
    assert.match(outfit.why, /rainy/);
    assert.match(outfit.why, /work/i);
  }
  const all = assembleOutfits(seed.items, [], ctx({ tempC: 15, rain: true, occasion: "work" }));
  assert.deepEqual(looks.map((outfit) => outfit.itemIds.join()), all.slice(0, 3).map((outfit) => outfit.itemIds.join()));
});

test("swap replaces one slot with a compatible owned piece and leaves the rest", () => {
  const context = ctx({ tempC: 22 });
  const looks = suggestOutfits(seed.items, [], context);
  let swapped = null;
  let source = null;
  for (const outfit of looks) {
    const options = compatiblePieces(outfit, "bottom", seed.items, context);
    if (!options.length) continue;
    source = outfit;
    swapped = swapPiece(outfit, "bottom", options[0], seed.items, context);
    assert.equal(swapped.slots.bottom.id, options[0].id);
    assert.notEqual(swapped.slots.bottom.id, outfit.slots.bottom.id);
    assert.equal(swapped.slots.base.id, outfit.slots.base.id);
    assert.equal(swapped.slots.shoes.id, outfit.slots.shoes.id);
    assert.equal(swapped.rejected, false);
    assert.equal(outfit.slots.bottom.id === options[0].id, false);
    break;
  }
  assert.ok(source && swapped);

  const blackTop = item({ id: "black-tee", colors: { primary: "black", tone: "neutral", pattern: "solid" } });
  const whiteBottom = item({ id: "white-jeans", category: "bottom", layer: null, subCategory: "jeans", colors: { primary: "white", tone: "neutral", pattern: "solid" } });
  const navyBottom = item({
    id: "navy-trousers",
    category: "bottom",
    layer: null,
    subCategory: "trousers",
    colors: { primary: "navy", tone: "neutral", pattern: "solid" },
    pairing: { pairsWellWith: [], avoidWith: ["black"], notes: "" },
  });
  const beigeBottom = item({ id: "beige-chinos", category: "bottom", layer: null, subCategory: "chinos", colors: { primary: "beige", tone: "earth", pattern: "solid" } });
  const shoes = item({ id: "sneakers", category: "shoes", layer: null, subCategory: "sneakers", colors: { primary: "grey", tone: "neutral", pattern: "solid" } });
  const outfit = scoreOutfit(slotsOf({ base: blackTop, bottom: whiteBottom, shoes }), context);
  const options = compatiblePieces(outfit, "bottom", [blackTop, whiteBottom, navyBottom, beigeBottom, shoes], context);
  assert.deepEqual(options.map((piece) => piece.id), ["beige-chinos"]);
});

test("logging a look appends a stable wear id and updates wear stats without mutating the input", () => {
  assert.match(wearEntryId("2026-11-26", () => 0), /^wear_20261126_[a-z0-9]{4}$/);
  const before = structuredClone(seed);
  const outfit = suggestOutfits(seed.items, [], ctx({ tempC: 22 }))[0];
  const next = logWorn(seed, outfit.itemIds, {
    date: TODAY,
    occasion: "everyday",
    tempC: 22,
    rain: false,
    rating: null,
    notes: "",
    id: "wear_20261126_a7f2",
    now: "2026-11-26T18:00:00+00:00",
  });
  assert.equal(seed.wearLog.length, 0);
  assert.equal(next.wearLog.at(-1).id, "wear_20261126_a7f2");
  assert.equal(next.wearLog.at(-1).date, TODAY);
  assert.deepEqual(next.wearLog.at(-1).itemIds, outfit.itemIds);
  for (const id of outfit.itemIds) {
    const updated = next.items.find((piece) => piece.id === id);
    const original = before.items.find((piece) => piece.id === id);
    assert.equal(updated.meta.wearCount, (original.meta.wearCount || 0) + 1);
    assert.equal(updated.meta.lastWornAt, TODAY);
    assert.equal(original.meta.wearCount, 0);
  }

  const saved = saveOutfit(next, {
    id: "out_test_look",
    name: "Test look",
    itemIds: outfit.itemIds,
    occasions: ["everyday"],
    notes: "Kept",
    now: "2026-11-26T18:05:00+00:00",
  });
  assert.equal(saved.outfits.at(-1).id, "out_test_look");
  assert.equal(next.outfits.length + 1, saved.outfits.length);

  const archived = archiveItem(saved, outfit.itemIds[0], "2026-11-26T18:06:00+00:00");
  const hidden = archived.items.find((piece) => piece.id === outfit.itemIds[0]);
  assert.equal(hidden.status, "archived");
  assert.equal(archived.items.length, saved.items.length);
});

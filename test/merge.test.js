import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { mergeCloset } from "../js/merge.js";
import { imageSrc } from "../js/vocab.js";
import { forecastFromMeteo } from "../js/weather.js";

function item(id, name, updatedAt, extra = {}) {
  return {
    id,
    name,
    status: extra.status || "owned",
    meta: { updatedAt },
    ...extra,
  };
}

test("items: newer meta.updatedAt wins and archived rows are kept", () => {
  const local = {
    items: [
      item("a", "Old", "2026-11-01T00:00:00+00:00", { legacy: true }),
      item("gone-remote", "Kept locally", "2026-11-02T00:00:00+00:00", { status: "archived" }),
    ],
  };
  const remote = {
    items: [
      item("a", "New", "2026-11-20T00:00:00+00:00", { bin: "shelf" }),
      item("remote-only", "From the phone", "2026-11-20T00:00:00+00:00"),
    ],
  };
  const merged = mergeCloset(null, local, remote);
  const a = merged.items.find((row) => row.id === "a");
  assert.equal(a.name, "New");
  assert.equal(a.bin, "shelf");
  assert.equal(a.legacy, true);
  assert.equal(merged.items.find((row) => row.id === "gone-remote").status, "archived");
  assert.equal(merged.items.find((row) => row.id === "remote-only").name, "From the phone");
  assert.equal(merged.items.length, 3);
});

test("equal item timestamps prefer the local record", () => {
  const stamp = "2026-11-20T00:00:00+00:00";
  const merged = mergeCloset(null, {
    items: [item("a", "Local", stamp)],
  }, {
    items: [item("a", "Remote", stamp)],
  });
  assert.equal(merged.items[0].name, "Local");
});

test("outfits merge by id using updatedAt, then createdAt", () => {
  const byUpdate = mergeCloset(null, {
    outfits: [{ id: "o", name: "Local", createdAt: "2026-11-01T00:00:00+00:00" }],
  }, {
    outfits: [{ id: "o", name: "Remote", createdAt: "2026-11-01T00:00:00+00:00", updatedAt: "2026-11-02T00:00:00+00:00" }],
  });
  assert.equal(byUpdate.outfits[0].name, "Remote");

  const byCreated = mergeCloset(null, {
    outfits: [{ id: "o", name: "Local", createdAt: "2026-11-05T00:00:00+00:00", note: "keep" }],
  }, {
    outfits: [{ id: "o", name: "Remote", createdAt: "2026-11-01T00:00:00+00:00" }],
  });
  assert.equal(byCreated.outfits[0].name, "Local");
  assert.equal(byCreated.outfits[0].note, "keep");

  const union = mergeCloset(null, {
    outfits: [{ id: "local-only", name: "L", createdAt: "2026-11-01T00:00:00+00:00" }],
  }, {
    outfits: [{ id: "remote-only", name: "R", createdAt: "2026-11-02T00:00:00+00:00" }],
  });
  assert.deepEqual(union.outfits.map((outfit) => outfit.id).sort(), ["local-only", "remote-only"]);
});

test("wearLog unions by id and never drops an entry", () => {
  const local = {
    wearLog: [
      { id: "wear_20261126_a7f2", date: "2026-11-26", itemIds: ["cl_white_tees"], occasion: "everyday", tempC: 12, rain: false, rating: 5, notes: "local", device: "phone" },
    ],
  };
  const remote = {
    wearLog: [
      { id: "wear_20261126_a7f2", date: "2026-11-26", itemIds: ["cl_white_tees"], occasion: "everyday", tempC: 12, rain: false, rating: null, notes: "remote", source: "laptop" },
      { id: "wear_20261125_bb01", date: "2026-11-25", itemIds: ["cl_sneakers"], occasion: "work", tempC: 14, rain: true, rating: 3, notes: "" },
    ],
  };
  const merged = mergeCloset(null, local, remote);
  assert.equal(merged.wearLog.length, 2);
  const same = merged.wearLog.find((entry) => entry.id === "wear_20261126_a7f2");
  assert.equal(same.notes, "local");
  assert.equal(same.rating, 5);
  assert.equal(same.source, "laptop");
  assert.ok(merged.wearLog.some((entry) => entry.id === "wear_20261125_bb01"));

  const kept = mergeCloset(
    { wearLog: [{ id: "wear_20261120_aaaa", date: "2026-11-20", itemIds: [], notes: "" }] },
    { wearLog: [{ id: "wear_20261120_aaaa", date: "2026-11-20", itemIds: [], notes: "" }] },
    { wearLog: [] }
  );
  assert.equal(kept.wearLog.length, 1);
  assert.equal(kept.wearLog[0].id, "wear_20261120_aaaa");
});

test("unknown top-level keys and profile fields survive the merge", () => {
  const merged = mergeCloset(null, {
    app: "closet",
    version: 1,
    updatedAt: "2026-11-26T12:00:00+00:00",
    custom: 1,
    profile: { city: "Guimarães", heightCm: 171 },
    items: [],
    outfits: [],
    wearLog: [],
  }, {
    updatedAt: "2026-11-20T12:00:00+00:00",
    bonus: 2,
    profile: { city: "Porto", lat: 41.44 },
    items: [],
    outfits: [],
    wearLog: [],
  });
  assert.equal(merged.custom, 1);
  assert.equal(merged.bonus, 2);
  assert.equal(merged.profile.city, "Guimarães");
  assert.equal(merged.profile.lat, 41.44);
  assert.equal(merged.profile.heightCm, 171);
  assert.equal(merged.updatedAt, "2026-11-26T12:00:00+00:00");
  assert.equal(merged.app, "closet");
});

test("gh-sync uses the closet merge on save and leaves other apps on merge3", () => {
  const sandbox = {
    console,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch() { return Promise.reject(new Error("no network")); },
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    ClosetMerge: { mergeCloset },
    prompt() { return null; },
    confirm() { return true; },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL("../dong-ui/gh-sync.js", import.meta.url), "utf8"), sandbox);

  const local = { items: [item("a", "Old", "2026-11-01T00:00:00+00:00")] };
  const remote = { items: [item("a", "New", "2026-11-20T00:00:00+00:00")] };
  assert.equal(sandbox.GhSync.mergeForSave("closet", null, local, remote).items[0].name, "New");

  const base = { items: [{ id: "a", name: "A" }], wearLog: [{ id: "wear_20261120_aaaa", date: "2026-11-20", itemIds: ["a"] }] };
  const unchanged = { items: [{ id: "a", name: "A" }], wearLog: [{ id: "wear_20261120_aaaa", date: "2026-11-20", itemIds: ["a"] }] };
  const deletedRemote = { items: [], wearLog: [] };
  const closet = sandbox.GhSync.mergeForSave("closet", base, unchanged, deletedRemote);
  assert.equal(closet.items[0].id, "a");
  assert.equal(closet.wearLog[0].id, "wear_20261120_aaaa");

  const generic = sandbox.GhSync.mergeForSave("other", base, unchanged, deletedRemote);
  assert.equal(generic.items.length, 0);
  assert.equal(generic.wearLog.length, 0);
});

test("Open-Meteo forecast uses apparent temperature and rain thresholds", () => {
  const wetDay = forecastFromMeteo({
    current: { apparent_temperature: 11.2, temperature_2m: 11.5, precipitation: 0, precipitation_probability: 16 },
    daily: { apparent_temperature_mean: [9.3], precipitation_sum: [1.1], precipitation_probability_max: [18] },
  });
  assert.equal(wetDay.tempC, 11);
  assert.equal(wetDay.rain, true);

  const likely = forecastFromMeteo({ current: { temperature_2m: 18.4, precipitation: 0, precipitation_probability: 40 } });
  assert.equal(likely.tempC, 18);
  assert.equal(likely.rain, true);

  const dry = forecastFromMeteo({ current: { apparent_temperature: 22.2, precipitation: 0.2, precipitation_probability: 10 } });
  assert.equal(dry.tempC, 22);
  assert.equal(dry.rain, false);
  assert.equal(forecastFromMeteo({}), null);
});

test("image field resolves relative paths, urls, and data-urls", () => {
  assert.equal(imageSrc(null), null);
  assert.equal(imageSrc(""), null);
  assert.equal(imageSrc("images/cl_black_trousers.webp"), "images/cl_black_trousers.webp");
  assert.equal(imageSrc("/images/cl_black_trousers.webp"), "images/cl_black_trousers.webp");
  assert.equal(imageSrc("https://cdn.example/coat.webp"), "https://cdn.example/coat.webp");
  assert.equal(imageSrc("data:image/jpeg;base64,aaaa"), "data:image/jpeg;base64,aaaa");
});

test("bundled seed uses image, not photo, and keeps the mafia outfit", () => {
  const seed = JSON.parse(fs.readFileSync(new URL("../data/seed-closet.json", import.meta.url), "utf8"));
  assert.equal(seed.app, "closet");
  assert.equal(seed.items.length, 25);
  assert.equal(seed.items.filter((piece) => piece.status === "owned").length, 18);
  assert.equal(seed.items.filter((piece) => piece.status === "wishlist").length, 7);
  for (const piece of seed.items) {
    assert.equal("image" in piece, true);
    assert.equal("photo" in piece, false);
    assert.equal(piece.image, null);
  }
  assert.equal(seed.outfits[0].id, "out_mafia_boss_2000s");
  assert.equal(seed.outfits[0].name, "2000s Mafia Boss (Zara Party 10 Dec)");
  assert.ok(seed.outfits[0].itemIds.includes("cl_zara_wool_coat_black"));
  assert.deepEqual(seed.wearLog, []);
});

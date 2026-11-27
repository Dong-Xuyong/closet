import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { autoLoadCloset, mergeSeedIntoCache, readGithubToken } from "../js/startup.js";

const seed = JSON.parse(fs.readFileSync(new URL("../data/seed-closet.json", import.meta.url), "utf8"));

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

test("an older cache picks up new seed items and image paths without dropping local edits", () => {
  const imaged = seed.items.find((piece) => piece.image && piece.id === "cl_zara_wool_coat_black");
  assert.ok(imaged);
  const stale = structuredClone(imaged);
  stale.image = null;
  stale.status = "wishlist";
  stale.meta.updatedAt = "2026-11-26T23:27:08+00:00";

  const editedSource = seed.items.find((piece) => piece.id === "cl_black_trousers");
  const edited = structuredClone(editedSource);
  edited.name = "Black trousers (hemmed)";
  edited.image = "data:image/webp;base64,local";
  edited.meta.updatedAt = "2026-11-27T12:00:00+00:00";
  edited.meta.wearCount = 4;

  const cached = {
    app: "closet",
    version: 1,
    updatedAt: "2026-11-26T23:27:08+00:00",
    items: [stale, edited],
    outfits: [{
      id: "out_local_rain",
      name: "Tuesday rain",
      createdAt: "2026-11-27T08:00:00+00:00",
      updatedAt: "2026-11-27T08:00:00+00:00",
      itemIds: [edited.id],
    }],
    wearLog: [{
      id: "wear_20261127_a7f2",
      date: "2026-11-27",
      itemIds: [edited.id],
      occasion: "work",
      tempC: 12,
      rain: true,
      rating: 4,
      notes: "kept locally",
    }],
  };

  const merged = mergeSeedIntoCache(cached, seed);
  assert.equal(merged.items.length, seed.items.length);

  const coat = merged.items.find((piece) => piece.id === imaged.id);
  assert.equal(coat.image, "images/cl_zara_wool_coat_black.webp");
  assert.equal(coat.status, "owned");

  const trousers = merged.items.find((piece) => piece.id === edited.id);
  assert.equal(trousers.name, "Black trousers (hemmed)");
  assert.equal(trousers.image, "data:image/webp;base64,local");
  assert.equal(trousers.meta.wearCount, 4);

  assert.equal(merged.wearLog.length, 1);
  assert.equal(merged.wearLog[0].id, "wear_20261127_a7f2");
  assert.equal(merged.wearLog[0].notes, "kept locally");
  assert.ok(merged.outfits.some((outfit) => outfit.id === "out_local_rain" && outfit.name === "Tuesday rain"));
  assert.ok(merged.outfits.some((outfit) => outfit.id === "out_mafia_boss_2000s"));
  assert.ok(merged.items.some((piece) => piece.id === "cl_beige_oversized_tee" && piece.image === "images/cl_beige_oversized_tee.webp"));
});

test("startup auto-loads closet.json only when a dong-gh-sync token is already saved", async () => {
  const calls = [];
  const ghSync = {
    load(appId, applyRemote) {
      calls.push({ appId, applyRemote });
      applyRemote({
        items: [{ id: "cl_from_github", name: "From GitHub", image: "images/cl_from_github.webp", meta: { updatedAt: "2026-11-27T00:18:00+00:00" } }],
        wearLog: [],
        outfits: [],
      });
      return Promise.resolve("Imported from GitHub");
    },
  };
  const apply = (remote) => {
    calls.push({ applied: remote.items[0].id });
  };

  assert.equal(readGithubToken(memoryStorage()), false);
  assert.equal(autoLoadCloset(memoryStorage(), ghSync, apply), null);
  assert.equal(autoLoadCloset(memoryStorage({ "dong-gh-sync": "not-json" }), ghSync, apply), null);
  assert.equal(autoLoadCloset(memoryStorage({ "dong-gh-sync": JSON.stringify({ repo: "Dong-Xuyong/progress-sync" }) }), ghSync, apply), null);
  assert.equal(calls.length, 0);

  const linked = memoryStorage({ "dong-gh-sync": JSON.stringify({ token: "github_pat_saved", repo: "Dong-Xuyong/progress-sync" }) });
  const pending = autoLoadCloset(linked, ghSync, apply);
  assert.equal(typeof pending?.then, "function");
  assert.equal(await pending, "Imported from GitHub");
  assert.equal(calls[0].appId, "closet");
  assert.equal(calls[1].applied, "cl_from_github");
  assert.equal(autoLoadCloset(linked, null, apply), null);
});

test("boot always refreshes the seed and starts a quiet GitHub load", () => {
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /fetch\(SEED_URL,\s*\{\s*cache:\s*"no-store"\s*\}\)/);
  assert.match(app, /mergeSeedIntoCache\(cached,\s*seed\)/);
  assert.match(app, /autoLoadCloset\(localStorage,\s*globalThis\.GhSync,\s*applyRemote\)/);
});

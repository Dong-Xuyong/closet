/**
 * Startup wardrobe resolution.
 *
 * Returning visitors keep localStorage (`closet-v1`). A fresh seed is always
 * merged in so new pieces and studio image paths arrive without a token,
 * while local wearLog, outfits, and newer item edits stay. A saved
 * dong-gh-sync token then loads progress-sync/closet.json in the background.
 */

import { mergeCloset } from "./merge.js";

export const SEED_URL = "data/seed-closet.json";

export function readGithubToken(storage) {
  try {
    const cfg = JSON.parse(storage.getItem("dong-gh-sync") || "null");
    return !!(cfg && cfg.token);
  } catch {
    return false;
  }
}

/**
 * Merge a freshly fetched seed into a cached closet.
 * `mergeCloset` unions wearLog by id, keeps the newer item/outfit record,
 * and adds seed-only pieces (including their image paths).
 */
export function mergeSeedIntoCache(cached, seed) {
  if (cached && seed) return mergeCloset(null, cached, seed);
  return cached || seed || null;
}

/**
 * Quiet background import. Returns the GhSync.load promise when a token is
 * already saved, otherwise null so startup never prompts for a token.
 */
export function autoLoadCloset(storage, ghSync, applyRemote) {
  if (!readGithubToken(storage) || !ghSync || typeof ghSync.load !== "function") return null;
  return ghSync.load("closet", applyRemote);
}

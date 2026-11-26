/**
 * Closet sync merge for progress-sync/closet.json.
 *
 * wearLog  — union by id (append-only, never drop an id)
 * items    — union by id; newer meta.updatedAt wins; archived rows stay
 * outfits  — union by id; newer updatedAt, else createdAt, wins
 * Unknown keys on the losing record are kept.
 *
 * `base` is accepted so gh-sync can call this with the same
 * (base, local, remote) shape as its generic merge. Closet never
 * hard-deletes, so base is not used to drop records.
 */

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (value == null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

/** Winner's values win. Keys only the loser has are copied across. */
function overlayUnknown(winner, loser) {
  if (Array.isArray(winner) || !isPlainObject(winner)) return clone(winner);
  const lose = isPlainObject(loser) ? loser : {};
  const out = {};
  for (const key of Object.keys(winner)) {
    if (isPlainObject(winner[key]) && isPlainObject(lose[key])) {
      out[key] = overlayUnknown(winner[key], lose[key]);
    } else {
      out[key] = clone(winner[key]);
    }
  }
  for (const key of Object.keys(lose)) {
    if (!(key in out)) out[key] = clone(lose[key]);
  }
  return out;
}

function instant(value) {
  if (!value) return NaN;
  const time = Date.parse(value);
  return Number.isNaN(time) ? NaN : time;
}

function itemStamp(item) {
  const time = instant(item && item.meta && item.meta.updatedAt);
  return Number.isNaN(time) ? 0 : time;
}

function outfitStamp(outfit) {
  const raw = (outfit && (outfit.updatedAt || outfit.createdAt)) || "";
  const time = instant(raw);
  return Number.isNaN(time) ? 0 : time;
}

function pickNewer(localRec, remoteRec, stampOf) {
  const localWins = stampOf(localRec) >= stampOf(remoteRec);
  return overlayUnknown(
    localWins ? localRec : remoteRec,
    localWins ? remoteRec : localRec
  );
}

function mergeById(localArr, remoteArr, stampOf) {
  const local = Array.isArray(localArr) ? localArr : [];
  const remote = Array.isArray(remoteArr) ? remoteArr : [];
  const remoteById = new Map();
  for (const record of remote) {
    if (record && record.id != null) remoteById.set(String(record.id), record);
  }
  const seen = new Set();
  const out = [];
  for (const record of local) {
    if (!record || record.id == null) continue;
    const id = String(record.id);
    seen.add(id);
    if (remoteById.has(id)) out.push(pickNewer(record, remoteById.get(id), stampOf));
    else out.push(clone(record));
  }
  for (const record of remote) {
    if (!record || record.id == null) continue;
    const id = String(record.id);
    if (seen.has(id)) continue;
    out.push(clone(record));
  }
  return out;
}

/** Append-only union. Same id: local fields win, remote-only keys survive. */
function unionWear(localArr, remoteArr) {
  const local = Array.isArray(localArr) ? localArr : [];
  const remote = Array.isArray(remoteArr) ? remoteArr : [];
  const remoteById = new Map();
  for (const record of remote) {
    if (record && record.id != null) remoteById.set(String(record.id), record);
  }
  const seen = new Set();
  const out = [];
  for (const record of local) {
    if (!record || record.id == null) continue;
    const id = String(record.id);
    seen.add(id);
    out.push(
      remoteById.has(id) ? overlayUnknown(record, remoteById.get(id)) : clone(record)
    );
  }
  for (const record of remote) {
    if (!record || record.id == null) continue;
    const id = String(record.id);
    if (seen.has(id)) continue;
    out.push(clone(record));
  }
  return out;
}

function newerString(localValue, remoteValue) {
  const localTime = instant(localValue);
  const remoteTime = instant(remoteValue);
  if (Number.isNaN(localTime) && Number.isNaN(remoteTime)) return localValue || remoteValue || null;
  if (Number.isNaN(localTime)) return remoteValue;
  if (Number.isNaN(remoteTime)) return localValue;
  return localTime >= remoteTime ? localValue : remoteValue;
}

export function mergeCloset(_base, local, remote) {
  if (remote == null) return clone(local);
  if (local == null) return clone(remote);
  const left = isPlainObject(local) ? local : {};
  const right = isPlainObject(remote) ? remote : {};
  const shell = overlayUnknown(left, right);
  shell.app = "closet";
  shell.version = left.version || right.version || 1;
  shell.updatedAt = newerString(left.updatedAt, right.updatedAt);
  shell.profile = overlayUnknown(left.profile || {}, right.profile || {});
  shell.items = mergeById(left.items, right.items, itemStamp);
  shell.outfits = mergeById(left.outfits, right.outfits, outfitStamp);
  shell.wearLog = unionWear(left.wearLog, right.wearLog);
  return shell;
}

// How TizCat sync merges, with no browser calls (so tests run it in Node).
//
// Every kind of synced data is a map of records: {id: record}. A sync
// compares three copies of that map: what this TizCat has now ("local"),
// what the server has ("remote"), and what both had after the last sync
// ("base"). Per record:
//   - the same on both sides: kept;
//   - changed on one side only: that side's version;
//   - deleted on one side, changed on the other: the change is kept (nothing
//     edited is lost to a delete);
//   - changed on both: the server's version (the TizCat that synced first).

// The text of a value with object keys in order, so equal values compare
// equal however they were built.
export function stable(value) {
  if (value === undefined) {
    return "~";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(",")}]`;
  }
  return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
}

export function same(a, b) {
  return stable(a) === stable(b);
}

export function mergeRecords(base, local, remote) {
  const out = {};
  const ids = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const id of ids) {
    const b = base[id];
    const l = local[id];
    const r = remote[id];
    let pick;
    if (same(l, r)) pick = l;
    else if (same(l, b)) pick = r;
    else if (same(r, b)) pick = l;
    else if (l === undefined) pick = r;
    else if (r === undefined) pick = l;
    else pick = r;
    if (pick !== undefined) {
      out[id] = pick;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bookmarks: records are {parent, pos, title, url} or {parent, pos, title,
// folder: true}; parent is another record's id or a root ("bar", "other",
// "mobile").

function depth(records, id) {
  let d = 0;
  for (let p = records[id] && records[id].parent; p && records[p] && d < 64; p = records[p].parent) {
    d++;
  }
  return d;
}

// The first sync on a TizCat that already has bookmarks: its bookmarks that
// match ones on the server (same folder, title and address) take the
// server's ids instead of being added twice, as Chrome does on its first
// sync. Folders first, so their contents can match inside them. Returns
// {localId: remoteId}.
export function matchFirstSync(local, remote) {
  const rename = {};
  const key = (rec, parent) => [parent, rec.folder ? "F" : "U", rec.title, rec.url || ""].join("\u0000");
  const free = Object.keys(local).filter((id) => !(id in remote));
  const wanted = Object.keys(remote).filter((id) => !(id in local));
  const levels = [];
  for (const id of wanted) {
    (levels[depth(remote, id)] ||= []).push(id);
  }
  const used = new Set();
  for (const level of levels) {
    if (!level) continue;
    const index = new Map();
    for (const id of free) {
      if (used.has(id)) continue;
      const rec = local[id];
      const k = key(rec, rename[rec.parent] || rec.parent);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(id);
    }
    for (const id of level.sort((a, b) => remote[a].pos - remote[b].pos)) {
      const list = index.get(key(remote[id], remote[id].parent));
      if (list && list.length) {
        const mine = list.shift();
        used.add(mine);
        rename[mine] = id;
      }
    }
  }
  return rename;
}

// The records with ids renamed (keys and parents).
export function renameRecords(records, rename) {
  const out = {};
  for (const [id, rec] of Object.entries(records)) {
    out[rename[id] || id] = { ...rec, parent: rename[rec.parent] || rec.parent };
  }
  return out;
}

// Which records go where once merged: {parentId: [ids in order]}. A record
// whose folder is gone (or is not a folder) goes to "other"; so do the
// children of a root this TizCat does not have.
export function childrenOf(records, roots) {
  const out = {};
  for (const [id, rec] of Object.entries(records)) {
    let parent = rec.parent;
    const folder = records[parent];
    if (!(roots.includes(parent) || (folder && folder.folder))) {
      parent = "other";
    }
    (out[parent] ||= []).push(id);
  }
  for (const list of Object.values(out)) {
    list.sort((a, b) => (records[a].pos - records[b].pos) || (a < b ? -1 : a > b ? 1 : 0));
  }
  return out;
}

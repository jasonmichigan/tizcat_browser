// Bookmarks, as TizCat sync sees them. Chrome's bookmark ids are local to
// one profile, so each bookmark also gets a sync id, kept in
// chrome.storage.local ("sync.bookmarks.ids": {localId: syncId}). The three
// roots have fixed sync ids: "bar" (Bookmarks bar), "other" (Other
// bookmarks), "mobile". Managed bookmarks (set by policy) are left alone.
import { childrenOf, matchFirstSync, renameRecords, same } from "./merge.js";

const IDS = "sync.bookmarks.ids";
const ROOTS = { "bookmarks-bar": "bar", other: "other", mobile: "mobile" };

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}

// This TizCat's bookmarks: {records, local: {syncId: localId}, roots: {bar: localId, ...}}.
async function read() {
  const [tree] = await chrome.bookmarks.getTree();
  const known = (await chrome.storage.local.get(IDS))[IDS] || {};
  const ids = {};
  const records = {};
  const local = {};
  const roots = {};
  const walk = (folder, parent) => {
    (folder.children || []).forEach((node, pos) => {
      if (node.unmodifiable) return;
      const id = known[node.id] || newId();
      ids[node.id] = id;
      local[id] = node.id;
      records[id] = node.url !== undefined
        ? { parent, pos, title: node.title, url: node.url }
        : { parent, pos, title: node.title, folder: true };
      if (node.url === undefined) walk(node, id);
    });
  };
  for (const root of tree.children) {
    const id = ROOTS[root.folderType];
    if (!id || root.unmodifiable) continue;
    roots[id] = root.id;
    walk(root, id);
  }
  await chrome.storage.local.set({ [IDS]: ids });
  return { records, local, roots };
}

// First sync here: bookmarks already on the server are not added twice.
async function adopt(snap, remote) {
  const rename = matchFirstSync(snap.records, remote);
  if (!Object.keys(rename).length) return snap;
  const local = {};
  for (const [id, localId] of Object.entries(snap.local)) {
    local[rename[id] || id] = localId;
  }
  const ids = {};
  for (const [id, localId] of Object.entries(local)) {
    ids[localId] = id;
  }
  await chrome.storage.local.set({ [IDS]: ids });
  return { ...snap, records: renameRecords(snap.records, rename), local };
}

// Makes this TizCat's bookmarks match `merged`: adds and changes first,
// folder by folder from the roots (so a bookmark moved out of a folder that
// is going away is moved before the folder goes), then removes.
async function apply(merged, snap) {
  const rootIds = Object.keys(snap.roots);
  const lists = childrenOf(merged, rootIds);
  const localOrder = childrenOf(snap.records, rootIds);
  const ids = (await chrome.storage.local.get(IDS))[IDS] || {};
  const queue = [...rootIds];
  for (let q = 0; q < queue.length; q++) {
    const folder = queue[q];
    const parentLocal = snap.roots[folder] || snap.local[folder];
    if (!parentLocal) continue;
    const list = lists[folder] || [];
    const unchanged = same(list, localOrder[folder] || []);
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      const rec = merged[id];
      let localId = snap.local[id];
      try {
        if (!localId) {
          const made = await chrome.bookmarks.create(rec.folder
            ? { parentId: parentLocal, index: i, title: rec.title }
            : { parentId: parentLocal, index: i, title: rec.title, url: rec.url });
          localId = made.id;
          snap.local[id] = localId;
          ids[localId] = id;
        } else {
          const now = snap.records[id];
          if (now.title !== rec.title || (!rec.folder && now.url !== rec.url)) {
            await chrome.bookmarks.update(localId, rec.folder ? { title: rec.title } : { title: rec.title, url: rec.url });
          }
          if (!unchanged) {
            const [node] = await chrome.bookmarks.get(localId);
            if (node.parentId !== parentLocal || node.index !== i) {
              await chrome.bookmarks.move(localId, { parentId: parentLocal, index: i });
            }
          }
        }
      } catch (e) {
        // One bookmark that cannot be placed (an address Chrome refuses, a
        // folder gone meanwhile) does not stop the rest; the next sync
        // uploads what is really here.
        console.warn("TizCat sync: bookmark", e && e.message);
        continue;
      }
      if (rec.folder) queue.push(id);
    }
  }
  await chrome.storage.local.set({ [IDS]: ids });
  // Removals: only the top-most of what goes (a folder takes its contents).
  for (const [id, rec] of Object.entries(snap.records)) {
    if (merged[id]) continue;
    if (snap.records[rec.parent] && !merged[rec.parent]) continue;
    try {
      if (rec.folder) await chrome.bookmarks.removeTree(snap.local[id]);
      else await chrome.bookmarks.remove(snap.local[id]);
    } catch {
      // Already gone.
    }
  }
}

async function forget() {
  await chrome.storage.local.remove(IDS);
}

export default { name: "bookmarks", label: "Bookmarks", read, adopt, apply, forget };

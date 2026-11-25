// TizCat sync's merge rules (modules\services\lib\sync\merge.js), no browser:
//   node --test tests\sync-unit.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { childrenOf, matchFirstSync, mergeRecords, renameRecords, same, stable } from "../modules/services/lib/sync/merge.js";

const bm = (parent, pos, title, url) => (url ? { parent, pos, title, url } : { parent, pos, title, folder: true });

test("stable text ignores key order", () => {
  assert.equal(stable({ b: 1, a: [1, { d: 2, c: 3 }] }), stable({ a: [1, { c: 3, d: 2 }], b: 1 }));
  assert.ok(same(undefined, undefined));
  assert.ok(!same({ a: 1 }, undefined));
});

test("merge: a change on one side wins; the same on both is kept", () => {
  const base = { a: { v: 1 }, b: { v: 1 }, c: { v: 1 } };
  const local = { a: { v: 2 }, b: { v: 1 }, c: { v: 1 } };
  const remote = { a: { v: 1 }, b: { v: 3 }, c: { v: 1 } };
  assert.deepEqual(mergeRecords(base, local, remote), { a: { v: 2 }, b: { v: 3 }, c: { v: 1 } });
});

test("merge: additions on both sides are all kept", () => {
  assert.deepEqual(mergeRecords({}, { a: { v: 1 } }, { b: { v: 2 } }), { a: { v: 1 }, b: { v: 2 } });
});

test("merge: a delete on one side, untouched on the other, deletes", () => {
  const base = { a: { v: 1 }, b: { v: 1 } };
  assert.deepEqual(mergeRecords(base, { b: { v: 1 } }, base), { b: { v: 1 } });
  assert.deepEqual(mergeRecords(base, base, { a: { v: 1 } }), { a: { v: 1 } });
});

test("merge: an edit beats a delete, so nothing edited is lost", () => {
  const base = { a: { v: 1 } };
  assert.deepEqual(mergeRecords(base, {}, { a: { v: 2 } }), { a: { v: 2 } });
  assert.deepEqual(mergeRecords(base, { a: { v: 3 } }, {}), { a: { v: 3 } });
});

test("merge: changed on both sides, the server's copy wins", () => {
  assert.deepEqual(mergeRecords({ a: { v: 1 } }, { a: { v: 2 } }, { a: { v: 3 } }), { a: { v: 3 } });
});

test("merge: with no base (a fresh start), nothing counts as deleted", () => {
  // A TizCat whose server copy was deleted keeps everything it has.
  const local = { a: { v: 1 }, b: { v: 2 } };
  assert.deepEqual(mergeRecords({}, local, {}), local);
});

test("first sync: bookmarks already here take the server's ids, folders first", () => {
  const remote = {
    F1: bm("bar", 0, "News"),
    B1: bm("F1", 0, "Example", "https://example.com/"),
    B2: bm("bar", 1, "Mail", "https://mail.example/"),
  };
  const local = {
    x: bm("bar", 0, "News"),
    y: bm("x", 0, "Example", "https://example.com/"),
    z: bm("bar", 1, "Mine only", "https://mine.example/"),
  };
  const rename = matchFirstSync(local, remote);
  assert.deepEqual(rename, { x: "F1", y: "B1" });
  const renamed = renameRecords(local, rename);
  assert.deepEqual(Object.keys(renamed).sort(), ["B1", "F1", "z"]);
  assert.equal(renamed.B1.parent, "F1");
  const merged = mergeRecords({}, renamed, remote);
  assert.deepEqual(Object.keys(merged).sort(), ["B1", "B2", "F1", "z"], "no duplicates, nothing lost");
});

test("first sync: a bookmark with the same title in another folder is not a match", () => {
  const remote = { A: bm("bar", 0, "Docs", "https://docs.example/") };
  const local = { a: bm("other", 0, "Docs", "https://docs.example/") };
  assert.deepEqual(matchFirstSync(local, remote), {});
});

test("first sync: two equal bookmarks match two, not one twice", () => {
  const remote = { A: bm("bar", 0, "Same", "https://s.example/"), B: bm("bar", 1, "Same", "https://s.example/") };
  const local = { a: bm("bar", 0, "Same", "https://s.example/"), b: bm("bar", 1, "Same", "https://s.example/") };
  const rename = matchFirstSync(local, remote);
  assert.deepEqual(Object.values(rename).sort(), ["A", "B"]);
});

test("placing: children in order; orphans and a missing root go to Other bookmarks", () => {
  const records = {
    a: bm("bar", 1, "Second", "https://2.example/"),
    b: bm("bar", 0, "First", "https://1.example/"),
    c: bm("gone", 0, "Orphan", "https://o.example/"),
    d: bm("mobile", 0, "From a phone", "https://m.example/"),
    e: bm("a", 0, "Inside a bookmark?", "https://x.example/"),
  };
  const lists = childrenOf(records, ["bar", "other"]);
  assert.deepEqual(lists.bar, ["b", "a"]);
  assert.deepEqual(lists.other.sort(), ["c", "d", "e"]);
});

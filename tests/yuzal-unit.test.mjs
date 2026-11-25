// Yuzal's decisions that need no browser: which actions read-only and
// never-submit refuse, what counts as a sign-in wall, and which messages
// run instantly without a model.
//
//   node --test tizcat/tests/yuzal-unit.test.mjs
//
// The modules expect Chromium's `chrome` object; a stub is enough, because
// nothing here reaches a page. A refused action must not reach one either,
// and the stub's debugger throws if it is asked to, which is the proof.
import { test } from "node:test";
import assert from "node:assert/strict";

const touched = [];
globalThis.chrome = {
  debugger: {
    onDetach: { addListener() {} },
    attach() { touched.push("attach"); throw new Error("a refused action reached the page"); },
    sendCommand() { touched.push("send"); throw new Error("a refused action reached the page"); },
  },
  tabs: { update() { touched.push("tabs.update"); return Promise.resolve(); } },
};

const lib = new URL("../yuzal/lib/", import.meta.url);
const actuator = await import(new URL("actuator.js", lib));
const agent = await import(new URL("agent.js", lib));
const localcmd = await import(new URL("localcmd.js", lib));
const tabs = await import(new URL("tabs.js", lib));

test("read-only refuses everything that can change a page, and nothing else", async () => {
  for (const name of ["click_index", "fill", "type", "key", "submit", "upload_file", "login", "remember", "generate_file", "drag_xy"]) {
    const r = await actuator.executeOne({ name, args: { index: 1 } }, { tabId: 1, readOnly: true });
    assert.equal(r.ok, false, name);
    assert.match(r.line, /refused: read-only/, name);
  }
  assert.equal(actuator.classOf("scroll"), "read");
  assert.equal(actuator.classOf("navigate"), "navigate");
  // An action nobody classified is treated as one that changes things.
  assert.equal(actuator.classOf("something_new"), "mutate");
});

test("never-submit refuses the final button however it is pressed", async () => {
  const cases = [
    { name: "submit", args: {} },
    { name: "submit_index", args: { index: 3 } },
    { name: "click", args: { text: "Place order" } },
    { name: "click", args: { text: "Apply now" } },
    { name: "click_index", args: { index: 2, text: "Pay" } },
  ];
  for (const a of cases) {
    const r = await actuator.executeOne(a, { tabId: 1, noSubmit: true });
    assert.match(r.line, /refused: .fill but never submit/, JSON.stringify(a));
  }
  assert.equal(actuator.commits("click", { text: "Next page" }), false);
  assert.equal(actuator.commits("fill_index", { index: 1, value: "Pay" }), false);
});

test("a refused action never reaches the page", () => {
  assert.deepEqual(touched, []);
});

test("Yuzal will not try to sign in for you", async () => {
  const r = await actuator.executeOne({ name: "login", args: {} }, { tabId: 1, readOnly: false, noSubmit: false });
  assert.equal(r.ok, false);
  assert.match(r.line, /password manager/);
  assert.deepEqual(touched.filter((t) => t !== "tabs.update"), []);
});

test("sign-in walls are recognised, a 'Log in' link is not", () => {
  assert.equal(agent.isAuthPage({ url: "https://accounts.google.com/v3/signin/identifier" }), true);
  assert.equal(agent.isAuthPage({ url: "https://x.com/", text: "Enter the verification code we sent" }), true);
  assert.equal(agent.isAuthPage({ url: "https://bbc.com/", title: "BBC", text: "Home News Sport Log in" }), false);
  assert.equal(agent.isAuthPage({
    url: "https://shop.example/", text: "Sign in to continue",
    inputs: [{ type: "password" }],
  }), true);
});

test("instant commands need no model", () => {
  assert.deepEqual(localcmd.parse("scroll down").actions, [{ name: "scroll", args: { direction: "down" } }]);
  assert.equal(localcmd.parse("go to bbc").actions[0].args.url, "https://www.bbc.com");
  assert.equal(localcmd.parse("open tab youtube").actions[0].name, "new_tab");
  // A multi-step instruction is the model's, not a broken navigation.
  assert.equal(localcmd.parse("go to google.com, search for jib and list the results"), null);
});

test("an address from the model becomes one a tab can load", () => {
  assert.equal(tabs.normalizeUrl("example.com"), "https://example.com");
  assert.equal(tabs.normalizeUrl("https://a.b/c"), "https://a.b/c");
  assert.equal(tabs.normalizeUrl("chrome://settings"), "chrome://settings");
  assert.match(tabs.normalizeUrl("weather in boston"), /^https:\/\/www\.google\.com\/search\?q=weather%20in%20boston$/);
});

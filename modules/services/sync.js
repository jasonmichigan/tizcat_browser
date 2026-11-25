// The TizCat sync page (chrome-extension://.../sync.html): whether this
// TizCat is signed in and syncing, what it syncs, sync now, and sign out.
// Opened from the Rewards panel and from the account page.
const $ = (id) => document.getElementById(id);

function ask(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => resolve(chrome.runtime.lastError ? null : reply));
  });
}

function ago(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(time).toLocaleString();
}

function show(s) {
  if (!s || !s.ok) {
    $("off").hidden = false;
    $("off-text").textContent = "TizCat Services is not answering. Restart TizCat and try again.";
    return;
  }
  const sync = s.sync || {};
  const on = !!(s.linked && sync.on);
  $("off").hidden = on;
  for (const id of ["on", "kinds-card", "actions"]) {
    $(id).hidden = !on;
  }
  if (!on) {
    $("off-text").textContent = sync.signedOut
      ? "This TizCat was signed out of your account (by a password reset, or on the account page). " +
        "Your bookmarks and settings are still here. Sign in again to keep syncing."
      : "Sign in to your TizCat account to keep your bookmarks, settings and TizCat's own data " +
        "in your account and bring them to TizCat on another computer.";
    return;
  }
  $("email").textContent = s.email;
  const status = $("status");
  status.classList.toggle("error", !!sync.error);
  status.textContent = sync.error
    ? sync.error
    : sync.lastSyncAt ? `Last synced ${ago(sync.lastSyncAt)}.` : "Syncing for the first time...";
  const list = $("kinds");
  list.textContent = "";
  for (const kind of sync.kinds) {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const words = document.createElement("span");
    const name = document.createElement("span");
    name.className = "label";
    name.textContent = kind.label;
    const detail = document.createElement("span");
    detail.className = "sub";
    detail.textContent = kind.detail ? ` ${kind.detail}` : "";
    words.append(name, document.createElement("br"), detail);
    const box = document.createElement("input");
    box.type = "checkbox";
    box.setAttribute("role", "switch");
    box.checked = kind.on;
    box.dataset.kind = kind.name;
    box.addEventListener("change", async () => {
      show(await ask({ type: "tizcat.sync.choose", name: kind.name, on: box.checked }));
    });
    label.append(words, box);
    li.append(label);
    list.append(li);
  }
}

$("sync-now").addEventListener("click", async (e) => {
  e.target.disabled = true;
  $("status").textContent = "Syncing...";
  try {
    show(await ask({ type: "tizcat.sync.now" }));
  } finally {
    e.target.disabled = false;
  }
});

$("sign-out").addEventListener("click", async (e) => {
  if (!confirm("Sign this TizCat out of your account? Syncing stops here; your bookmarks and settings stay.")) {
    return;
  }
  e.target.disabled = true;
  show(await ask({ type: "tizcat.unlinkHere" }));
  e.target.disabled = false;
});

async function refresh() {
  show(await ask({ type: "tizcat.summary" }));
}

refresh();
// The first sync finishes after the page opens: show it when it does.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.syncStatus || changes.device) refresh();
});

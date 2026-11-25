// TizCat's New Tab page. Speed first (Tiz is Persian for fast): the page is
// local files only, the default picture is bundled, and everything else
// (shortcuts, Rewards, a sponsored picture already on the device) fills in
// after the first paint, without waiting for any server.
const $ = (id) => document.getElementById(id);
const MEDIA_CACHE = "tizcat-ads-v1";

function ask(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => {
      resolve(chrome.runtime.lastError ? null : reply);
    });
  });
}

function tickClock() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("clock").dateTime = now.toISOString();
  setTimeout(tickClock, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}

function search(event) {
  event.preventDefault();
  const text = $("search-box").value.trim();
  if (text) {
    // The person's own default search engine (Settings, Search engine).
    chrome.search.query({ text, disposition: "CURRENT_TAB" });
  }
}

async function shortcuts() {
  const sites = (await chrome.topSites.get()).slice(0, 8);
  const nav = $("shortcuts");
  for (const site of sites) {
    const a = document.createElement("a");
    a.href = site.url;
    a.title = site.title || site.url;
    const tile = document.createElement("span");
    tile.className = "tile";
    const icon = document.createElement("img");
    icon.alt = "";
    icon.src = `/_favicon/?pageUrl=${encodeURIComponent(site.url)}&size=32`;
    tile.append(icon);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = site.title || new URL(site.url).hostname;
    a.append(tile, name);
    nav.append(a);
  }
}

async function rewards() {
  const s = await ask({ type: "tizcat.summary" });
  if (!s || !s.ok) {
    return;
  }
  const box = $("rewards");
  box.hidden = false;
  if (!s.rewardsOn) {
    $("rewards-text").textContent = "Earn points for ads you choose to see.";
    $("rewards-on").hidden = false;
    $("rewards-account").hidden = true;
    return;
  }
  const points = `${s.points} point${s.points === 1 ? "" : "s"}`;
  $("rewards-text").textContent = s.linked
    ? `${points}, kept in your TizCat account until ${s.coin.name} is ready.`
    : `${points} on this computer.`;
  $("rewards-on").hidden = true;
  $("rewards-account").hidden = s.linked;
}

// A sponsored picture, when it is its turn and already on the device.
async function background() {
  const answer = await ask({ type: "tizcat.ntp.background" });
  const ad = answer && answer.ad;
  if (!ad) {
    return;
  }
  const cache = await caches.open(MEDIA_CACHE);
  const file = await cache.match(ad.image);
  if (!file) {
    return;
  }
  const url = URL.createObjectURL(await file.blob());
  const picture = new Image();
  picture.onload = () => {
    const bg = $("background");
    bg.style.backgroundImage = `url("${url}")`;
    bg.classList.add("sponsored");
    const credit = $("credit");
    credit.textContent = "";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "Sponsored";
    const link = document.createElement("a");
    link.href = ad.url;
    link.textContent = `${ad.title} (${ad.advertiser})`;
    credit.append(tag, link);
    // Counted once it is actually on screen.
    requestAnimationFrame(() => ask({ type: "tizcat.ntp.viewed", adId: ad.id }));
  };
  picture.src = url;
}

$("search").addEventListener("submit", search);
$("rewards-on").addEventListener("click", async () => {
  await ask({ type: "tizcat.setRewards", on: true });
  rewards();
});
tickClock();
shortcuts();
rewards();
background();

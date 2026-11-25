// The TizCat Rewards panel: on or off, how many notification ads an hour,
// the points, the account, and JibWallet's placeholder.
const $ = (id) => document.getElementById(id);

function ask(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => {
      resolve(chrome.runtime.lastError ? null : reply);
    });
  });
}

function show(s) {
  if (!s || !s.ok) {
    $("state-text").textContent = "TizCat Services is not answering.";
    return;
  }
  $("rewards-switch").checked = s.rewardsOn;
  $("state-text").textContent = s.rewardsOn
    ? "On: you see ads and earn points."
    : "Off: no ads, no points.";
  $("ads-row").hidden = !s.rewardsOn;
  $("points").textContent = String(s.points);
  $("points-text").textContent = s.linked
    ? `points in your account. They become ${s.coin.name} once it is ready.`
    : s.points
      ? "points on this computer. Log in to keep them in your account."
      : "points so far.";
  const select = $("ads-per-hour");
  if (!select.options.length) {
    for (const n of s.adsPerHourChoices) {
      const option = document.createElement("option");
      option.value = String(n);
      option.textContent = n === 0 ? "None" : String(n);
      select.append(option);
    }
  }
  select.value = String(s.adsPerHour);
  const syncing = s.linked && s.sync && s.sync.on;
  $("account-text").textContent = s.linked
    ? `Signed in: ${s.email}. ${syncing ? "Sync is on." : "Sync is off."}`
    : "Not signed in. Sign in to sync your bookmarks and settings.";
  $("account-link").textContent = s.linked ? "Manage your account" : "Log in or create an account";
  $("sync-link").hidden = !s.linked;
  $("wallet-name").textContent = s.wallet.name;
}

$("rewards-switch").addEventListener("change", async (e) => {
  show(await ask({ type: "tizcat.setRewards", on: e.target.checked }));
});
$("ads-per-hour").addEventListener("change", async (e) => {
  show(await ask({ type: "tizcat.setAdsPerHour", n: Number(e.target.value) }));
});

ask({ type: "tizcat.summary" }).then(show);

// JibWallet's toolbar panel. A placeholder: there is no wallet to unlock yet,
// so the only things that work are the settings button and "Learn more".

// The JibWallet page in TizCat's Settings (route /jibWallet, patch 0006).
document.getElementById("settings").addEventListener("click", async () => {
  await chrome.tabs.create({ url: "chrome://settings/jibWallet" });
  window.close();
});

// Ask for the microphone in a tab, the one place Chromium can show the
// question, then let the tab go.
const msg = document.getElementById("mic-msg");
document.getElementById("mic-allow").onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    msg.textContent = "Done. Go back to the panel and press Voice. This tab closes by itself.";
    setTimeout(() => chrome.tabs.getCurrent((t) => t && chrome.tabs.remove(t.id)), 2500);
  } catch (e) {
    msg.textContent = "The microphone was not allowed (" + (e && e.name) + "). To change that, "
      + "click the icon at the left of the address bar and allow the microphone.";
  }
};

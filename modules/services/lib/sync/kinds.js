// The kinds of data TizCat sync carries besides bookmarks. Each is
// {name, label, read() -> {records}, apply(merged, snap)}; records are
// {id: {v: value}} so the merge works per setting.
//
// To sync something new: add a kind here (or a holder, below), and list it
// in engine.js. The servers need no change: they store any kind by name.
import { load, save } from "../state.js";
import { same } from "./merge.js";

// Browser settings, through chrome.settingsPrivate (the same calls as the
// Settings page). The ones Chrome and Brave sync too: a person's choices,
// not this computer's (no download folder, proxy, hardware or fonts that
// may not be installed elsewhere).
export const SYNCED_PREFS = [
  // Appearance and toolbar
  "bookmark_bar.show_on_all_tabs", "bookmark_bar.show_tab_groups",
  "browser.show_home_button", "browser.show_forward_button", "homepage", "homepage_is_newtabpage",
  "toolbar.pinned_actions", "side_panel.is_right_aligned", "tab_search.pinned_to_tabstrip",
  "browser.hovercard.image_previews_enabled", "browser.hovercard.memory_usage_enabled",
  "ntp.shortcust_visible", "vertical_tabs.enabled", "auto_pin_new_tab_groups", "browser.ctrl_tab_mru",
  "webkit.webprefs.default_font_size", "webkit.webprefs.default_fixed_font_size",
  "webkit.webprefs.minimum_font_size",
  // On startup
  "session.restore_on_startup", "session.startup_urls",
  // Search and the address bar
  "default_search_provider_data.template_url_data", "search.suggest_enabled",
  "omnibox.keyword_space_triggering_enabled",
  // Privacy and security
  "enable_do_not_track", "safebrowsing.enabled", "safebrowsing.enhanced", "https_only_mode_enabled",
  "profile.cookie_controls_mode", "net.network_prediction_options", "alternate_error_pages.enabled",
  "credentials_enable_service", "credentials_enable_autosignin", "autofill.profile_enabled",
  "autofill.credit_card_enabled", "payments.can_make_payment_enabled",
  "privacy_sandbox.m1.topics_enabled", "privacy_sandbox.m1.fledge_enabled",
  "privacy_sandbox.m1.ad_measurement_enabled",
  // Downloads and PDFs
  "download.prompt_for_download", "plugins.always_open_pdf_externally",
  // Languages and spelling
  "intl.accept_languages", "intl.selected_languages", "translate.enabled", "translate_blocked_languages",
  "browser.enable_spellchecking", "spellcheck.dictionaries", "spellcheck.use_spelling_service",
  // Accessibility
  "settings.a11y.caretbrowsing.enabled", "settings.a11y.focus_highlight",
];
const PREF_SET = new Set(SYNCED_PREFS);

export const settings = {
  name: "settings",
  label: "Settings",
  detail: "Appearance, startup pages, search engine, privacy, languages and more",
  async read() {
    const records = {};
    for (const pref of await chrome.settingsPrivate.getAllPrefs()) {
      // A setting fixed by policy or another extension is not this
      // person's choice: neither sent nor changed.
      if (PREF_SET.has(pref.key) && pref.enforcement !== "ENFORCED") {
        records[pref.key] = { v: pref.value };
      }
    }
    return { records };
  },
  async apply(merged, snap) {
    for (const [key, rec] of Object.entries(merged)) {
      if (snap.records[key] && !same(snap.records[key], rec)) {
        try {
          await chrome.settingsPrivate.setPref(key, rec.v);
        } catch (e) {
          console.warn("TizCat sync: setting", key, e && e.message);
        }
      }
    }
  },
  watches(keys) {
    return keys.some((k) => PREF_SET.has(k));
  },
};

// TizCat Services' own choices.
const OWN = ["rewardsOn", "adsPerHour"];
export const tizcat = {
  name: "tizcat",
  label: "TizCat Rewards and New Tab choices",
  detail: "Whether Rewards is on, and how many notification ads an hour",
  async read() {
    const state = await load();
    const records = {};
    for (const key of OWN) {
      records[key] = { v: state[key] };
    }
    return { records };
  },
  async apply(merged) {
    const changes = {};
    for (const key of OWN) {
      if (merged[key]) changes[key] = merged[key].v;
    }
    await save(changes);
  },
};

// Holders: one JSON document each, kept for a part of TizCat that defines
// its contents later. JibWallet's starts empty; JibWallet (a module of its
// own, later) reads and writes it with the messages tizcat.holder.get /
// tizcat.holder.set. A new holder is one line in HOLDERS.
export const HOLDERS = {
  wallet: {
    label: "JibWallet",
    detail: "JibWallet's data, once JibWallet is ready (encrypted like everything else)",
    empty: { schema: 1, accounts: [], settings: {} },
  },
};

export function holderKey(name) {
  return `holder.${name}`;
}

export async function readHolder(name) {
  const key = holderKey(name);
  const doc = (await chrome.storage.local.get(key))[key];
  return doc === undefined ? structuredClone(HOLDERS[name].empty) : doc;
}

export async function writeHolder(name, doc) {
  await chrome.storage.local.set({ [holderKey(name)]: doc });
}

export function holder(name) {
  const spec = HOLDERS[name];
  return {
    name,
    label: spec.label,
    detail: spec.detail,
    async read() {
      return { records: { doc: { v: await readHolder(name) } } };
    },
    async apply(merged) {
      if (merged.doc) await writeHolder(name, merged.doc.v);
    },
  };
}

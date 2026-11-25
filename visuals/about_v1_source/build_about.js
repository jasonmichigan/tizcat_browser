// Builds visuals\about_v1.docx: TizCat's "about" document with the JibCoin
// whitepaper draft, the figures from make_figures.py, and the creative kit.
//   python visuals\about_v1_source\make_figures.py
//   set NODE_PATH=%LOCALAPPDATA%\TizCatTools\node_modules   (docx 9.15.1, kept outside the synced folder)
//   node visuals\about_v1_source\build_about.js
// Do not re-run it over a copy you have edited by hand: it writes a fresh file.
const fs = require("fs");
const path = require("path");
const {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, LevelFormat, Packer,
  PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} = require("docx");

const HERE = __dirname;
const VISUALS = path.dirname(HERE);
const FIG = path.join(VISUALS, "about_v1_figures");
const OUT = path.join(VISUALS, "about_v1.docx");

const NAVY = "1C2B4A";
const GOLD = "B9821C";
const GOLD_DARK = "8A5D0F";
const MUTED = "52514E";
const LINE = "D9D6CE";
const CONTENT_WIDTH = 9360; // 6.5 inches, US Letter with 1 inch margins

// ---------------------------------------------------------------------------
// Helpers

// "Plain **bold** plain" -> runs.
function runs(text, opts = {}) {
  const out = [];
  const parts = String(text).split(/(\*\*[^*]+\*\*)/);
  for (const part of parts) {
    if (!part) continue;
    const bold = part.startsWith("**") && part.endsWith("**");
    out.push(new TextRun({ text: bold ? part.slice(2, -2) : part, bold: bold || opts.bold, italics: opts.italics,
      color: opts.color, size: opts.size, font: opts.font }));
  }
  return out;
}

const P = (text, opts = {}) => new Paragraph({
  children: runs(text, opts), spacing: { after: opts.after ?? 140, line: 288 }, alignment: opts.align,
  keepNext: opts.keepNext,
});
const H1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)], pageBreakBefore: true });
const H1flow = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
const H3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)] });
const bullets = (items, ref = "bullets") => items.map((t) => new Paragraph({
  numbering: { reference: ref, level: 0 }, children: runs(t), spacing: { after: 80, line: 276 },
}));
const numbered = (items, ref) => items.map((t) => new Paragraph({
  numbering: { reference: ref, level: 0 }, children: runs(t), spacing: { after: 120, line: 276 },
}));

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// A figure at the content width (or narrower), with its caption.
function figure(name, caption, widthInches = 6.5) {
  const file = path.join(FIG, name);
  const { w, h } = pngSize(file);
  const width = Math.round(widthInches * 96);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true,
      children: [new ImageRun({ type: "png", data: fs.readFileSync(file), transformation: { width, height: Math.round(width * h / w) },
        altText: { title: caption, description: caption, name } })],
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
      children: runs(caption, { italics: true, color: MUTED, size: 18 }) }),
  ];
}

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };

// A table with a header row; widths in DXA, summing to the table width.
function table(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (text, i, header) => new TableCell({
    borders, width: { size: widths[i], type: WidthType.DXA },
    shading: header ? { fill: "E9EDF5", type: ShadingType.CLEAR, color: "auto" } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: String(text).split("\n").map((line) => new Paragraph({
      children: runs(line, { bold: header, size: 19, color: header ? NAVY : undefined }), spacing: { after: 30 },
    })),
  });
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
    ],
  });
}

// A shaded box: a title line and paragraphs.
function callout(title, lines, fill = "FBF4E4", edge = "E6C77F") {
  const b = { style: BorderStyle.SINGLE, size: 6, color: edge };
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: [CONTENT_WIDTH],
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({
      borders: { top: b, bottom: b, left: b, right: b }, width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR, color: "auto" },
      margins: { top: 140, bottom: 120, left: 200, right: 200 },
      children: [
        new Paragraph({ children: runs(title, { bold: true, color: GOLD_DARK }), spacing: { after: 80 } }),
        ...lines.map((l) => new Paragraph({ children: runs(l, { size: 20 }), spacing: { after: 70, line: 276 } })),
      ],
    })] })],
  });
}
const gap = () => new Paragraph({ children: [], spacing: { after: 120 } });

// ---------------------------------------------------------------------------
// Content

const content = [];
const add = (...items) => content.push(...items.flat());

// Title page
add(
  new Paragraph({ spacing: { before: 900, after: 240 }, alignment: AlignmentType.CENTER, children: [new ImageRun({
    type: "png", data: fs.readFileSync(path.join(FIG, "logo_tizcat.png")), transformation: { width: 190, height: 190 },
    altText: { title: "TizCat logo", description: "A gold, folded-paper cheetah head with navy tear lines", name: "logo" } })] }),
  new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun("TizCat")] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: runs(
    "The fast browser with an AI agent that keeps your secrets at home", { size: 30, color: NAVY }) }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: runs(
    "About TizCat, version 1, with the JibCoin whitepaper (draft)", { size: 22, color: MUTED }) }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1200 }, children: runs("November 2026", { size: 22, color: MUTED }) }),
  callout("Read this first", [
    "This document describes TizCat as it is on 18 November 2026 and the plans for it. Where something is built and tested, it says so; where something is a plan or a proposal, it says that too.",
    "**JibCoin does not exist yet.** Everything about it here is a draft design for discussion. Nothing in this document is an offer to sell anything, an invitation to invest, or a promise of income, price or listing. It is not legal, tax or investment advice.",
  ]),
);

// Contents
add(
  H1("Contents"),
  ...[
    "1. TizCat in one page",
    "2. The name and the story",
    "3. What TizCat is",
    "4. Fast by design",
    "5. Yuzal: an AI agent you can trust with your secrets",
    "6. Free AI, and why it stays free",
    "7. TizCat Rewards: earning from your attention",
    "8. JibWallet",
    "9. JibCoin whitepaper (draft 0.1)",
    "10. Built to change quickly: the modular platform",
    "11. Privacy and security at a glance",
    "12. TizCat beside Chrome and Brave",
    "13. Roadmap",
    "14. Creative kit: video and image prompts, and long-video platforms",
    "Appendix A. Glossary",
    "Appendix B. Sources",
  ].map((t) => P(t, { after: 90 })),
);

// 1. One page
add(
  H1("1. TizCat in one page"),
  P("TizCat is a web browser built from Chromium, the open source project behind Chrome, Edge and Brave. It is a complete browser, not a web page dressed up as one: Google sign-in works, Chrome Web Store extensions work, and everything Chromium does, TizCat does."),
  P("What makes it different is what sits on top. **Yuzal**, TizCat's AI agent, lives in the side panel and can read and work with the page you are on. It was designed so that your passwords never reach the AI or any server, and so that, with the local engine, nothing about the page you are on leaves your laptop at all. That is what makes an AI agent usable for the tasks people care most about protecting: their bank, their health records, their insurance."),
  P("Around it: a browser built for **speed** (the name means fast), AI that is **free** because it runs on your own computer or with your own key, **TizCat Rewards**, which pays people for the ads they choose to see the way Brave does, and two things still to come: **JibWallet**, TizCat's own wallet, and **JibCoin**, the coin Rewards points are planned to become."),
  H2("What makes TizCat different"),
  ...bullets([
    "**Fast.** Built with the same profile-guided optimization Google uses for Chrome, with a New Tab page that never waits for the network.",
    "**An AI agent that keeps secrets at home.** Yuzal never sees saved passwords; you pick the saved account and the browser fills it. With the local engine, the page and your words stay on your laptop.",
    "**Free AI.** A local model costs nothing; your own key (many have free tiers) costs TizCat nothing. TizCat never has to sell your data to pay for AI.",
    "**Rewards for attention.** Off until you turn it on. People keep 70 percent of what advertisers pay. Ads are chosen inside the browser, so browsing history never leaves it.",
    "**JibWallet and JibCoin, later and carefully.** A self-custody wallet built into the browser, and a coin with a real use inside TizCat, issued only when the conditions in section 9 are met.",
    "**Modular.** The browser holds only small permanent hooks; every part that changes updates on its own, in seconds or with a restart.",
  ]),
  gap(),
  table(["", "TizCat today"], [
    ["Built on", "Chromium 157, as a complete browser (not Electron)"],
    ["Runs on", "Windows; other systems later"],
    ["AI agent", "Yuzal, in the side panel: local engine (Ollama) or your own key"],
    ["Price", "Free"],
    ["Account", "account.tizcat.com, email and password; optional"],
    ["Rewards", "TizCat Rewards: New Tab pictures and notification ads, opt in, points"],
    ["Wallet", "JibWallet: designed, not built (placeholder in Settings)"],
    ["Coin", "JibCoin: proposed on Solana, not issued"],
    ["Servers", "Cloudflare's free plan: www, account and api.tizcat.com, live"],
  ], [2400, 6960]),
);

// 2. Name
add(
  H1("2. The name and the story"),
  P("The name TizCat comes from the Persian word tiz, meaning sharp and quick, and from the cheetah, the fastest animal on land. Like its namesake, TizCat is quick, alert, and ready to move. Whether you're researching, working, or just exploring, TizCat helps you move through the web with speed and focus."),
  P("Two cheetahs carry the brand. The browser's mark is a gold cheetah head folded like paper, with navy tear lines: sharp edges, warm color, nothing soft about it. Yuzal's mark is a cheetah split down the middle, half spotted fur and half a teal network of connected points: the same animal, thinking."),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [
    new ImageRun({ type: "png", data: fs.readFileSync(path.join(FIG, "logo_tizcat_small.png")), transformation: { width: 150, height: 150 },
      altText: { title: "TizCat", description: "The TizCat browser logo", name: "tizcat" } }),
    new TextRun({ text: "          " }),
    new ImageRun({ type: "png", data: fs.readFileSync(path.join(FIG, "logo_yuzal.png")), transformation: { width: 150, height: 150 },
      altText: { title: "Yuzal", description: "Yuzal's logo, half cheetah, half network", name: "yuzal" } }),
  ] }),
  P("The browser (left) and Yuzal, its AI agent (right).", { italics: true, color: MUTED, size: 18, align: AlignmentType.CENTER, after: 240 }),
  P("TizCat began as Jeep, a browser built on Electron. In October 2026 Google's sign-in refused Jeep, as it refuses every browser built on an embedded framework like Electron, with the message that the browser \"may not be secure\". Browsers built from the Chromium source as complete browsers (Brave, Vivaldi, Opera, Edge) are not affected. Rather than disguise Jeep to get past a security check, the decision was to rebuild it properly on Chromium. The work started on 29 October 2026, the browser was named TizCat on 16 November, and its accounts, Rewards and website went live on 18 November."),
);

// 3. What TizCat is
add(
  H1("3. What TizCat is"),
  H2("3.1 A complete browser, built from Chromium"),
  P("TizCat is compiled from Chromium's own source code, version 157, with a small set of TizCat changes kept as separate patches. That brings, for free, everything a modern browser needs: extensions and the Chrome Web Store, the password manager, video in full screen, tab dragging between windows, printing, PDF reading, and, with every TizCat update, the Chromium project's security fixes."),
  H2("3.2 It brings your data with you"),
  P("Switching browsers fails when your bookmarks and passwords stay behind. Chromium on its own imports only from Firefox, Internet Explorer and a bookmarks file. TizCat adds every Chromium-based browser installed on your computer, one entry per profile, named the way Brave names them (\"Google Chrome Work\", \"Microsoft Edge Profile 1\"): Google Chrome (and its Beta, Dev and Canary), Microsoft Edge, Brave, Opera and Opera GX, Vivaldi, Perplexity Comet, Yandex and Chromium. It brings bookmarks, history, saved passwords, the search engines you added, and form entries."),
  callout("One honest limit", [
    "Google Chrome and Edge now lock saved passwords to themselves with \"app-bound\" encryption that no other program can read. TizCat cannot import those. Export them from that browser's password manager as a file and import the file into TizCat's password manager instead. Passwords from Brave, Opera and the others import directly.",
  ]),
  gap(),
  H2("3.3 A Profile page in Settings, as Brave has"),
  P("Settings opens on **Profile**, TizCat's version of Brave's \"Get started\": your TizCat account (log in or create one), your profile's name and icon, import from other browsers, the default browser, and what opens on startup, all in one card. Chrome's Google sync rows are gone from it: sync needs Google's keys, which only Chrome has. The menu also has a **JibWallet** page, where Brave has \"Web3\"."),
  H2("3.4 A New Tab page of its own"),
  P("Every new tab opens TizCat's own page: a full-screen picture, the time, a search box that uses whichever search engine you chose, shortcuts to the sites you visit most, and a small TizCat Rewards card. With Rewards turned on, some new tabs show a sponsored picture instead of TizCat's own; that is one of the two ways TizCat shows ads, and the only place it ever shows them besides its own notifications."),
  ...figure("fig1_architecture.png", "Figure 1. The browser, its modules on your laptop, and TizCat's servers on Cloudflare."),
);

// 4. Fast
add(
  H1("4. Fast by design"),
  P("Tiz means fast, so speed is a promise the name makes. TizCat gets it from four places, starting at the compiler."),
  H2("4.1 Compiled the way Chrome is"),
  P("Google builds Chrome with **profile-guided optimization** (PGO): Chrome is first run on real browsing workloads, a profile records which code runs most, and the final build is laid out and inlined according to that profile, so the hot paths are fast and compact. Google publishes the profile for each Chromium version. TizCat's build for Chromium 157 uses Google's own profile for exactly that version."),
  P("Chrome's other big build-time optimization, ThinLTO (link-time optimization across the whole program), is not used yet. It needs far more memory to link than a laptop has free; it will come when TizCat is built on a larger machine."),
  H2("4.2 A New Tab page that never waits"),
  P("The New Tab page is made only of files already on your computer. The ad list and the pictures arrive in the background and are kept on the device, so opening a tab never waits for a server, even when TizCat's servers are far away or the network is slow."),
  H2("4.3 Instant commands"),
  P("Many requests to an assistant do not need an AI model at all. \"Go to bbc\", \"scroll down\", \"go back\": Yuzal carries these out at once, locally, before any model is asked."),
  H2("4.4 Light modules"),
  P("TizCat's own parts (Yuzal, TizCat Services) are small extensions loaded beside the browser. Every call they make to a server has a short time limit, and the browser never waits on them."),
  ...figure("fig3_speed.png", "Figure 2. Where TizCat's speed comes from."),
  callout("Numbers, honestly", [
    "TizCat has not been benchmarked yet on the optimized build. Speedometer 3, JetStream 2, MotionMark, startup time and memory will be measured against Chrome and Brave on the same laptop and published, including any test TizCat loses.",
  ], "EEF3FB", "B7C8E6"),
);

// 5. Yuzal
add(
  H1("5. Yuzal: an AI agent you can trust with your secrets"),
  P("Yuzal is TizCat's assistant. Open her with the Ai button in the toolbar or Alt+L, and she appears in the side panel, beside the page you are on."),
  H2("5.1 What Yuzal does"),
  ...bullets([
    "**Reads the page** you are on: its text, its structure, and a screenshot when a picture says more than words.",
    "**Works with the page**: clicks, types, scrolls, opens links, fills forms, attaches files, moves between tabs, always in a tab of her own so the one you are reading is never disturbed.",
    "**Answers questions** about what is on screen, with voice in and voice out if you like.",
    "**Runs task lists and schedules**: a list of pages to read, a report to compile, a check to repeat every morning.",
    "**Ask Yuzal about this**: right-click a page, a link, a picture or some selected text, and the question is placed in her prompt box for you to send.",
  ]),
  H2("5.2 Your credentials stay on your laptop"),
  P("This is the part of Yuzal's design that matters most, so it is worth being exact about it."),
  ...bullets([
    "**Saved passwords never reach the AI.** They are kept in TizCat's password manager, encrypted for your Windows account. No extension can read it, and Yuzal is an extension. When a site asks you to sign in, Yuzal does not type a password: she asks you to pick your saved account, and the browser fills it in.",
    "**Passwords never reach TizCat's servers.** TizCat's account server never receives the passwords you keep for other sites, and even your TizCat account password never leaves the page you type it on: the page scrambles it slowly (600,000 rounds of PBKDF2) and sends only the result, which the server checks against a stored, secret-keyed value.",
    "**AI keys are never sent to TizCat's servers.** They stay in your settings on your computer and go only to the AI company you picked, to pay for your own use. (A fully encrypted local vault for them, as the earlier Jeep browser had, is planned for TizCat's public release.)",
    "**Your linked browser's token** is kept by TizCat Services on your computer and can be revoked from the account page at any time.",
  ]),
  ...figure("fig2_privacy.png", "Figure 3. What stays on your laptop, and what leaves only if you choose."),
  H2("5.3 You choose where the thinking happens"),
  P("Yuzal's brain is an engine you pick in her settings, and the choice decides what leaves your computer."),
  table(["Engine", "What leaves your laptop", "Cost", "Best for"], [
    ["**Local** (Ollama, for example qwen3:8b), listed as \"On this PC\"", "Nothing. The page, the screenshot and your words stay on the laptop.", "Free", "Banking, health, anything private"],
    ["**Your own key** with a cloud AI company", "For each turn: the page text and a screenshot, sent to that company under your agreement with it. Never your passwords.", "Free to TizCat; free tiers exist", "Hard questions, long documents"],
    ["**TizCat Cloud** (planned, optional)", "The same as your own key, to TizCat's AI partners", "A paid plan, later", "People who want no setup"],
  ], [2500, 3300, 1500, 2060]),
  gap(),
  H2("5.4 Banking, healthcare and other critical tasks"),
  P("An AI agent that can click and type is only useful for important tasks if it cannot do the wrong thing on its own. Yuzal has two safety gates built in and tested:"),
  ...bullets([
    "**Read-only.** Yuzal can look, read, summarize and explain, but cannot click, type or change anything. Turn it on whenever you want her eyes, not her hands.",
    "**Never submit.** Yuzal can fill a form for you to check, but never presses the button that sends it: no payment, no transfer, no message, no agreement goes out unless you press it yourself.",
  ]),
  P("Together with the local engine and the password rule above, that gives a way of working that suits critical tasks:"),
  table(["Task", "How Yuzal helps", "Safe way to do it"], [
    ["Reading a bank statement", "Summarizes spending, flags unusual charges, finds a payment", "Local engine, read-only"],
    ["Paying a bill", "Opens the right page, fills the amount and reference for you to check", "Local engine, never-submit; you press Pay"],
    ["A patient portal", "Explains a lab result in plain words, finds an appointment slot, drafts a message to your doctor", "Local engine; you send the message"],
    ["Insurance and benefits", "Compares plans side by side, pulls out deductibles and exclusions", "Local engine, read-only"],
    ["Tax and government forms", "Finds the right form and explains each field", "Local engine; you submit"],
  ], [2300, 4160, 2900]),
  gap(),
  callout("What Yuzal is not", [
    "Yuzal is an assistant, not an adviser. AI can misread a page or be wrong, so check what she tells you before acting on it, especially with money or health. She is not a financial, medical or legal professional, and TizCat makes no claim of certification under health or banking regulations. The safeguards above keep you in control; they do not replace your judgment.",
  ], "FDF1EC", "F2B49A"),
);

// 6. Free AI
add(
  H1("6. Free AI, and why it stays free"),
  P("Most AI products that are free today are free because someone else is paying, and that someone eventually wants something back. TizCat's AI is free for a structural reason: it runs on your side."),
  ...bullets([
    "**A local model runs on your laptop.** Ollama and similar tools run open models (Qwen, Llama, Gemma and others) on your own processor and graphics card. There is no bill, no account, no limit except your hardware.",
    "**Your own key costs TizCat nothing.** If you already have an AI subscription or key, Yuzal uses it directly. Several AI companies offer free tiers for personal use.",
    "**A small free trial, then your own key**, is how TizCat can welcome new people who have neither, for a few cents each.",
  ]),
  P("The alternative does not add up. Twenty cloud AI requests a day at frontier-model prices cost around 14 dollars per person per month. Advertising brings in about 75 cents per person per month. No browser can give everyone cloud AI for free out of advertising; any that claims to is either losing money or making it some other way."),
  ...figure("fig6_ai_cost.png", "Figure 4. The monthly cost to TizCat of each way of providing AI, against what ads bring in."),
  P("So the plan is: local and own-key AI stay free, always; a paid TizCat Cloud plan comes later for people who want strong cloud models with no setup; and TizCat Rewards can lower its price, but never pretends to pay for it."),
);

// 7. Rewards
add(
  H1("7. TizCat Rewards: earning from your attention"),
  P("Advertisers pay to reach people. In most of the web, that money goes to the sites and the ad networks, and the people being reached are tracked to make the ads worth more. TizCat Rewards follows the model Brave pioneered: the people who choose to see ads keep most of what advertisers pay for their attention, and their browsing never leaves their browser."),
  H2("7.1 How it works"),
  ...bullets([
    "**Off until you turn it on.** Nothing is shown and nothing is counted before you switch Rewards on in its toolbar panel.",
    "**Two kinds of ads, both TizCat's own surfaces.** A sponsored picture on some New Tab pages (one in four by default), and a few small notifications an hour, as many as you choose, from none to ten. Notifications appear only while you are at the computer.",
    "**Never inside other sites.** TizCat never inserts or replaces ads on the web pages you visit.",
    "**Chosen on your device.** TizCat Services downloads the list of running ads and picks one inside the browser. Your history is never sent anywhere for ads.",
    "**Counted once.** Each view has its own random id, so the server counts it once, however many times it is sent.",
  ]),
  ...figure("fig4_rewards_flow.png", "Figure 5. How value flows from advertisers to people."),
  H2("7.2 What you can expect to earn"),
  P("Honesty matters most here, because reward schemes fail by promising too much. A person's share is 70 percent of what advertisers actually paid for that person's views. At a realistic five ads a day and five dollars per thousand views, that is **about 53 cents a month**. Brave users report figures in the same range. The table below shows the whole range; the only way to reach a few dollars a month is to see twenty ads a day, which is too many for anyone."),
  ...figure("fig5_earnings.png", "Figure 6. Monthly earnings for one person, by ads a day and what advertisers pay."),
  P("Rewards is a thank-you for attention, not an income to live on. Its real value is that the browser does not need to sell anyone's data to pay its way."),
  H2("7.3 Fair, and protected"),
  ...bullets([
    "**Paid only from real money.** Payouts are designed so that the sum of everyone's balances and everything ever paid out can never exceed 70 percent of what advertisers actually paid; if a bug ever broke that rule, payouts would stop.",
    "**Limits.** A daily cap on counted events per device (in place today), and a minimum payout once payouts start, so mistakes and abuse cannot drain the pool.",
    "**Fraud controls, before any payout.** They decide whether a reward scheme survives: identity checks only when someone withdraws, never when they earn; a payout delay with a window to reverse fraud; detection of data-center addresses and mass-produced profiles.",
    "**Delete everything.** Deleting your TizCat account deletes its devices, its sessions and its points.",
  ]),
  H2("7.4 From points to payouts"),
  P("Today, Rewards counts points in your TizCat account; that ledger is built and tested. Payouts come in stages: first a small pilot group paid in gift cards or a dollar stablecoin, with identity checks at withdrawal; later, if and when JibCoin exists, points convert to JibCoin under the rules in section 9."),
);

// 8. JibWallet
add(
  H1("8. JibWallet"),
  P("JibWallet is TizCat's own wallet, planned as part of the browser: the place where JibCoin and other Solana assets are kept, received and spent. Today it is a placeholder: a JibWallet page in Settings and a server part that answers \"not yet\". This section is its design."),
  H2("8.1 Design principles"),
  ...bullets([
    "**Self-custody.** Your keys are made and kept on your device, encrypted, and never sent to TizCat. TizCat cannot move, freeze or recover your funds, and never holds anyone's balance.",
    "**A recovery phrase you control**, shown once, with clear guidance; support for hardware wallets later.",
    "**Readable confirmations.** Every transaction is shown in plain words before you approve it: who receives what, and what it costs.",
    "**Phishing protection.** Warnings for addresses and sites known to steal, and no silent approvals.",
    "**A separate module.** JibWallet loads like TizCat's other modules, so it can be updated quickly and on its own.",
    "**Useful inside TizCat.** Spend JibCoin on AI credits or a premium plan without ever converting it to cash.",
  ]),
  H2("8.2 Planned features"),
  table(["Feature", "What it does", "Stage"], [
    ["Create or import a wallet", "New keys on the device, or an existing Solana wallet", "First release"],
    ["Receive and send", "JibCoin and SOL, with readable confirmations", "First release"],
    ["Rewards payouts", "Points paid out to your own wallet", "With payouts"],
    ["Spend in TizCat", "AI credits and premium plans", "With JibCoin"],
    ["Connect to sites", "Approve requests from decentralized apps, one by one", "Later"],
    ["Hardware wallets", "Keys that never touch the computer", "Later"],
  ], [2500, 4600, 2260]),
);

// 9. Whitepaper
add(
  H1("9. JibCoin whitepaper (draft 0.1)"),
  callout("Status of this section", [
    "JibCoin is not issued and may never be. This is a draft for discussion, to be reviewed by legal counsel before any decision. It describes a design, not a product, and makes no promise about value, price, listing or returns.",
  ]),
  gap(),
  H2("9.1 Abstract"),
  P("JibCoin is a proposed digital token on the Solana network that would reward people for the attention they choose to give to advertising in the TizCat browser, and that they could spend inside TizCat on AI and other services. Its design is closed-loop first: earned by attention, spent on things TizCat otherwise charges for, with no reliance on outside markets for its usefulness."),
  H2("9.2 The problem"),
  P("Online advertising pays the sites and the networks, tracks the people it reaches, and gives those people nothing. At the same time, AI assistance costs real money every time it is used. People want both privacy and AI, and today they usually pay for one with the other."),
  H2("9.3 Principles"),
  ...bullets([
    "**Utility first.** JibCoin exists only if it does something a dollar cannot do as well inside TizCat. If an advertiser can pay in dollars and get the same campaign, and a person can spend dollars on the same AI, the token has no reason to exist.",
    "**A closed loop.** The strongest design: advertisers pay for attention, attention earns JibCoin, JibCoin pays for AI. No money has to be sent to the public at all, which is simpler for everyone.",
    "**Fixed supply.** A token minted for every ad view loses value every month. A fixed supply with a large share reserved for people who earn it is the shape that has worked.",
    "**Honest communication.** JibCoin is never described as an investment, never given a price prediction, and never promised a listing.",
  ]),
  H2("9.4 Token design (proposed)"),
  table(["Element", "Proposal"], [
    ["Network", "Solana, as a standard SPL token. Transfers cost a fraction of a cent, and many payments can be batched in one transaction."],
    ["Contract", "The standard, unmodified token program: no custom code, which is the most common source of costly bugs."],
    ["Supply", "Fixed. The number is to be decided."],
    ["Freeze authority", "Disabled, so no one, including TizCat, can freeze holders' tokens."],
    ["Mint authority", "Burned after the supply is minted (strongest), or held by a multi-signature group (more flexible). To be decided deliberately and published."],
    ["Audit", "An independent audit before deployment, even for a standard token."],
    ["Symbol", "To be chosen."],
  ], [2300, 7060]),
  gap(),
  ...figure("fig7_allocation.png", "Figure 7. A proposed allocation of JibCoin's fixed supply (draft)."),
  H2("9.5 Earning JibCoin"),
  P("Rewards points become JibCoin from the user rewards pool, on a published schedule. A person's share follows the identity at the heart of Rewards: 70 percent of what advertisers actually paid for that person's confirmed views, nothing more. The reconciliation rule holds at every step: everything paid out never exceeds 70 percent of the cash actually received from advertisers."),
  H2("9.6 Spending JibCoin"),
  P("Three uses are proposed, and at least one must exist before issuance:"),
  ...bullets([
    "**AI credits and premium plans in TizCat**, the closed loop. This is the most important one: the AI costs real money, and a person who spends JibCoin on it never needs to turn it into cash.",
    "**A discount for advertisers who pay in JibCoin**, so campaign budgets create demand, as Brave does with its token.",
    "**A share of other revenue used to buy JibCoin back into the rewards pool**, if TizCat's other products earn enough to fund it.",
  ]),
  H2("9.7 Payouts"),
  P("Payouts are batched on Solana, where sending to a hundred thousand people costs on the order of tens of dollars. A minimum payout threshold, identity checks at the moment of withdrawal (never at earning), sanctions screening, and a settlement period of up to sixty days (because advertisers themselves pay with a delay) are stated from the start."),
  H2("9.8 Governance and transparency"),
  ...bullets([
    "Treasury and pool addresses are public, held by multi-signature groups.",
    "A regular public report: supply, pool balance, amounts paid out, and the reconciliation against advertising income.",
    "Changes to the rules are announced in advance, never applied to rewards already earned.",
  ]),
  H2("9.9 Legal and regulatory questions"),
  P("This is the part most likely to decide whether JibCoin happens, so it is set out as questions for a lawyer, not as answers."),
  ...bullets([
    "**Is it a security?** Under the United States Howey test, a token is an investment contract if people buy in expecting profit from the efforts of others. Giving a token away does not by itself exempt it. A token described purely as a reward spendable on services inside TizCat is a much weaker case than one marketed as an investment. Regulators' positions changed during 2026 and are still being argued; they should be treated as unsettled.",
    "**Money transmission.** Collecting wallet addresses and distributing tokens can make a platform a money services business in the United States, with registration, anti-money-laundering duties and record-keeping. State licenses are a separate question.",
    "**The European Union.** A public offering of a token falls under MiCA, which requires a compliant whitepaper for most tokens. This draft is not that document.",
    "**Tax and sanctions.** Tokens received are generally income to the recipient; wallet screening and country restrictions are required.",
  ]),
  P("The plan budgets for a securities and money-transmission opinion before anything is deployed: the single most valuable expense in the whole project."),
  H2("9.10 Conditions before issuance"),
  ...numbered([
    "TizCat has real users and real advertising revenue.",
    "The points ledger has run, reconciled, for months.",
    "At least one use from 9.6 exists and works.",
    "A written legal opinion supports the design and the jurisdictions.",
    "The token has been audited, and the mint and freeze decisions are published.",
  ], "conditions"),
  H2("9.11 Risks"),
  table(["Risk", "What reduces it"], [
    ["Too few people use TizCat, so there is no advertising to share", "Make the browser worth keeping first; Yuzal is a better reason to switch than any token"],
    ["Fraud farms earn more than real people", "Identity at withdrawal, payout delay, device and network checks, per-campaign rates"],
    ["A regulator treats JibCoin as a security, or TizCat as a money transmitter", "No issuance before revenue and a legal opinion; the closed loop; no investment language"],
    ["The token loses value and people feel paid in nothing", "Fixed supply, a real use inside TizCat, and the choice of gift cards or a stablecoin instead"],
    ["People lose their wallet keys", "Clear recovery guidance, hardware wallet support, honest support"],
  ], [4200, 5160]),
);

// 10. Modular platform
add(
  H1("10. Built to change quickly: the modular platform"),
  P("A browser built from Chromium takes hours to rebuild. So TizCat's rule is simple: the browser itself carries only small, permanent hooks, and everything likely to change lives either in a module (copied in at every start) or on a server (deployed in seconds, one part at a time)."),
  table(["Part", "Where it runs", "To update it"], [
    ["Website", "www.tizcat.com", "seconds, on its own"],
    ["Accounts", "account.tizcat.com", "seconds, on its own"],
    ["Front door", "api.tizcat.com", "seconds, on its own"],
    ["Ads, Rewards points, JibWallet (placeholder)", "behind api.tizcat.com, unreachable from the internet", "seconds, each on its own"],
    ["Live settings", "a settings store on Cloudflare", "seconds, with nothing redeployed"],
    ["TizCat Services, Yuzal", "inside TizCat, as built-in modules", "a restart of TizCat"],
    ["Browser hooks", "TizCat itself", "a rebuild, rarely"],
  ], [3200, 3700, 2460]),
  gap(),
  P("The parts agree through a written, versioned contract: every request each server accepts is defined once, the servers check against it, and so do the tests. A change that keeps the contract is safe for every part; a change that breaks it becomes a new version, with the old one kept until nothing uses it."),
  P("All of this runs on Cloudflare's free plan: six small servers, three databases and one settings store, with no monthly bill. The free plan has daily limits, and Figure 8 estimates where TizCat would reach them: at about two thousand daily active Rewards users. Past that point Cloudflare's paid plan takes over: five dollars a month, with no daily caps and usage beyond generous included amounts billed by the million."),
  ...figure("fig8_free_plan.png", "Figure 8. Where Cloudflare's free plan ends, by daily active Rewards users (estimate)."),
  H2("10.1 A website that raises no warnings"),
  ...bullets([
    "HTTPS everywhere, with certificates issued and renewed automatically; plain http is redirected.",
    "Browsers are told to use HTTPS for a year (HSTS) on tizcat.com and every subdomain.",
    "A strict content security policy on every page: its own scripts only, no framing by other sites, no camera, microphone or location.",
    "TizCat's links that lead elsewhere follow only tizcat.com addresses, so they can never be turned into a way to send people to a fake site.",
  ]),
);

// 11. Privacy table
add(
  H1("11. Privacy and security at a glance"),
  table(["What", "Where it lives", "Who can see it"], [
    ["Passwords for websites", "TizCat's password manager, on your laptop, encrypted for your Windows account", "You. Not Yuzal, not TizCat."],
    ["Your TizCat account password", "Nowhere. Only a secret-keyed check value is stored.", "No one; it never leaves the page you type it on."],
    ["Pages Yuzal reads (local engine)", "Your laptop", "You"],
    ["Pages Yuzal reads (cloud engine)", "Sent for that turn to the AI company you chose", "That company, under your agreement with it"],
    ["Your browsing history", "Your laptop", "You. Never sent for ads."],
    ["Ad views and clicks (Rewards on)", "TizCat's rewards ledger: ad id, time, device", "TizCat, to count your points"],
    ["Your email address (if you make an account)", "TizCat's account database", "TizCat"],
    ["Wallet keys (JibWallet, later)", "Your device, encrypted", "You. TizCat never holds them."],
  ], [2700, 3900, 2760]),
);

// 12. Comparison
add(
  H1("12. TizCat beside Chrome and Brave"),
  P("TizCat is meant to feel like a browser people can switch to, not a lookalike, so it follows Chrome and Brave wherever they have settled on one way of doing things, and differs where it has a reason to."),
  table(["", "TizCat", "Google Chrome", "Brave"], [
    ["Engine", "Chromium", "Chromium", "Chromium"],
    ["Built-in AI agent", "Yuzal: reads and works with the page; local engine or your own key", "Gemini, Google's cloud AI", "Leo, its assistant; can use your own model"],
    ["Rewards for ads", "TizCat Rewards: opt in, 70 percent to people (points now)", "None", "Brave Rewards: opt in, 70 percent to people, in BAT"],
    ["Wallet", "JibWallet, planned", "None built in", "Brave Wallet"],
    ["Import from other browsers", "Every Chromium-based browser installed, per profile", "Limited", "Chrome, Edge, Opera and others"],
    ["Speed build", "PGO with Google's profile", "PGO and ThinLTO", "Its own official builds"],
  ], [2100, 2700, 2160, 2400]),
);

// 13. Roadmap
add(
  H1("13. Roadmap"),
  P("Each step pays for the next one, and no step needs the one after it. The order matters more than the dates, so the future steps carry none."),
  ...figure("fig9_roadmap.png", "Figure 9. What is done, and the order of what comes next."),
  table(["Step", "What happens"], [
    ["M0", "Finish the browser and make it something people keep: an installer, automatic updates, honest measurement of daily users."],
    ["M1", "The first revenue: a search revenue-share partner, and display ads on the New Tab page only."],
    ["M2", "The points ledger and the Rewards panel, with no crypto at all. Built and in testing."],
    ["M3", "Pay a small pilot group, in gift cards or a dollar stablecoin, with identity checks at withdrawal. JibWallet's first release."],
    ["M4", "TizCat's own ad catalog, matched on the device, sold directly to advertisers."],
    ["M5", "A self-serve portal where advertisers buy without talking to anyone."],
    ["M6", "JibCoin, if and only if the conditions in section 9.10 are met."],
  ], [1100, 8260]),
);

// 14. Creative kit
const videoPrompts = [
  // Brand and speed
  "**Cheetah to browser (Google Flow, Veo 3.1, 8 seconds, then Extend twice).** Dawn on a golden savanna, low camera at grass level. A cheetah made of folded gold paper, with navy tear lines under its eyes, crouches and bursts into a sprint. As it accelerates, its body unfolds into streaks of light that become the outline of a browser window rushing toward the camera. The light settles into a clean title card that reads \"TizCat\". Sound: wind, a single deep drum hit at the transformation, then silence. Cinematic, 24 frames per second, shallow depth of field, 16:9.",
  "**Tiz means fast (Veo 3.1, 8 seconds).** Macro shot of a person's hands typing a web address on a laptop. Time slows: each keystroke sends a ripple of gold light across the keyboard. The page appears before the last key is lifted. A warm voice says: \"Tiz. Persian for fast.\" Soft office light, real skin texture, 16:9.",
  "**The race (Kling, 15 seconds).** Split screen of two identical laptops on a wooden desk. Both open a news website at the same moment. The left screen fills in gradually; the right screen, framed with a thin gold edge, is complete almost instantly. A tiny origami cheetah sits beside the right laptop and yawns. Light, humorous tone, no logos other than a gold cheetah on the right laptop's lid.",
  "**Folded light (Runway, 10 seconds, loopable).** Abstract animation: hundreds of gold paper triangles fold and unfold in the dark, forming a cheetah's head for one moment, then scattering into a field of stars. Navy background, slow and elegant, seamless loop for a website header.",
  "**New Tab moment (Veo 3.1, 8 seconds).** Over-the-shoulder view of a person opening a new browser tab at night. The screen shows a calm navy background, a clock, a search box and a small card saying \"TizCat Rewards\". The person smiles slightly. The room is lit only by the screen. Quiet ambient sound, 16:9.",
  // Yuzal and privacy
  "**Meet Yuzal (Veo 3.1, 8 seconds, then Extend).** A browser window floats in a dark studio. From its right edge a side panel slides open, and from the panel emerges the face of a cheetah: one half spotted fur, the other half a teal network of glowing connected points. It blinks and says, in a calm, friendly voice: \"I'm Yuzal. I read the page with you.\" Soft key light, gentle particles, 16:9.",
  "**The vault stays home (Google Flow, 8 seconds x 3).** A cozy home office. A laptop on the desk glows with a small golden padlock above the keyboard. Thin lines of light try to leave the laptop through the window, and each one turns back at the glass. A voice says: \"Your passwords never leave your laptop. Not even for the AI.\" Warm lamp light, rain outside, 16:9.",
  "**Read-only means hands off (Veo 3.1, 8 seconds).** A friendly robotic cheetah paw hovers over a bank's \"Transfer\" button on a screen, then politely withdraws and points to a summary panel instead. On-screen caption: \"Read-only: Yuzal looks, you decide.\" Clean flat lighting, generic bank interface with no real brand names.",
  "**Never submit (Kling, 12 seconds).** Close-up of a form on a screen being filled in automatically, field by field, with a soft gold glow. The cursor stops beside a large \"Pay\" button and waits. A human finger taps the trackpad to press it. Caption: \"Yuzal fills. You press.\"",
  "**Local engine (Veo 3.1, 8 seconds).** Inside a laptop, visualized as a miniature city of glowing circuits. A teal light (Yuzal's thoughts) travels between buildings but never crosses the city wall at the edge of the frame. A sign at the wall reads \"Your laptop\". Isometric, stylized, calm music.",
  "**A patient portal, safely (Veo 3.1, 8 seconds, then Extend).** An older woman at a kitchen table reads her lab results on a laptop. A side panel explains them in plain words. She nods, writes a short message to her doctor, reviews it, and presses Send herself. Natural daylight, warm and respectful, no real hospital names, 16:9.",
  // Free AI
  "**Free, because it's yours (Runway, 10 seconds).** A paper price tag reading \"$0\" floats down onto a laptop keyboard and folds itself into a small gold cheetah, which curls up and goes to sleep. Text appears: \"AI that runs on your laptop. Free.\" Soft studio light, minimal.",
  "**Bring your own key (Veo 3.1, 8 seconds).** A person slides a glowing key card into the side of a laptop, and the side panel of the browser lights up. Caption: \"Use your own AI key. TizCat never pays with your data.\" Clean product-commercial style.",
  // Rewards, JibWallet, JibCoin
  "**Rewards, your way (Google Flow, 8 seconds x 2).** A person on a sofa with a laptop toggles a switch labeled \"Rewards: On\". A tasteful picture fills their New Tab page with a small \"Sponsored\" tag. A gold counter in the corner ticks up by one point. Caption: \"You choose to see ads. You keep 70 percent.\"",
  "**Your history stays home (Kling, 15 seconds).** A stream of ad cards flies toward a house. Inside, a small gold cheetah sorts them on a table and keeps only one, which it places on the screen. None of the person's browsing leaves the house. Caption: \"Ads are matched on your device.\" Storybook animation style.",
  "**Points become JibCoin (Veo 3.1, 8 seconds).** Glowing gold points rise from a laptop screen like fireflies and gather into a single coin engraved with a folded cheetah. The coin spins once and settles into a slim wallet that opens on the screen labeled \"JibWallet\". Caption: \"Coming later: JibCoin and JibWallet.\" Do not show prices or charts.",
  "**JibWallet, your keys (Runway, 10 seconds).** A key made of folded gold paper turns in a lock shaped like a cheetah's eye. Caption: \"Your keys stay with you. TizCat never holds them.\" Dark navy background, single soft light.",
  "**Closed loop (Kling, 15 seconds, motion graphic).** A circle animation: an advertiser icon, an eye (attention), a coin, and a sparkle (AI help), each connected by gold arrows, turning slowly. Narration: \"Attention earns JibCoin. JibCoin pays for AI. Nothing leaves the loop.\" Flat design, navy and gold.",
  // Explainers and social
  "**Import in one minute (Veo 3.1, 8 seconds x 4, screen-style).** A clean, stylized browser settings page titled \"Profile\". A cursor clicks \"Import bookmarks and settings\", picks \"Google Chrome Work\" from a list, and presses Import. Bookmarks fly into a bookmarks bar like birds landing on a wire. Light, upbeat music.",
  "**Founder's note (Synthesia or HeyGen avatar, 60 to 90 seconds).** A presenter in a bright, modern study explains in a calm voice why TizCat exists: speed, an AI agent that keeps secrets at home, and rewards that respect privacy. Lower-third titles introduce each point. Use the script from section 1 of this document.",
  "**Vertical teaser 1 (Veo 3.1, 8 seconds, 9:16).** A gold origami cheetah leaps across a phone-shaped frame from bottom to top, leaving the words \"Fast. Private. Yours.\" in its trail. Bold, punchy sound design.",
  "**Vertical teaser 2 (Kling, 10 seconds, 9:16).** A person's hand holds a laptop lid open; a side panel says \"Your passwords never reach the AI.\" The camera pushes in on the words, then cuts to the TizCat cheetah logo. Text overlay: \"TizCat browser\".",
  "**Vertical teaser 3 (Runway, 8 seconds, 9:16).** A stack of ad cards; a finger swipes all but one away; the remaining card glows and drops a gold point into a jar labeled \"Yours\". Caption: \"Ads you choose. Rewards you keep.\"",
  "**Day in the life (LTX Studio, 2 to 3 minutes, storyboard mode).** A student, a nurse and a small-business owner each use TizCat through one day: the student researches with Yuzal, the nurse reads a benefits page in read-only mode, the owner pays an invoice with Yuzal filling and the owner pressing Pay. Consistent characters across scenes, warm documentary look, voice-over in plain English.",
  "**Brand film (Google Flow scene builder, 3 to 5 minutes, many 8-second shots).** A story told in five acts: the savanna (speed), the city (the web), the home (privacy), the market (attention and rewards), and the horizon (JibWallet and the future). Recurring hero: the folded gold cheetah. Keep a written style sheet (colors navy and gold, 24 frames per second, soft film grain) and reuse the same cheetah reference image in every shot.",
];

const imagePrompts = [
  "**Hero poster (Gemini image or Imagen).** A folded-paper gold cheetah head, geometric facets catching warm light, navy tear lines under amber eyes, on a deep navy background with a soft gold glow behind it. Title space above in clean sans-serif: \"TizCat\". Premium, minimal, 16:9 and 4:5 versions.",
  "**New Tab wallpapers, set of four.** Calm, wide landscapes with room for a clock and search box in the center: a savanna at dawn, a city at blue hour, a misty forest, a starry desert. Subtle gold accents, no text, no people, 3840 by 2160.",
  "**Yuzal portrait.** A cheetah face split vertically: the left half realistic spotted fur, the right half a glowing teal network of nodes and lines. Friendly expression, dark studio background, rim light, square.",
  "**Privacy illustration.** A small laptop on a desk inside a translucent golden dome; thin lines of light approach from outside and bend away. Flat vector style, navy and gold palette, for a website section header.",
  "**JibCoin concept render.** A gold coin with a folded cheetah head embossed on one side and a simple geometric pattern on the other, resting on navy velvet. Studio lighting, macro lens. No price, no chart, no exchange logos.",
  "**JibWallet interface concept.** A clean, modern wallet screen inside a browser side panel: a balance in points, a \"JibCoin coming soon\" card, and a readable transaction confirmation. Light theme, navy and gold, realistic product mockup.",
  "**Rewards infographic.** A simple left-to-right diagram: advertiser, ad matched on your device, you see it, a point is counted, 70 percent to you. Flat icons, generous white space, navy and gold, landscape.",
  "**Whitepaper cover.** A minimal cover with a faceted gold cheetah line drawing, the title \"JibCoin whitepaper\", the subtitle \"Draft for discussion\", and lots of navy negative space. A4 portrait.",
  "**Social banner.** A wide banner with the gold cheetah on the right and the words \"Fast. Private. Yours.\" on the left in bold sans-serif. 1500 by 500 and 1584 by 396 versions.",
  "**Team and story image.** A bright, modern workspace with a whiteboard sketch of a cheetah and a browser window, sticky notes reading \"speed\", \"privacy\", \"rewards\". Natural light, candid, no faces in focus.",
];

add(
  H1("14. Creative kit: video and image prompts, and long-video platforms"),
  P("These prompts are written to be pasted into a video or image generator as they are, then adjusted. They describe TizCat's own look (the folded gold cheetah, navy and gold, Yuzal's half-network face) and avoid other companies' logos and real brand names."),
  H2("14.1 How to get good results"),
  ...bullets([
    "**One shot per prompt.** Most generators make clips of 5 to 15 seconds. Write each shot on its own, then join them.",
    "**Keep a style sheet.** Write the colors, lighting, camera style and the hero's description once, and paste them into every prompt, so the cheetah looks the same in every shot.",
    "**Reuse a reference image.** Make the hero image first (prompt 3 or the hero poster), then use it as the starting frame or ingredient in every video shot.",
    "**Add text and logos in the editor**, not in the prompt: generators often misspell words and distort logos.",
    "**Check rights and labels.** Use music you have a license for, and follow each platform's rules on labeling AI-generated content.",
  ]),
  H2("14.2 Video prompts"),
  ...numbered(videoPrompts, "videos"),
  H2("14.3 Image prompts"),
  ...numbered(imagePrompts, "images"),
  H2("14.4 Platforms for long generative AI videos"),
  P("No generator today makes a ten-minute film in one go. Long videos are made by generating many short, consistent shots and joining them, and the platforms differ in how well they help with that. Their limits change every few weeks; the figures below come from public reviews in October and November 2026 and should be checked on each platform before relying on them."),
  table(["Platform", "One clip", "How it reaches long videos", "Best for"], [
    ["Google Flow with Veo 3.1 (also in Gemini)", "8 seconds", "Scene builder and Extend (about 7 more seconds each time); reported up to about 2.5 minutes through the Gemini API; or chain shots from a last frame", "Cinematic shots with sound, consistent ingredients"],
    ["Kling (Kuaishou)", "About 15 seconds (3.0); about 30 seconds (4.0, early access)", "Extension up to about 3 minutes", "Long single scenes, motion"],
    ["Runway (Gen-4 and later)", "About 10 to 16 seconds", "Chaining clips, with one of the strongest editing toolkits", "Editing, effects, polish"],
    ["LTX Studio", "Scene by scene", "Script and storyboard to a full film with consistent characters", "Story-driven films of several minutes"],
    ["Synthesia, HeyGen", "Presenter video", "A talking presenter up to about 30 minutes", "Explainers, the founder's note, training"],
    ["InVideo AI", "Assembled", "Turns a script into a long video from generated and stock footage", "YouTube-length explainers"],
    ["Scenema", "Assembled", "Scene assembly; reported films up to about 21 minutes", "Long narratives"],
    ["Higgsfield", "Varies", "Claims long continuous generation; not independently confirmed", "Try before relying on it"],
    ["Sora (OpenAI)", "About 15 to 20 seconds", "Reports in 2026 say its apps were closed and its API scheduled to end; check whether it is available", "Check availability first"],
  ], [2050, 1650, 3500, 2160]),
  gap(),
  H3("A workflow for a three to ten minute TizCat film"),
  ...numbered([
    "Write the script and split it into scenes, then shots of 5 to 10 seconds.",
    "Make the style frames first with an image generator: the hero cheetah, Yuzal, the key locations.",
    "Generate each shot in Google Flow or Kling from those frames, extending where a shot must run longer.",
    "Record the voice-over (a real voice or an AI voice you have the rights to) and choose licensed music.",
    "Edit everything together in a video editor (DaVinci Resolve, Premiere, CapCut or similar), adding titles, the logo and captions there.",
  ], "workflow"),
);

// Appendices
add(
  H1("Appendix A. Glossary"),
  table(["Term", "Meaning"], [
    ["Chromium", "The open source project whose code Chrome, Edge, Brave and TizCat are built from"],
    ["Yuzal", "TizCat's AI agent, in the side panel"],
    ["Local engine", "An AI model running on your own laptop (through Ollama), so nothing leaves it"],
    ["PGO", "Profile-guided optimization: building the browser according to how real browsing uses its code"],
    ["TizCat Services", "The built-in module with the New Tab page, TizCat Rewards and the account link"],
    ["TizCat Rewards", "Opt-in ads on TizCat's own surfaces, earning points"],
    ["JibWallet", "TizCat's planned self-custody wallet"],
    ["JibCoin", "A proposed token on Solana; not issued"],
    ["CPM", "What an advertiser pays per thousand views"],
    ["Self-custody", "You hold your own keys; no company can move your funds"],
    ["Cloudflare Workers", "Small servers that run on Cloudflare's network; TizCat's servers"],
  ], [2400, 6960]),
  H1flow("Appendix B. Sources"),
  ...bullets([
    "TizCat's own plan, \"Plans: rewards, advertising, and what to build next\" (25 October 2026): advertising phases, the 70 percent share, per-user earnings, AI costs, the token allocation proposal, the legal questions and their sources.",
    "TizCat's documentation (README, SERVICES.md, YUZAL.md): what is built and tested, as of 18 November 2026.",
    "Cloudflare documentation, read 18 November 2026: Workers, D1, KV and Email Service limits and pricing.",
    "Long-video platform figures: openart.ai/blog/best-ai-video-generators-for-long-videos; scenema.ai/articles/what-is-the-longest-ai-video-you-can-make; autoreels.ai/blog/how-long-can-an-ai-generated-video-be-limits-by-tool-2026; datacamp.com/tutorial/veo-3-1-complete-guide-with-examples; eastondev.com/blog/en/posts/ai/20251207-veo3-long-video-guide; mootion.com long-form guides; dev.to/genra_ai on the limits of ten-minute AI video (all read November 2026; several are vendor content, and they disagree).",
  ]),
  gap(),
  P("Written for TizCat, November 2026. Figures about advertising, costs and earnings are planning estimates from public sources, not forecasts or quotes. The legal sections describe questions, not conclusions.", { italics: true, color: MUTED, size: 18 }),
);

// ---------------------------------------------------------------------------
// Document

const numberingConfig = [
  { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
  ...["videos", "images", "conditions", "workflow"].map((reference) => ({
    reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 540, hanging: 360 } } } }],
  })),
];

const doc = new Document({
  creator: "TizCat",
  title: "About TizCat, version 1",
  description: "TizCat browser overview, Yuzal, Rewards, JibWallet, the JibCoin whitepaper draft and a creative kit",
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal", next: "Normal",
        run: { font: "Calibri", size: 72, bold: true, color: NAVY }, paragraph: { spacing: { before: 0, after: 120 }, keepNext: true } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: "Calibri", size: 36, bold: true, color: NAVY }, paragraph: { spacing: { before: 120, after: 200 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: "Calibri", size: 28, bold: true, color: NAVY }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: "Calibri", size: 24, bold: true, color: GOLD_DARK }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, outlineLevel: 2 } },
    ],
  },
  numbering: { config: numberingConfig },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: "About TizCat, version 1   |   page ", color: MUTED, size: 16 }),
      new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 }),
    ] })] }) },
    children: content,
  }],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT, buffer);
  console.log("wrote", OUT, Math.round(buffer.length / 1024), "KB");
});

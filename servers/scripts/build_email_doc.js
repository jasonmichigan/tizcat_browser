// Builds servers\email_v1.docx: how hamid@tizcat.com and ramona@tizcat.com
// work and how to set up sending and receiving in Gmail.
//   python servers\scripts\make_email_figure.py
//   set NODE_PATH=%LOCALAPPDATA%\TizCatTools\node_modules   (docx 9.15.1)
//   node servers\scripts\build_email_doc.js
// Do not re-run it over a copy you have edited by hand: it writes a fresh file.
const fs = require("fs");
const path = require("path");
const {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, LevelFormat, Packer,
  PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} = require("docx");

const SERVERS = path.dirname(__dirname);
const OUT = path.join(SERVERS, "email_v1.docx");
const FIGURE = path.join(SERVERS, "email_figure.png");
const NAVY = "1C2B4A";
const GOLD_DARK = "8A5D0F";
const MUTED = "52514E";
const LINE = "D9D6CE";
const W = 9360;

function runs(text, opts = {}) {
  const out = [];
  for (const part of String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
    if (!part) continue;
    if (part.startsWith("**")) out.push(new TextRun({ text: part.slice(2, -2), bold: true, color: opts.color, size: opts.size }));
    else if (part.startsWith("`")) out.push(new TextRun({ text: part.slice(1, -1), font: "Consolas", size: opts.size || 20, color: "1C2B4A" }));
    else out.push(new TextRun({ text: part, bold: opts.bold, italics: opts.italics, color: opts.color, size: opts.size }));
  }
  return out;
}
const P = (t, o = {}) => new Paragraph({ children: runs(t, o), spacing: { after: o.after ?? 140, line: 288 }, alignment: o.align });
const H1 = (t, br = true) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)], pageBreakBefore: br });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const bullets = (items) => items.map((t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: runs(t), spacing: { after: 80, line: 276 } }));
let listCount = 0;
function steps(items) {
  const ref = `steps${++listCount}`;
  numberingRefs.push(ref);
  return items.map((t) => new Paragraph({ numbering: { reference: ref, level: 0 }, children: runs(t), spacing: { after: 110, line: 276 } }));
}
const numberingRefs = [];
const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
function table(headers, rows, widths) {
  const cell = (text, i, header) => new TableCell({
    borders: { top: border, bottom: border, left: border, right: border }, width: { size: widths[i], type: WidthType.DXA },
    shading: header ? { fill: "E9EDF5", type: ShadingType.CLEAR, color: "auto" } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: String(text).split("\n").map((l) => new Paragraph({ children: runs(l, { bold: header, size: 19, color: header ? NAVY : undefined }), spacing: { after: 30 } })),
  });
  return new Table({ width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) }))] });
}
function callout(title, lines, fill = "FBF4E4", edge = "E6C77F") {
  const b = { style: BorderStyle.SINGLE, size: 6, color: edge };
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [W], rows: [new TableRow({ cantSplit: true, children: [new TableCell({
    borders: { top: b, bottom: b, left: b, right: b }, width: { size: W, type: WidthType.DXA }, shading: { fill, type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 140, bottom: 120, left: 200, right: 200 },
    children: [new Paragraph({ children: runs(title, { bold: true, color: GOLD_DARK }), spacing: { after: 80 } }),
      ...lines.map((l) => new Paragraph({ children: runs(l, { size: 20 }), spacing: { after: 70, line: 276 } }))] })] })] });
}
const gap = () => new Paragraph({ children: [], spacing: { after: 120 } });

// Steps that are the same for both people, with their own values.
function gmailSteps(who, tizcat, gmail, alreadyVerified = false) {
  const test = [
    `Test it: from any other email account (a phone's mail app, a colleague), send a short email to **${tizcat}**. It should arrive in **${gmail}** within a minute, addressed to ${tizcat}.`,
    `Do not test by writing from ${gmail} itself: Gmail hides a message that comes back to the account that sent it, so the test would look lost even when forwarding works.`,
  ];
  const step1 = alreadyVerified ? [
    H2(`Step 1. Check that ${tizcat} reaches ${gmail}`),
    P(`**${gmail}** is the email of TizCat's Cloudflare account, so Cloudflare accepted it without a verification link. Forwarding for **${tizcat}** has been on since 18 November 2026.`),
    ...steps(test),
  ] : [
    H2(`Step 1. Confirm ${gmail} with Cloudflare (once)`),
    P(`Cloudflare sent an email to **${gmail}** on 18 November 2026, so that it may forward mail there. Until its link is clicked, nothing is forwarded.`),
    ...steps([
      `Open Gmail for **${gmail}** and look for an email from Cloudflare about verifying an **Email Routing** destination address (check Spam, Promotions and Updates if it is not in the inbox).`,
      "Open it and click **Verify email address**. A Cloudflare page confirms it.",
      `Wait a few minutes. A small program on Hamid's laptop checks every minute and switches on forwarding for **${tizcat}** as soon as the address is verified (or Hamid can do it in the Cloudflare dashboard, see section 5).`,
      ...test,
    ]),
  ];
  return [
    ...step1,
    H2("Step 2. Turn on 2-Step Verification (if it is not on yet)"),
    P("Google lets another mail program use your account only with an app password, and app passwords exist only when 2-Step Verification is on."),
    ...steps([
      `Sign in to Google as **${gmail}** and open **myaccount.google.com/security**.`,
      "Under \"How you sign in to Google\", choose **2-Step Verification** and follow the steps (a phone number or the Google app on your phone).",
    ]),
    H2("Step 3. Create an app password"),
    ...steps([
      "Open **myaccount.google.com/apppasswords** (type it in the address bar; the setting is not always shown in the menus).",
      `Give the app password a name you will recognize, for example **TizCat mail**, and choose **Create**.`,
      "Google shows a 16-letter password in four groups. Copy it now (without the spaces): Google shows it only once. Keep it in a password manager, never in an email or a shared file.",
      "If you just turned on 2-Step Verification, wait about ten minutes before using the app password.",
    ]),
    H2(`Step 4. Add ${tizcat} to Gmail as a "Send mail as" address`),
    P("Do this on a computer, in Gmail in a web browser. The phone app does not have this setting."),
    ...steps([
      "In Gmail, click the gear at the top right, then **See all settings**.",
      "Open the **Accounts and Import** tab (for some accounts it is called **Accounts**).",
      "In **Send mail as**, click **Add another email address**. A small window opens.",
      `**Name:** the name people should see, for example **${who} | TizCat**. **Email address:** **${tizcat}**. Leave **Treat as an alias** checked. Click **Next Step**.`,
      `Fill in the server details exactly: **SMTP Server** \`smtp.gmail.com\`, **Port** \`587\`, **Username** \`${gmail}\` (the full address), **Password** the 16-letter app password from step 3, and **Secured connection using TLS** selected. Click **Add Account**.`,
      `Gmail now sends a confirmation email to **${tizcat}**. It is forwarded straight back to ${gmail} (which is why step 1 must be done first). Open it and click the link, or type its code into the small window.`,
    ]),
    H2("Step 5. Make it the address you write from"),
    ...steps([
      `Back in **Settings, Accounts and Import, Send mail as**, click **make default** next to **${tizcat}**, so new emails come from it.`,
      "On the same page choose **Reply from the same address the message was sent to**, so replies to TizCat mail also come from TizCat.",
      `Optional: in **Settings, General, Signature**, create a signature such as \"${who}, ${who === "Ramona" ? "Business Manager" : "Developer Manager"}, TizCat, www.tizcat.com\" and choose it for ${tizcat}.`,
    ]),
    H2("Step 6. Test sending and replying"),
    ...steps([
      "Click **Compose**. The **From** line shows the TizCat address (click it to switch between addresses).",
      "Send a test to an address outside Gmail if you have one (a work or school account), and reply to it from there.",
      `Check that the message arrived **from ${tizcat}**, and that the reply came back to ${gmail} through ${tizcat}.`,
      "On your phone, in the Gmail app, tap **From** while writing to choose the TizCat address. It appears there once the setup above is done.",
    ]),
  ];
}

const content = [
  new Paragraph({ spacing: { before: 600, after: 120 }, alignment: AlignmentType.LEFT, children: runs("TizCat email", { size: 60, bold: true, color: NAVY }) }),
  new Paragraph({ spacing: { after: 60 }, children: runs("hamid@tizcat.com and ramona@tizcat.com: how they work, and how to send and receive with them in Gmail", { size: 28, color: NAVY }) }),
  new Paragraph({ spacing: { after: 360 }, children: runs("Version 1, 18 November 2026", { size: 22, color: MUTED }) }),
  callout("In one minute", [
    "Mail to **hamid@tizcat.com** goes to **hamid.ahady@gmail.com**; mail to **ramona@tizcat.com** goes to **jaberian.ramona@gmail.com**. Cloudflare forwards it, free, as soon as it arrives.",
    "Each of you then adds your TizCat address to your own Gmail as a \"Send mail as\" address, so you write and reply from **hamid@tizcat.com** or **ramona@tizcat.com** while everything stays in the Gmail you already use.",
    "**What each person has to do:** section 3 (Hamid) or section 4 (Ramona), about 15 minutes. Hamid also has one optional five-minute step in Cloudflare (section 5).",
  ]),
  gap(),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [new ImageRun({ type: "png", data: fs.readFileSync(FIGURE),
    transformation: { width: 624, height: Math.round(624 * fs.readFileSync(FIGURE).readUInt32BE(20) / fs.readFileSync(FIGURE).readUInt32BE(16)) },
    altText: { title: "How TizCat email works", description: "Receiving through Cloudflare Email Routing to Gmail; sending from Gmail with Send mail as through smtp.gmail.com", name: "email-flow" } })] }),
  P("How TizCat email works: Cloudflare forwards incoming mail to Gmail; Gmail sends outgoing mail with the TizCat address.", { italics: true, color: MUTED, size: 18, align: AlignmentType.CENTER, after: 240 }),

  H1("1. How it works"),
  P("tizcat.com has no mailbox of its own. Instead, two free services work together:"),
  ...bullets([
    "**Receiving: Cloudflare Email Routing.** Cloudflare runs tizcat.com's mail servers. When an email arrives for a TizCat address, Cloudflare forwards it at once to that person's Gmail. Nothing is stored at Cloudflare.",
    "**Sending: Gmail's \"Send mail as\".** Gmail can send from another address you own. It sends through Gmail's own mail server (smtp.gmail.com), signed in with a Google app password, and puts the TizCat address in the From line.",
  ]),
  table(["TizCat address", "Forwards to", "Person", "Sends from"], [
    ["hamid@tizcat.com", "hamid.ahady@gmail.com", "Hamid, Developer Manager", "that Gmail, as hamid@tizcat.com"],
    ["ramona@tizcat.com", "jaberian.ramona@gmail.com", "Ramona, Business Manager", "that Gmail, as ramona@tizcat.com"],
  ], [2200, 2700, 2200, 2260]),
  gap(),
  P("Your mail, contacts, search and spam filtering all stay in Gmail, on the computer and on the phone, as today."),

  H1("2. What is already set up", false),
  table(["Done on 18 November 2026", "Detail"], [
    ["Email Routing switched on for tizcat.com", "In TizCat's Cloudflare account; status \"ready\""],
    ["Mail server records added", "Three MX records (route1, route2 and route3.mx.cloudflare.net), an SPF record (v=spf1 include:_spf.mx.cloudflare.net ~all) and a DKIM key (cf2024-1._domainkey)"],
    ["Both Gmail addresses added as destinations", "hamid.ahady@gmail.com was accepted at once (it is the Cloudflare account's email); Cloudflare emailed jaberian.ramona@gmail.com a verification link (section 4, step 1)"],
    ["Forwarding rules", "hamid@tizcat.com to hamid.ahady@gmail.com is on. Ramona's rule is created automatically as soon as her address is verified, by a small program on Hamid's laptop (servers\\scripts\\email-routing-watch.ps1)"],
    ["The website", "www.tizcat.com/team lists both addresses under each title"],
  ], [3200, 6160]),

  H1("3. Hamid: set up hamid@tizcat.com"),
  ...gmailSteps("Hamid", "hamid@tizcat.com", "hamid.ahady@gmail.com", true),

  H1("4. Ramona: set up ramona@tizcat.com"),
  ...gmailSteps("Ramona", "ramona@tizcat.com", "jaberian.ramona@gmail.com"),

  H1("5. Hamid, optional: two records that help mail reach inboxes"),
  P("Mail sent from Gmail as a TizCat address usually arrives fine. Two small DNS records make it look more trustworthy to other mail providers, so it is less likely to land in spam. Both are free and take about five minutes in the Cloudflare dashboard (dash.cloudflare.com, logged in to TizCat's account)."),
  H2("5.1 Add Google to the SPF record"),
  ...steps([
    "Choose the **tizcat.com** domain, then **DNS**, then **Records**.",
    "Find the **TXT** record named **tizcat.com** whose content starts with `v=spf1`. Click **Edit**.",
    "Change its content to exactly `v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all` and **Save**. Keep the Cloudflare part: Cloudflare stops forwarding if it is removed.",
  ]),
  H2("5.2 Add a DMARC record"),
  ...steps([
    "In the same **DNS, Records** page, click **Add record**.",
    "**Type** TXT, **Name** `_dmarc`, **Content** `v=DMARC1; p=none; rua=mailto:hamid@tizcat.com`, then **Save**.",
    "This tells other providers that tizcat.com mail is genuine without blocking anything (p=none), and sends Hamid an occasional report. Reports are XML files; they can be ignored or read with a free DMARC report reader.",
  ]),
  H2("5.3 If the forwarding rule did not appear on its own"),
  ...steps([
    "In the dashboard open **Email Routing** for **tizcat.com**: choose the domain, then **Email**, then **Email Routing** (in newer dashboards: **Compute & AI**, then **Email Service**, then **Email Routing**). Open **Routing rules**.",
    "Click **Create address**: **Custom address** `hamid` (or `ramona`), **Action** Send to an email, **Destination** the verified Gmail address. Save.",
    "Or run `servers\\scripts\\email-routing-watch.ps1` again.",
  ]),

  H1("6. When something does not work"),
  table(["Problem", "What to do"], [
    ["The Cloudflare verification email never arrived", "Check Spam, Promotions and Updates. If it is not there, Hamid can resend it: in Email Routing (section 5.3 shows where), open Destination addresses and resend next to the address."],
    ["Mail to the TizCat address does not arrive", "Was the destination verified (step 1)? Is the rule listed in Routing rules (section 5.3)? Try again after five minutes; check Gmail's Spam."],
    ["Gmail says \"Authentication failed\" in step 4", "Use the app password, not your normal password, without spaces. Make sure the username is the full Gmail address. If 2-Step Verification was just turned on, wait ten minutes. Port 587 with TLS."],
    ["The app passwords page is not available", "2-Step Verification must be on. It is also unavailable when an account uses only security keys or has Advanced Protection."],
    ["Gmail's confirmation email (step 4) did not arrive", "It is sent to the TizCat address, so forwarding (step 1) must work first. Send yourself a test to check, then click Resend in Gmail's window."],
    ["Sent mail lands in the recipient's spam", "Add the two records in section 5. The first few messages from a new address are judged more strictly; it improves as people reply."],
    ["Recipients see \"via gmail.com\" or your Gmail address", "Some providers show which server sent the mail. Section 5 reduces it; check that the TizCat address is the default and that \"Reply from the same address\" is chosen (step 5)."],
    ["Replies go out from the Gmail address", "Step 5: choose \"Reply from the same address the message was sent to\", or pick the TizCat address in the From line."],
  ], [3300, 6060]),

  H1("7. Good to know"),
  ...bullets([
    "**Cost:** nothing. Cloudflare Email Routing is free, and so is Gmail.",
    "**Limits:** Gmail lets a personal account send to about 500 recipients a day, and messages over about 25 MB cannot be forwarded by Cloudflare. Neither matters for normal work mail.",
    "**Where mail lives:** only in each person's Gmail. Deleting it there deletes it; Cloudflare keeps no copy.",
    "**Security:** the app password is a key to your Gmail; never share it. If it might be known to someone else, delete it at myaccount.google.com/apppasswords and make a new one (then update step 4).",
    "**More addresses later** (for example ads@tizcat.com or press@tizcat.com) work the same way: a new routing rule to any verified Gmail, and a new \"Send mail as\" entry there. See section 5.3.",
    "**Sending from a TizCat server** (for example account confirmation emails) is a separate thing, Cloudflare Email Sending, which needs the paid Workers plan to reach other people. It is not needed for your own mail.",
  ]),
  H2("Settings at a glance"),
  table(["Setting", "Value"], [
    ["SMTP server", "smtp.gmail.com"],
    ["Port", "587"],
    ["Security", "TLS"],
    ["Username", "the full Gmail address (hamid.ahady@gmail.com or jaberian.ramona@gmail.com)"],
    ["Password", "the 16-letter Google app password (not the Gmail password)"],
    ["Treat as an alias", "checked"],
    ["Mail servers (MX) for tizcat.com", "route1, route2 and route3.mx.cloudflare.net (set by Cloudflare)"],
  ], [3000, 6360]),
];

const numberingConfig = [
  { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
  ...numberingRefs.map((reference) => ({ reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] })),
];

const doc = new Document({
  creator: "TizCat",
  title: "TizCat email, version 1",
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: "Calibri", size: 34, bold: true, color: NAVY }, paragraph: { spacing: { before: 240, after: 180 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: "Calibri", size: 26, bold: true, color: NAVY }, paragraph: { spacing: { before: 260, after: 110 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: { config: numberingConfig },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: "TizCat email, version 1   |   page ", color: MUTED, size: 16 }),
      new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 }),
    ] })] }) },
    children: content,
  }],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT, buffer);
  console.log("wrote", OUT, Math.round(buffer.length / 1024), "KB");
});

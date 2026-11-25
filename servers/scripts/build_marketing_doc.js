// Builds tizcat\visuals\marketing.docx, the team's marketing working document.
// Section 1: the TizCat email addresses (sign-in details, receiving and
// sending through Gmail). Later sections are meant to be added by hand.
//   set NODE_PATH=%LOCALAPPDATA%\TizCatTools\node_modules   (docx 9.15.1)
//   node servers\scripts\build_marketing_doc.js
// Do not re-run it over a copy you have edited by hand: it writes a fresh file.
// It never contains a password: the addresses have none, and app passwords
// belong in a password manager.
const fs = require("fs");
const path = require("path");
const {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, LevelFormat, Packer,
  PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} = require("docx");

const TIZCAT = path.dirname(path.dirname(path.dirname(__filename)));
const OUT = path.join(TIZCAT, "visuals", "marketing.docx");
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
    else if (part.startsWith("`")) out.push(new TextRun({ text: part.slice(1, -1), font: "Consolas", size: opts.size || 20, color: NAVY }));
    else out.push(new TextRun({ text: part, bold: opts.bold, italics: opts.italics, color: opts.color, size: opts.size }));
  }
  return out;
}
const P = (t, o = {}) => new Paragraph({ children: runs(t, o), spacing: { after: o.after ?? 140, line: 288 }, alignment: o.align });
const H1 = (t, br = false) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)], pageBreakBefore: br });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const numberingRefs = [];
const bullets = (items) => items.map((t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: runs(t), spacing: { after: 80, line: 276 } }));
let listCount = 0;
function steps(items) {
  const ref = `steps${++listCount}`;
  numberingRefs.push(ref);
  return items.map((t) => new Paragraph({ numbering: { reference: ref, level: 0 }, children: runs(t), spacing: { after: 110, line: 276 } }));
}
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

const content = [
  new Paragraph({ spacing: { before: 400, after: 100 }, children: runs("TizCat marketing", { size: 56, bold: true, color: NAVY }) }),
  new Paragraph({ spacing: { after: 60 }, children: runs("The team's working document for reaching advertisers, partners and the press", { size: 26, color: NAVY }) }),
  new Paragraph({ spacing: { after: 320 }, children: runs("Started 18 November 2026. Section 1: the team's TizCat email addresses.", { size: 21, color: MUTED }) }),

  H1("1. Team email: hamid@tizcat.com and ramona@tizcat.com"),
  callout("Usernames and passwords, in short", [
    "**hamid@tizcat.com and ramona@tizcat.com are not separate mailboxes.** They have no username or password of their own, and there is nothing to log in to.",
    "Mail sent to them is forwarded at once to each person's own Gmail, and each person sends from that Gmail with the TizCat address in the From line. You sign in to your Gmail as usual.",
    "The one extra password is a **Google app password** that each person creates once for their own Gmail (section 1.4). For security it is never written in this document or sent by email: keep it in a password manager.",
  ]),
  gap(),

  H2("1.1 Who gets what"),
  table(["TizCat address", "Person", "Mail arrives in", "You sign in with"], [
    ["hamid@tizcat.com", "Hamid, Developer Manager", "hamid.ahady@gmail.com", "hamid.ahady@gmail.com and its usual Google password"],
    ["ramona@tizcat.com", "Ramona, Business Manager", "jaberian.ramona@gmail.com", "jaberian.ramona@gmail.com and its usual Google password"],
  ], [2100, 2250, 2350, 2660]),
  gap(),
  P("**Status on 18 November 2026:** receiving is on for both addresses. Sending as the TizCat address needs the one-time setup in section 1.4, done by each person in their own Gmail. Both addresses are listed on www.tizcat.com/team, under each person's title."),

  H2("1.2 Every username and password, setting by setting"),
  table(["Where it is asked", "Username", "Password"], [
    ["Reading and writing mail: gmail.com or the Gmail app", "Your Gmail address", "Your normal Google password"],
    ["Gmail's \"Send mail as\" window (section 1.4, step 5)", "Your full Gmail address: `hamid.ahady@gmail.com` or `jaberian.ramona@gmail.com`", "Your Google app password: 16 letters, made in section 1.4, step 2. Not your normal password."],
    ["Mail server in that window", "SMTP server `smtp.gmail.com`, port `587`, secured connection using TLS", "(same as the row above)"],
    ["Cloudflare, only to change where mail is forwarded or to add an address", "TizCat's Cloudflare account, which Hamid manages", "In Hamid's password manager. Ramona does not need it."],
  ], [2900, 3230, 3230]),

  H2("1.3 Receiving email"),
  ...bullets([
    "**Nothing to set up.** Mail to your TizCat address arrives in your Gmail within about a minute, with the TizCat address in the To line. It works on the computer and in the Gmail app.",
    "**Keep TizCat mail together with a label.** In Gmail on a computer, click the search options icon at the right of the search box, type your TizCat address in **To**, click **Create filter**, tick **Apply the label**, choose **New label**, name it **TizCat**, and click **Create filter**.",
    "**To test it,** send a short email to your TizCat address from any other account (a work account, a phone's mail app, a colleague). Do not test from the same Gmail: Gmail hides a message that comes back to the account that sent it, so the test would look lost even when forwarding works.",
    "In the first days, check **Spam** once in a while, and mark anything from TizCat contacts as **Not spam**.",
  ]),

  H2("1.4 Sending as your TizCat address (once, about 15 minutes)"),
  P("Do this on a computer, in Gmail in a web browser; the phone app does not have these settings. Each person does it in their own Gmail."),
  ...steps([
    "**Turn on 2-Step Verification** if it is not on yet: open **myaccount.google.com/security**, choose **2-Step Verification** and follow the steps. App passwords exist only when it is on.",
    "**Create an app password:** open **myaccount.google.com/apppasswords**, give it the name **TizCat mail**, and choose **Create**. Google shows 16 letters in four groups, only once. Save them in a password manager, without the spaces. If 2-Step Verification was just turned on, wait about ten minutes before using it.",
    "In Gmail, click the gear at the top right, then **See all settings**, then the **Accounts and Import** tab (for some accounts it is called **Accounts**). In **Send mail as**, click **Add another email address**.",
    "**Name:** what people should see, for example **Ramona | TizCat** or **Hamid | TizCat**. **Email address:** your TizCat address. Leave **Treat as an alias** checked. Click **Next Step**.",
    "**SMTP Server** `smtp.gmail.com`, **Port** `587`, **Username** your full Gmail address, **Password** the app password from step 2, and **Secured connection using TLS** selected. Click **Add Account**.",
    "Gmail sends a confirmation email to your TizCat address, which is forwarded to your Gmail. Click the link in it, or type its code into the small window.",
    "Back in **Send mail as**, click **make default** next to your TizCat address, and choose **Reply from the same address the message was sent to**.",
  ]),

  H2("1.5 Sending day to day"),
  ...bullets([
    "**New email:** click **Compose**. The **From** line shows your TizCat address; click it to switch addresses.",
    "**Replies:** with \"Reply from the same address\" chosen, replies to TizCat mail go out from the TizCat address.",
    "**On the phone:** in the Gmail app, while writing, tap **From** and pick the TizCat address. It appears there once section 1.4 is done.",
    "**Signature** (Settings, General, Signature; choose it for the TizCat address): for example **Ramona | Business Manager, TizCat | ramona@tizcat.com | www.tizcat.com**, or for Hamid **Hamid | Developer Manager, TizCat | hamid@tizcat.com | www.tizcat.com**.",
  ]),

  H2("1.6 Marketing email: what Gmail is for, and what it is not"),
  ...bullets([
    "**Good for:** one-to-one email with advertisers, search and ad partners, the press and investors, and replies to anyone who writes in. Advertisers who want to work with TizCat write to **ramona@tizcat.com**.",
    "**Not for newsletters or mass mailings.** A personal Gmail can send to about 500 recipients a day, mass mail from it is likely to be marked as spam, and Google may block sending from the account.",
    "**For newsletters later,** use a mailing service (several have free plans) that manages subscriber lists and unsubscribe links. In the United States, the CAN-SPAM Act requires commercial email to have honest From and Subject lines, say that it is an advertisement, include a postal address, offer a working way to opt out, and honor opt-outs within 10 business days.",
  ]),

  H2("1.7 One step for Hamid: help TizCat mail reach inboxes"),
  P("Mail sent from Gmail as a TizCat address is more trusted by other providers, Yahoo and Outlook in particular, when tizcat.com says Gmail may send for it. **Not done yet (checked 18 November 2026).** About five minutes in the Cloudflare dashboard: choose **tizcat.com**, then **DNS**, then **Records**."),
  ...steps([
    "Edit the **TXT** record named **tizcat.com** whose content starts with `v=spf1`, and change it to exactly `v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all`. Keep the Cloudflare part: forwarding stops without it. Edit the existing record; never add a second one.",
    "Click **Add record**: **Type** TXT, **Name** `_dmarc`, **Content** `v=DMARC1; p=none; rua=mailto:hamid@tizcat.com`. Save.",
  ]),

  H2("1.8 When something does not work"),
  table(["Problem", "What to do"], [
    ["Gmail says \"Authentication failed\" in section 1.4", "Use the app password, not your normal password, without spaces. The username is the full Gmail address. Port 587 with TLS. If 2-Step Verification was just turned on, wait ten minutes."],
    ["The app passwords page is not available", "2-Step Verification must be on. It is also unavailable for accounts that use only security keys or have Advanced Protection."],
    ["The confirmation email in section 1.4 does not arrive", "Send a test to your TizCat address from another account (section 1.3). Check Spam. Then click Resend in Gmail's window."],
    ["Sending stopped working after a password change", "Changing your Google password cancels all app passwords. Make a new one (section 1.4, step 2), then in Send mail as click **edit info** next to the TizCat address and enter it."],
    ["Mail you send lands in the recipient's spam", "Section 1.7. New addresses are judged more strictly at first; it improves as people reply."],
    ["Recipients see \"via gmail.com\" or your Gmail address", "Section 1.7 helps. Check that the TizCat address is the default and that \"Reply from the same address\" is chosen."],
    ["Mail to the TizCat address does not arrive", "Ask Hamid to check the forwarding rule in Cloudflare (Email, Email Routing, Routing rules)."],
  ], [3300, 6060]),

  H2("1.9 Keeping it safe"),
  ...bullets([
    "Never put an app password in an email, a chat or a shared file, including this document.",
    "If an app password may have been seen by someone else, delete it at **myaccount.google.com/apppasswords**, make a new one, and enter it with **edit info** in Send mail as.",
    "Keep 2-Step Verification on: turning it off cancels every app password, and sending as TizCat stops.",
    "More detail, with a diagram of how the mail flows: **servers\\email_v1.docx** in the TizCat project folder.",
  ]),
];

const numberingConfig = [
  { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
  ...numberingRefs.map((reference) => ({ reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] })),
];

const doc = new Document({
  creator: "TizCat",
  title: "TizCat marketing",
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
      new TextRun({ text: "TizCat marketing   |   page ", color: MUTED, size: 16 }),
      new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 }),
    ] })] }) },
    children: content,
  }],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT, buffer);
  console.log("wrote", OUT, Math.round(buffer.length / 1024), "KB");
});

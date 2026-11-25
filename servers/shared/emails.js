// The words of TizCat's account emails, as plain text and HTML. Inline
// styles only (email programs ignore style sheets); no pictures, so nothing
// is fetched when the email is opened.

const BRAND = "#e8590c";

function page(title, paragraphs, button, after) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.5">${esc(p)}</p>`).join("");
  const action = button
    ? `<p style="margin:24px 0"><a href="${esc(button.link)}" style="background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${esc(button.label)}</a></p>` +
      `<p style="margin:0 0 16px;line-height:1.5;color:#555555;font-size:13px">If the button does not work, copy this address into TizCat or any browser:<br><span style="word-break:break-all">${esc(button.link)}</span></p>`
    : "";
  const tail = (after || []).map((p) => `<p style="margin:0 0 12px;line-height:1.5;color:#555555;font-size:13px">${esc(p)}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5">` +
    `<div style="max-width:520px;margin:0 auto;padding:32px 24px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f1f1f;font-size:15px">` +
    `<p style="margin:0 0 24px;font-size:20px;font-weight:700;color:${BRAND}">TizCat</p>` +
    `<div style="background:#ffffff;border-radius:12px;padding:28px">` +
    `<h1 style="margin:0 0 16px;font-size:20px">${esc(title)}</h1>${body}${action}${tail}</div>` +
    `<p style="margin:20px 0 0;color:#777777;font-size:12px;line-height:1.5">TizCat, www.tizcat.com. You got this email because of a TizCat account with this address.</p>` +
    `</div></body></html>`;
}

function text(title, paragraphs, button, after) {
  return [title, "", ...paragraphs.flatMap((p) => [p, ""]),
    ...(button ? [`${button.label}: ${button.link}`, ""] : []),
    ...(after || []).flatMap((p) => [p, ""]),
    "TizCat, www.tizcat.com"].join("\n");
}

function build(subject, title, paragraphs, button, after) {
  return { subject, text: text(title, paragraphs, button, after), html: page(title, paragraphs, button, after) };
}

export function verifyEmail(link, hours) {
  return build(
    "Confirm your TizCat account",
    "Welcome to TizCat",
    ["Please confirm your email address to activate your TizCat account."],
    { label: "Activate my account", link },
    [`The link works for ${hours} hours. If you did not create a TizCat account, you can ignore this email: without the click, no account is made.`],
  );
}

export function resetEmail(link, minutes) {
  return build(
    "Reset your TizCat password",
    "Reset your password",
    ["Someone, hopefully you, asked to reset the password of your TizCat account."],
    { label: "Choose a new password", link },
    [
      `The link works for ${minutes} minutes and only once. If you did not ask for this, ignore this email: your password stays as it is.`,
      "Your synced data is encrypted with your password, so a reset clears the copy on TizCat's servers. Your TizCat browsers still have it and upload it again after you sign in to them.",
    ],
  );
}

export function passwordChangedEmail() {
  return build(
    "Your TizCat password was changed",
    "Your password was changed",
    ["The password of your TizCat account was just changed, and other places where you were logged in on the account site were logged out. Your TizCat browsers stay signed in."],
    null,
    ["If this was not you, reset your password now at account.tizcat.com (Log in, then \"Forgot your password?\")."],
  );
}

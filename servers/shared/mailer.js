// Sends TizCat's account emails (confirm your address, reset your password,
// your password was changed) through the provider named in config.json
// "email.provider". Switching provider is a config change, no deploy:
//
//   "cloudflare"  Cloudflare's send_email binding (EMAIL). On the free plan
//                 it reaches only addresses verified in Email Routing (the
//                 team's own); anyone else needs Workers Paid.
//   "resend"      Resend's API; secret RESEND_API_KEY (free: 100 a day).
//   "brevo"       Brevo's API; secret BREVO_API_KEY (free: 300 a day).
//
// Answers {ok: true} or {ok: false, reason}. The address is never logged.

export async function sendMail(env, config, { to, subject, text, html }) {
  const email = config.email || {};
  const from = email.from || { name: "TizCat", address: "account@tizcat.com" };
  try {
    switch (email.provider) {
      case "cloudflare":
        if (!env.EMAIL) {
          return { ok: false, reason: "no EMAIL binding" };
        }
        await env.EMAIL.send({
          to,
          from: { email: from.address, name: from.name },
          subject,
          text,
          html,
        });
        return { ok: true };
      case "resend":
        return await post("https://api.resend.com/emails", {
          authorization: `Bearer ${env.RESEND_API_KEY || ""}`,
        }, {
          from: `${from.name} <${from.address}>`,
          to: [to],
          subject,
          text,
          html,
        });
      case "brevo":
        return await post("https://api.brevo.com/v3/smtp/email", {
          "api-key": env.BREVO_API_KEY || "",
          accept: "application/json",
        }, {
          sender: { name: from.name, email: from.address },
          to: [{ email: to }],
          subject,
          textContent: text,
          htmlContent: html,
        });
      default:
        return { ok: false, reason: "no email provider" };
    }
  } catch (e) {
    const reason = (e && (e.code || e.message)) || String(e);
    console.error("mail", email.provider, reason);
    return { ok: false, reason };
  }
}

async function post(url, headers, body) {
  const answer = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (answer.ok) {
    return { ok: true };
  }
  const detail = (await answer.text().catch(() => "")).slice(0, 200);
  console.error("mail", url, answer.status, detail);
  return { ok: false, reason: `HTTP ${answer.status}` };
}

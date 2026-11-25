# TizCat's servers

The Cloudflare Workers behind www.tizcat.com, account.tizcat.com and
api.tizcat.com, on Cloudflare's free plan. The map, how to change each part
quickly, the security design and the limits are in `..\docs\SERVICES.md`.

    powershell -ExecutionPolicy Bypass -File servers\scripts\deploy.ps1 <part|all|config|secrets|health>
    node servers\tests\servers.test.mjs
    node servers\tests\smoke.mjs

`cloudflare.txt` here holds your Cloudflare login. Nothing uses its
password: Wrangler logs in through the browser. It is in a synced folder,
so it is better kept in a password manager.

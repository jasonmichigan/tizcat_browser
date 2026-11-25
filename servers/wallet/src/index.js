// tizcat-wallet: JibWallet's server part, a placeholder.
//
//   GET /v1/wallet/info   what JibWallet and JibCoin are, and their state
//   anything else         501 "not_yet"
//
// When JibWallet is designed, its calls go here (linking a Solana address,
// payouts of Rewards points as JibCoin). The wallet's keys will stay in the
// browser (a TizCat module); this part never holds them.
import { WorkerEntrypoint } from "cloudflare:workers";
import { liveConfig } from "../../shared/config.js";
import { error, json } from "../../shared/http.js";

export const VERSION = "0.1.0";

export default class WalletService extends WorkerEntrypoint {
  async fetch(request) {
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    if (path === "/v1/wallet/info" && request.method === "GET") {
      const config = await liveConfig(this.env);
      return json({ ok: true, wallet: config.wallet, coin: config.coin });
    }
    return error(501, "not_yet", "JibWallet is coming.");
  }

  async health() {
    return { part: "wallet", version: VERSION, ok: true, status: "placeholder" };
  }
}

import { handleApi } from "./handlers.js";
import { wrapD1, asMiniDb } from "./db.js";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MARKUP_DEFAULT?: string;
  META_VENTAS_MENSUAL?: string;
  META_GANANCIA_MENSUAL?: string;
  HARD_SKIP_CODINEU?: string;
}

/**
 * Cloudflare Worker entry — same API surface as local (`handlers.ts` + MiniDb).
 * Never invents opportunities/prices/stock. Never auto-buys / auto-bids.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const db = asMiniDb(wrapD1(env.DB));
      const res = await handleApi(request, db);
      if (res) return res;
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("M&M RADAR — configure [assets] in wrangler.toml", { status: 200 });
  },
};

import { handleApi, envFromVars } from "./api.js";
import { wrapD1 } from "./db.js";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MARKUP_DEFAULT?: string;
  META_VENTAS_MENSUAL?: string;
  META_GANANCIA_MENSUAL?: string;
  HARD_SKIP_CODINEU?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const db = wrapD1(env.DB);
      const cfg = envFromVars({
        MARKUP_DEFAULT: env.MARKUP_DEFAULT,
        META_VENTAS_MENSUAL: env.META_VENTAS_MENSUAL,
        META_GANANCIA_MENSUAL: env.META_GANANCIA_MENSUAL,
      });
      const res = await handleApi(request, db, cfg);
      if (res) return res;
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("M&M RADAR — configure [assets]", { status: 200 });
  },
};

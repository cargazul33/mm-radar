#!/usr/bin/env node
/**
 * Local fallback: Node HTTP + sql.js (no Cloudflare account needed).
 * Serves public/ static + /api/* via same handler as Workers.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8787);
const DB_PATH = path.join(ROOT, "data", "local.sqlite");
const SCHEMA = path.join(ROOT, "migrations", "0001_init.sql");

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js");

async function buildBundle() {
  const outfile = path.join(ROOT, "dist", "local-entry.mjs");
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(ROOT, "src", "local-entry.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
  });
  return pathToFileURL(outfile).href + `?t=${Date.now()}`;
}

function wrapSqlJs(db) {
  function prepare(sql) {
    let bound = [];
    const api = {
      bind(...values) {
        bound = values.map((v) => (v === undefined ? null : v));
        return api;
      },
      async first() {
        const stmt = db.prepare(sql);
        try {
          stmt.bind(bound);
          if (stmt.step()) return stmt.getAsObject();
          return null;
        } finally {
          stmt.free();
        }
      },
      async all() {
        const stmt = db.prepare(sql);
        const results = [];
        try {
          stmt.bind(bound);
          while (stmt.step()) results.push(stmt.getAsObject());
        } finally {
          stmt.free();
        }
        return { results };
      },
      async run() {
        db.run(sql, bound);
        const changes = db.getRowsModified();
        let last_row_id = null;
        try {
          const r = db.exec("SELECT last_insert_rowid() as id");
          last_row_id = r?.[0]?.values?.[0]?.[0] ?? null;
        } catch {}
        persist();
        return { success: true, meta: { changes, last_row_id } };
      },
    };
    return api;
  }

  function persist() {
    const data = db.export();
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }

  return {
    prepare,
    async exec(sql) {
      db.exec(sql);
      persist();
    },
    persist,
    _raw: db,
  };
}

function contentType(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function main() {
  const SQL = await initSqlJs();
  let db;
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  const schema = fs.readFileSync(SCHEMA, "utf8");
  db.exec(schema);

  const wrapped = wrapSqlJs(db);
  wrapped.persist();

  const href = await buildBundle();
  const mod = await import(href);
  const { handleApi, envFromVars } = mod;
  const cfg = envFromVars(process.env);

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || `127.0.0.1:${PORT}`;
      const url = new URL(req.url || "/", `http://${host}`);
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const bodyBuf = Buffer.concat(chunks);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method || "GET") ? undefined : bodyBuf,
      });

      if (url.pathname.startsWith("/api/")) {
        const response = await handleApi(request, wrapped, cfg);
        if (!response) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        const buf = Buffer.from(await response.arrayBuffer());
        const headers = {};
        response.headers.forEach((v, k) => {
          headers[k] = v;
        });
        res.writeHead(response.status, headers);
        res.end(buf);
        return;
      }

      let rel = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = path.join(ROOT, "public", path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, ""));
      if (!filePath.startsWith(path.join(ROOT, "public")) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "content-type": contentType(filePath) });
      res.end(fs.readFileSync(filePath));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err?.stack || err) }));
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`M&M RADAR local → http://127.0.0.1:${PORT}`);
    console.log(`DB: ${DB_PATH}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

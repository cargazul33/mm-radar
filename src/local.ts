import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database as SqlJsDb } from "sql.js";
import { createRequire } from "node:module";
import type { MiniDb, SqlValue } from "./db.js";
import { handleApi } from "./handlers.js";
import { ensureSchema } from "./db.js";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = existsSync(join(here, "wrangler.toml")) ? here : join(here, "..");
const dataDir = join(root, "data");
const dbPath = process.env.MM_RADAR_DB || join(dataDir, "local.sqlite");
const schemaPath = join(root, "migrations", "0001_init.sql");
const publicDir = join(root, "public");
const PORT = Number(process.env.PORT || 8787);

function wrapSqlJs(sdb: SqlJsDb, persist: () => void): MiniDb {
  return {
    async all<T>(sql: string, ...params: SqlValue[]) {
      const stmt = sdb.prepare(sql);
      try {
        if (params.length) stmt.bind(params as never[]);
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
    async one<T>(sql: string, ...params: SqlValue[]) {
      const stmt = sdb.prepare(sql);
      try {
        if (params.length) stmt.bind(params as never[]);
        if (stmt.step()) return stmt.getAsObject() as T;
        return null;
      } finally {
        stmt.free();
      }
    },
    async run(sql: string, ...params: SqlValue[]) {
      sdb.run(sql, params as never[]);
      const q = sdb.exec("SELECT last_insert_rowid() AS id");
      const lastId = Number(q[0]?.values?.[0]?.[0] ?? 0);
      persist();
      return { lastId, changes: sdb.getRowsModified() };
    },
    async exec(sql: string) {
      sdb.exec(sql);
      persist();
    },
  };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function main() {
  mkdirSync(dataDir, { recursive: true });
  const wasmDir = dirname(require.resolve("sql.js/dist/sql-wasm.js"));
  const SQL = await initSqlJs({
    locateFile: (f: string) => join(wasmDir, f),
  });
  let sdb: SqlJsDb;
  if (existsSync(dbPath)) {
    sdb = new SQL.Database(readFileSync(dbPath));
  } else {
    sdb = new SQL.Database();
  }
  const schema = readFileSync(schemaPath, "utf8");
  sdb.exec(schema);
  const dbBootstrap = wrapSqlJs(sdb, () => {});
  await ensureSchema(dbBootstrap);
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const persistNow = () => {
    mkdirSync(dirname(dbPath), { recursive: true });
    writeFileSync(dbPath, Buffer.from(sdb.export()));
  };
  const persist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 50);
  };
  persistNow();
  const db = wrapSqlJs(sdb, persist);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const host = req.headers.host || `127.0.0.1:${PORT}`;
      const url = new URL(req.url || "/", `http://${host}`);
      if (url.pathname.startsWith("/api/")) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
        }
        const request = new Request(url.toString(), {
          method: req.method || "GET",
          headers,
          body: ["GET", "HEAD"].includes(req.method || "GET") ? undefined : body,
        });
        const out = (await handleApi(request, db)) ??
          new Response(JSON.stringify({ error: "not found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        res.statusCode = out.status;
        out.headers.forEach((val, key) => res.setHeader(key, val));
        res.end(Buffer.from(await out.arrayBuffer()));
        return;
      }

      let filePath = join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);
      if (!existsSync(filePath) || url.pathname === "/" || !extname(filePath)) {
        filePath = join(publicDir, "index.html");
      }
      if (!existsSync(filePath)) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const ext = extname(filePath);
      res.setHeader("content-type", MIME[ext] || "application/octet-stream");
      res.end(readFileSync(filePath));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: String(e) }));
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`M&M RADAR local → http://127.0.0.1:${PORT}  db=${dbPath}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

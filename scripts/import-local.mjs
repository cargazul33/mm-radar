#!/usr/bin/env node
/** Importa import-out/import.json a data/local.sqlite vía API o directo. */
import { createRequire } from "node:module";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const jsonPath = process.argv[2] || join(root, "import-out", "import.json");

if (!existsSync(jsonPath)) {
  console.error("No existe", jsonPath, "— corré npm run export:commerce primero");
  process.exit(1);
}

// Prefer calling built import through a tiny TS runner via npx tsx if available,
// else POST to local server, else inline with sql.js + dynamic import of dist.
const payload = JSON.parse(readFileSync(jsonPath, "utf8"));

async function viaDirect() {
  // Use vitest/tsx path: run small node script with esbuild-register
  const code = `
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { importPayload } from '../src/services/import.ts';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = join(root, 'data', 'local.sqlite');
const schema = readFileSync(join(root, 'migrations', '0001_init.sql'), 'utf8');
const payload = JSON.parse(readFileSync(process.argv[2], 'utf8'));
mkdirSync(dirname(dbPath), { recursive: true });
const wasmDir = dirname(require.resolve('sql.js/dist/sql-wasm.js'));
const SQL = await initSqlJs({ locateFile: f => join(wasmDir, f) });
const sdb = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
sdb.exec(schema);
const persist = () => writeFileSync(dbPath, Buffer.from(sdb.export()));
const db = {
  async all(sql, ...params) {
    const st = sdb.prepare(sql); try { if (params.length) st.bind(params); const rows=[]; while(st.step()) rows.push(st.getAsObject()); return rows; } finally { st.free(); }
  },
  async one(sql, ...params) {
    const st = sdb.prepare(sql); try { if (params.length) st.bind(params); return st.step() ? st.getAsObject() : null; } finally { st.free(); }
  },
  async run(sql, ...params) {
    sdb.run(sql, params); const q = sdb.exec('SELECT last_insert_rowid() AS id'); persist();
    return { lastId: Number(q[0]?.values?.[0]?.[0] ?? 0), changes: sdb.getRowsModified() };
  },
  async exec(sql) { sdb.exec(sql); persist(); },
};
const res = await importPayload(db, payload);
persist();
console.log(JSON.stringify(res, null, 2));
`;
  const tmp = join(root, "scripts", "_run_import.mts");
  writeFileSync(tmp, code);
  // Use vitest's vite-node or npx tsx
  let r = spawnSync("npx", ["--yes", "tsx", tmp, jsonPath], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env },
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    // fallback: use vitest run of a helper
    process.exit(1);
  }
  console.log(r.stdout);
}

await viaDirect();

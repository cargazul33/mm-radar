#!/usr/bin/env node
/**
 * Exporta datos reales desde mm-ai-commerce SQLite → JSON para /api/import.
 * NO inventa filas. Hard-skip 16514. Incluye #16813 si existe.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "import-out");
const defaultDb = "/workspace/mm-ai-commerce/data/mm_commerce.db";
const dbPath = process.env.COMMERCE_DB || defaultDb;
const HARD_SKIP = new Set(["16514"]);

mkdirSync(outDir, { recursive: true });

if (!existsSync(dbPath)) {
  const empty = { opportunities: [], note: "commerce DB no presente — DB vacía, sin fake tenders" };
  writeFileSync(join(outDir, "import.json"), JSON.stringify(empty, null, 2));
  console.log("Sin DB commerce. Wrote empty import.json");
  process.exit(0);
}

const py = `
import sqlite3, json, sys
db = sys.argv[1]
c = sqlite3.connect(db)
c.row_factory = sqlite3.Row
HARD = {"16514"}

def d(r):
  return {k: r[k] for k in r.keys()}

suppliers = []
for r in c.execute("SELECT * FROM suppliers"):
  suppliers.append({
    "name": r["name"] if "name" in r.keys() else str(r["id"]),
    "web": r["website"] if "website" in r.keys() else (r["web"] if "web" in r.keys() else ""),
    "source_url": r["website"] if "website" in r.keys() else "",
    "verified": bool(r["verified"]) if "verified" in r.keys() else False,
  })
# fix supplier columns dynamically
suppliers = []
cols = [x[1] for x in c.execute("pragma table_info(suppliers)")]
for r in c.execute("SELECT * FROM suppliers"):
  rd = d(r)
  name = rd.get("name") or rd.get("razon_social") or f"supplier-{rd.get('id')}"
  web = rd.get("web") or rd.get("website") or rd.get("url") or ""
  suppliers.append({"name": name, "web": web, "source_url": web, "verified": bool(rd.get("verified"))})

opps = []
for r in c.execute("SELECT * FROM opportunities"):
  rd = d(r)
  ext = str(rd.get("external_id") or "")
  url = (rd.get("url") or "").strip()
  pliego = (rd.get("pliego_url") or "").strip()
  if not url:
    continue  # never invent URL
  item = {
    "external_id": ext,
    "source": (rd.get("source") or "CODINEU").upper(),
    "title": rd.get("title") or "",
    "organism": rd.get("organism") or "",
    "rubros": rd.get("rubros") or "",
    "modality": rd.get("modality") or "",
    "source_url": url,
    "url": url,
    "pliego_url": pliego,
    "apertura_at": rd.get("opening_at") or "",
    "cierre_at": rd.get("cierre_at") or "",
    "publicacion_at": rd.get("publicacion_at") or "",
    "timing_state": rd.get("timing_state") or "NO VERIFICADO",
    "pipeline": "NUEVA",
    "fit_hint": rd.get("fit_score"),
    "risk_level": rd.get("risk_level") or "",
    "skipped": 1 if rd.get("skipped") else 0,
    "skip_reason": rd.get("skip_reason") or "",
    "raw_json": rd.get("raw_json") or "{}",
    "verification": "IMPORTADO_COMMERCE",
    "verified_at": rd.get("updated_at"),
    "items": [],
    "matches": [],
  }
  # pipeline map from commerce state
  st = (rd.get("state") or "").upper()
  if item["skipped"]:
    item["pipeline"] = "DESCARTADA" if "VENC" in (item["skip_reason"] or "").upper() else "DESCARTADA"
  elif st in ("PRICING", "COTIZANDO"):
    item["pipeline"] = "COTIZANDO"
  elif st == "RADAR":
    item["pipeline"] = "NUEVA"
  elif st == "ARCHIVADA":
    item["pipeline"] = "DESCARTADA"
    item["skipped"] = 1
  # tender / bid_scope
  tenders = c.execute("SELECT * FROM tenders WHERE opportunity_id = ?", (rd["id"],)).fetchall()
  if tenders:
    t = d(tenders[0])
    item["pliego_file"] = t.get("doc_path") or ""
    notes = t.get("notes") or ""
    if "bid_scope=" in notes:
      item["bid_scope"] = notes.split("bid_scope=")[-1].split(";")[0].strip()
    elif t.get("bid_scope_json") and t.get("bid_scope_json") not in ("{}", ""):
      try:
        bj = json.loads(t["bid_scope_json"])
        item["bid_scope"] = bj.get("scope") or bj.get("bid_scope") or json.dumps(bj)
      except Exception:
        item["bid_scope"] = ""
    # items
    for it in c.execute("SELECT * FROM tender_items WHERE tender_id = ?", (t["id"],)):
      itd = d(it)
      item["items"].append({
        "line_no": itd.get("line_no") or 1,
        "description": itd.get("product") or "",
        "qty": itd.get("qty") or 1,
        "unit": itd.get("unit") or "u",
        "brand": itd.get("brand") or "",
        "model": itd.get("model") or "",
        "unit_cost": None,
        "cost_verified": False,
        "verification": itd.get("verification") or "NO VERIFICADO",
        "source_url": url,
      })
  # supplier quotes
  for sq in c.execute("SELECT * FROM supplier_quotes WHERE opportunity_id = ?", (rd["id"],)):
    sqd = d(sq)
    # resolve line_no
    line_no = None
    if sqd.get("tender_item_id"):
      ti = c.execute("SELECT line_no FROM tender_items WHERE id = ?", (sqd["tender_item_id"],)).fetchone()
      if ti: line_no = ti[0]
    sname = ""
    if sqd.get("supplier_id"):
      srow = c.execute("SELECT * FROM suppliers WHERE id = ?", (sqd["supplier_id"],)).fetchone()
      if srow:
        sd = d(srow)
        sname = sd.get("name") or sd.get("razon_social") or f"supplier-{sd.get('id')}"
    ver = (sqd.get("verification") or "").upper()
    cost_verified = ver in ("VERIFICADO",) and sqd.get("unit_cost") is not None
    stock_note = (sqd.get("stock_note") or "").upper()
    stock_verified = False
    stock_val = None
    if stock_note in ("1", "INSTOCK", "IN STOCK") or "DISPONIBLE" in stock_note:
      # still STOCK_NO_VERIFICADO unless verification says VERIFICADO
      if ver == "VERIFICADO":
        stock_verified = True
        stock_val = 1
    mc = (sqd.get("match_class") or "").upper()
    item["matches"].append({
      "line_no": line_no,
      "supplier_name": sname,
      "product_label": sqd.get("product_label") or "",
      "match_type": mc,
      "unit_cost": sqd.get("unit_cost"),
      "cost_verified": cost_verified,
      "stock": stock_val,
      "stock_verified": stock_verified,
      "why": f"commerce match_class={mc}; verification={sqd.get('verification')}",
      "verification": sqd.get("verification") or "NO VERIFICADO",
      "source_url": sqd.get("url") or url,
      "verified_at": sqd.get("verified_at"),
    })
  if ext in HARD:
    item["skipped"] = 1
    item["skip_reason"] = f"HARD_SKIP CODINEU {ext}"
    item["pipeline"] = "SKIPPED_HARD"
  opps.append(item)

out = {
  "opportunities": opps,
  "suppliers": suppliers,
  "source_db": db,
  "note": "Export real desde mm-ai-commerce. Sin filas inventadas.",
}
print(json.dumps(out, ensure_ascii=False, indent=2))
`

const r = spawnSync("python3", ["-c", py, dbPath], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}
const jsonPath = join(outDir, "import.json");
writeFileSync(jsonPath, r.stdout);
const data = JSON.parse(r.stdout);
const has16813 = (data.opportunities || []).some((o) => String(o.external_id) === "16813");
console.log(`Wrote ${jsonPath}: ${data.opportunities?.length || 0} opps, 16813=${has16813}`);

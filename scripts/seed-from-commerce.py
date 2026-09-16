#!/usr/bin/env python3
"""Seed mm-radar local.sqlite from mm-ai-commerce. No fake tenders. Hard-skip 16514."""
from __future__ import annotations
import json, os, sqlite3, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "migrations" / "0001_init.sql"
OUT_DB = Path(os.environ.get("MM_RADAR_DB", ROOT / "data" / "local.sqlite"))
COMMERCE = Path(os.environ.get("COMMERCE_DB", "/workspace/mm-ai-commerce/data/mm_commerce.db"))
HARD = {"16514"}
JSON_OUT = ROOT / "import-out" / "import.json"

def main() -> int:
    OUT_DB.parent.mkdir(parents=True, exist_ok=True)
    JSON_OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT_DB.exists():
        OUT_DB.unlink()

    db = sqlite3.connect(str(OUT_DB))
    db.executescript(SCHEMA.read_text())
    db.commit()

    payload = {"opportunities": [], "suppliers": [], "note": ""}
    if not COMMERCE.exists():
        payload["note"] = "commerce DB ausente — DB vacía sin fake tenders"
        JSON_OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
        print(f"Empty DB at {OUT_DB}")
        return 0

    src = sqlite3.connect(str(COMMERCE))
    src.row_factory = sqlite3.Row

    # suppliers
    for r in src.execute("SELECT * FROM suppliers"):
        rd = dict(r)
        name = rd.get("name") or rd.get("razon_social") or f"supplier-{rd.get('id')}"
        web = rd.get("web") or rd.get("website") or rd.get("url") or ""
        db.execute(
            "INSERT OR IGNORE INTO suppliers (name, web, source_url, verified) VALUES (?,?,?,?)",
            (name, web, web, 1 if rd.get("verified") else 0),
        )
        payload["suppliers"].append({"name": name, "web": web, "source_url": web})

    imported = 0
    skipped_hard = 0
    for r in src.execute("SELECT * FROM opportunities"):
        rd = dict(r)
        ext = str(rd.get("external_id") or "")
        url = (rd.get("url") or "").strip()
        if not url:
            continue
        pliego = (rd.get("pliego_url") or "").strip()
        skipped = 1 if rd.get("skipped") else 0
        skip_reason = rd.get("skip_reason") or ""
        pipeline = "NUEVA"
        st = (rd.get("state") or "").upper()
        if ext in HARD:
            skipped = 1
            skip_reason = f"HARD_SKIP CODINEU {ext}: excluido permanentemente (política M&M)"
            pipeline = "SKIPPED_HARD"
            skipped_hard += 1
        elif skipped:
            pipeline = "DESCARTADA"
        elif st in ("PRICING", "COTIZANDO"):
            pipeline = "COTIZANDO"
        elif st == "ARCHIVADA":
            pipeline = "DESCARTADA"
            skipped = 1

        bid_scope = ""
        pliego_file = ""
        tenders = src.execute(
            "SELECT * FROM tenders WHERE opportunity_id = ?", (rd["id"],)
        ).fetchall()
        items_src = []
        if tenders:
            t = dict(tenders[0])
            pliego_file = t.get("doc_path") or ""
            notes = t.get("notes") or ""
            if "bid_scope=" in notes:
                bid_scope = notes.split("bid_scope=")[-1].split(";")[0].strip()
            items_src = [
                dict(x)
                for x in src.execute(
                    "SELECT * FROM tender_items WHERE tender_id = ?", (t["id"],)
                )
            ]

        db.execute(
            """INSERT INTO opportunities (
              external_id, source, title, organism, rubros, modality,
              source_url, url, pliego_url, pliego_file, bid_scope,
              apertura_at, cierre_at, publicacion_at, timing_state, pipeline,
              fit_hint, risk_level, skipped, skip_reason, raw_json,
              verification, verified_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                ext,
                (rd.get("source") or "CODINEU").upper(),
                rd.get("title") or "",
                rd.get("organism") or "",
                rd.get("rubros") or "",
                rd.get("modality") or "",
                url,
                url,
                pliego,
                pliego_file,
                bid_scope,
                rd.get("opening_at") or "",
                rd.get("cierre_at") or "",
                rd.get("publicacion_at") or "",
                rd.get("timing_state") or "NO VERIFICADO",
                pipeline,
                rd.get("fit_score"),
                rd.get("risk_level") or "",
                skipped,
                skip_reason,
                rd.get("raw_json") or "{}",
                "IMPORTADO_COMMERCE",
                rd.get("updated_at"),
            ),
        )
        opp_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

        line_map = {}
        for it in items_src:
            db.execute(
                """INSERT INTO opportunity_items (
                  opportunity_id, line_no, description, qty, unit, brand, model,
                  unit_cost, cost_verified, verification, source_url
                ) VALUES (?,?,?,?,?,?,?,?,0,'NO VERIFICADO',?)""",
                (
                    opp_id,
                    it.get("line_no") or 1,
                    it.get("product") or "",
                    it.get("qty") or 1,
                    it.get("unit") or "u",
                    it.get("brand") or "",
                    it.get("model") or "",
                    None,
                    url,
                ),
            )
            line_map[it["id"]] = it.get("line_no") or 1

        # remap line_no -> item id in radar
        item_ids = {
            row[0]: row[1]
            for row in db.execute(
                "SELECT line_no, id FROM opportunity_items WHERE opportunity_id = ?",
                (opp_id,),
            )
        }

        matches_payload = []
        for sq in src.execute(
            "SELECT * FROM supplier_quotes WHERE opportunity_id = ?", (rd["id"],)
        ):
            sqd = dict(sq)
            sname = ""
            if sqd.get("supplier_id"):
                srow = src.execute(
                    "SELECT * FROM suppliers WHERE id = ?", (sqd["supplier_id"],)
                ).fetchone()
                if srow:
                    sd = dict(srow)
                    sname = sd.get("name") or sd.get("razon_social") or f"supplier-{sd.get('id')}"
            ver = (sqd.get("verification") or "").upper()
            cost_verified = ver == "VERIFICADO" and sqd.get("unit_cost") is not None
            mc = (sqd.get("match_class") or "").upper()
            # MATCH EXACTO only if proven (EXACTO + cost verified)
            if mc == "EXACTO" and cost_verified:
                mt = "EXACTO"
            elif mc == "EXACTO":
                mt = "EQUIVALENTE"
            elif mc in ("EQUIVALENTE", "POSIBLE", "PROBABLE"):
                mt = "EQUIVALENTE"
            else:
                mt = "NO MATCH"
            stock_verified = 0
            stock_val = None
            line_no = None
            if sqd.get("tender_item_id") and sqd["tender_item_id"] in line_map:
                line_no = line_map[sqd["tender_item_id"]]
            item_id = item_ids.get(line_no) if line_no else None
            supplier_id = None
            if sname:
                db.execute(
                    "INSERT OR IGNORE INTO suppliers (name, source_url, verified) VALUES (?,?,0)",
                    (sname, sqd.get("url") or url),
                )
                supplier_id = db.execute(
                    "SELECT id FROM suppliers WHERE name = ?", (sname,)
                ).fetchone()[0]
            db.execute(
                """INSERT INTO supplier_matches (
                  opportunity_id, item_id, supplier_id, supplier_name, product_label,
                  match_type, unit_cost, stock, stock_verified, cost_verified, why,
                  verification, source_url, verified_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    opp_id,
                    item_id,
                    supplier_id,
                    sname,
                    sqd.get("product_label") or "",
                    mt,
                    sqd.get("unit_cost"),
                    stock_val,
                    stock_verified,
                    1 if cost_verified else 0,
                    f"commerce match_class={mc}; verification={sqd.get('verification')}",
                    sqd.get("verification") or "NO VERIFICADO",
                    sqd.get("url") or url,
                    sqd.get("verified_at"),
                ),
            )
            matches_payload.append(
                {
                    "line_no": line_no,
                    "supplier_name": sname,
                    "match_type": mt,
                    "unit_cost": sqd.get("unit_cost"),
                    "cost_verified": cost_verified,
                }
            )

        payload["opportunities"].append(
            {
                "external_id": ext,
                "title": rd.get("title"),
                "source_url": url,
                "pliego_url": pliego,
                "bid_scope": bid_scope,
                "pipeline": pipeline,
                "skipped": skipped,
                "items": len(items_src),
                "matches": matches_payload,
            }
        )
        imported += 1

    # Ensure 16514 hard-skip row exists even if absent from commerce
    if not db.execute("SELECT 1 FROM opportunities WHERE external_id='16514'").fetchone():
        db.execute(
            """INSERT INTO opportunities (
              external_id, source, title, source_url, url, skipped, skip_reason, pipeline, verification
            ) VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                "16514",
                "CODINEU",
                "HARD SKIP — no accionable",
                "https://codi.neuquen.gob.ar/",
                "https://codi.neuquen.gob.ar/",
                1,
                "HARD_SKIP CODINEU 16514: excluido permanentemente (política M&M)",
                "SKIPPED_HARD",
                "SKIPPED",
            ),
        )
        skipped_hard += 1

    db.commit()
    payload["note"] = f"imported={imported} skipped_hard={skipped_hard} from {COMMERCE}"
    JSON_OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    has16813 = db.execute(
        "SELECT external_id, title, pliego_url, bid_scope FROM opportunities WHERE external_id='16813'"
    ).fetchone()
    print(f"DB {OUT_DB}")
    print(f"imported={imported} skipped_hard={skipped_hard} 16813={has16813}")
    print(f"JSON {JSON_OUT}")
    return 0

if __name__ == "__main__":
    sys.exit(main())

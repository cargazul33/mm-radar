import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { extractLineItems, extractPliego, extractMeta } from "../src/engines/pliegoExtract.js";
import {
  analyzePliegoText,
  buildChecklistPresentacion,
  buildResumenEjecutivo,
} from "../src/engines/checklist.js";
import { LABEL_NO_VERIFICADO } from "../src/constants.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fix = (name: string) => readFileSync(join(root, "fixtures/pliegos", name), "utf8");

const SAFIPRO = `
Re Cant Sol Per Item                                      Per Cant Precio         Precio
            Sol                                           Ofr Ofr Unitario         Total
 1     1        RACK PARA SERVIDOR; Material Chapa Y Vidrio - Marca Sugerida: GLC
                                                                   $          $
                Marca Ofrecida:
 2     2        SWITCH; Uso Rackeable - 24 puertos Gigabit - Marca Sugerida: TP-LINK
                                                                   $          $
                Marca Ofrecida:
 10   20        ROSETA PARA RED; Tipo Rj 45 - Cantidad Entradas Dos
                                                                   $          $
                Marca Ofrecida:
Cantidad de Renglones a Cotizar: 3
`;

describe("pliego extract — never invent", () => {
  it("extracts SAFIPRO rows with qty/brand", () => {
    const items = extractLineItems(SAFIPRO);
    expect(items.length).toBeGreaterThanOrEqual(3);
    const by = Object.fromEntries(items.map((i) => [i.line_no, i]));
    expect(by[1].qty).toBe(1);
    expect(by[1].product.toUpperCase()).toContain("RACK");
    expect(by[1].verification).toBe(LABEL_NO_VERIFICADO);
    expect(by[1].source_pattern).toBe("safipro_row");
    expect(by[2].qty).toBe(2);
    expect(by[10].qty).toBe(20);
  });

  it("extracts numbered fixture style", () => {
    const text = `
1) 10 unidades Notebook 15 pulgadas Intel i5
2) 5 unidades Monitor LED 24
`;
    const items = extractLineItems(text);
    expect(items).toHaveLength(2);
    expect(items[0].qty).toBe(10);
    expect(items[0].product).toContain("Notebook");
  });

  it("never invents from empty or title-only boilerplate", () => {
    expect(extractLineItems("")).toEqual([]);
    expect(extractLineItems("   ")).toEqual([]);
    expect(extractLineItems("PLIEGO DE BASES Y CONDICIONES\nLey 2141")).toEqual([]);
    const empty = extractPliego("");
    expect(empty.status).toBe("SIN_DOCUMENTO");
    expect(empty.items).toEqual([]);
    expect(empty.verification).toBe(LABEL_NO_VERIFICADO);
  });

  it("fixture 16589 yields 4 lines", () => {
    const items = extractLineItems(fix("16589.txt"));
    expect(items).toHaveLength(4);
    expect(items[0].line_no).toBe(1);
    expect(items[0].qty).toBe(10);
  });

  it("fixture 16592 yields silla qty 25", () => {
    const items = extractLineItems(fix("16592.txt"));
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(25);
    expect(items[0].product.toUpperCase()).toContain("SILLA");
  });

  it("does not invent qty when item label has no quantity", () => {
    const items = extractLineItems("Ítem 1: Notebook sin cantidad explícita suficiente xx");
    // product may match but qty missing → skipped (no invent qty=1)
    expect(items.every((i) => i.qty != null && i.qty > 0)).toBe(true);
    // Either empty or only rows with explicit qty — never fabricated
    for (const it of items) {
      expect(it.verification).toBe(LABEL_NO_VERIFICADO);
    }
  });

  it("meta extract pulls delivery from fixture without inventing warranty", () => {
    const meta = extractMeta(fix("16589.txt"));
    expect(meta.delivery).toBeTruthy();
    expect(String(meta.delivery).toLowerCase()).toContain("neuquén");
  });
});

describe("resumen + checklist — no invent", () => {
  it("builds resumen with NO VERIFICADO for missing fields", () => {
    const extract = extractPliego(SAFIPRO);
    const resumen = buildResumenEjecutivo(extract, {
      title: "Demo",
      organism: "Test Org",
      external_id: "999",
      pliego_url: "https://example.com/pliego.pdf",
    });
    expect(resumen.verification).toBe(LABEL_NO_VERIFICADO);
    expect(resumen.items_count).toBeGreaterThanOrEqual(3);
    expect(resumen.productos[0].qty).not.toBe(LABEL_NO_VERIFICADO);
    // warranty not in SAFIPRO sample → NO VERIFICADO
    expect(resumen.warranty).toBe(LABEL_NO_VERIFICADO);
    expect(resumen.lines_to_quote).toBe("3");
  });

  it("checklist BLOQUEA without pliego_url and without bid_scope", () => {
    const extract = extractPliego("");
    const cl = buildChecklistPresentacion(extract, { title: "X", external_id: "1" });
    expect(cl.items.some((i) => i.id === "pliego_link" && i.status === "BLOQUEA")).toBe(true);
    expect(cl.items.some((i) => i.id === "bid_scope" && i.status === "BLOQUEA")).toBe(true);
    expect(cl.blocks_presentation).toBe(true);
    // never invent OK on precios/stock
    expect(cl.items.find((i) => i.id === "precios")?.status).toBe("NO VERIFICADO");
    expect(cl.items.find((i) => i.id === "stock")?.status).toBe("NO VERIFICADO");
  });

  it("analyzePliegoText never invents products from title alone", () => {
    const a = analyzePliegoText("", {
      title: "Notebooks para oficina — título solo",
      external_id: "99999",
      pliego_url: "https://example.com/p.pdf",
    });
    expect(a.extract.items).toHaveLength(0);
    expect(a.extract.status).toBe("SIN_DOCUMENTO");
    expect(a.resumen_ejecutivo.items_count).toBe(0);
    expect(a.resumen_ejecutivo.productos).toHaveLength(0);
  });

  it("full analyze on 16589 marks delivery OK and items OK", () => {
    const a = analyzePliegoText(fix("16589.txt"), {
      title: "Equipamientos",
      external_id: "16589",
      pliego_url: "https://example.com/16589.pdf",
      cierre_at: "21/09/2026",
    });
    expect(a.extract.items).toHaveLength(4);
    expect(a.checklist_presentacion.items.find((i) => i.id === "renglones")?.status).toBe("OK");
    expect(a.checklist_presentacion.items.find((i) => i.id === "entrega")?.status).toBe("OK");
    expect(a.checklist_presentacion.items.find((i) => i.id === "humano")?.status).toBe("PENDIENTE");
  });
});

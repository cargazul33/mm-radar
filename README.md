# M&M RADAR

Sistema operativo diario para **M&M Insumos (Neuquén)**: oportunidades → cotizar → comprar → entregar → facturar → cobrar → reinvertir.

Metas aspiracionales (**solo display**): ~$30–40M ARS ventas / ~$10M neto por mes. **No se afirma que estén logradas**; el progreso en HOY solo avanza con datos reales cargados.

Stack: **Cloudflare Pages + Workers + D1** (SQLite local / sql.js para desarrollo). UI mobile-first en español, vanilla (sin CRM pesado). Markup default **PRECIO = COSTO_TOTAL × 1.90** (configurable). Hard-skip permanente **CODINEU 16514**. Sin auto-buy / auto-bid / movimiento de dinero automático.

## Relación con mm-ai-commerce

| Repo | Rol |
|---|---|
| **mm-ai-commerce** | Motor de captura/análisis (CODINEU, pliegos, proveedores, matching). Fuente de verdades externas. |
| **mm-radar** (este) | UI operativa + pipeline + caja + cobranzas + “qué hago hoy”. Consume exports / SQLite de commerce; **no inventa** oportunidades ni precios. |

Import recomendado:

```bash
npm run seed:commerce   # lee /workspace/mm-ai-commerce/data/mm_commerce.db si existe
# o POST /api/import con JSON exportado
```

Si no hay DB de commerce → arranca **vacío** (sin fake tenders). El fixture `fixtures/sample-import.json` está marcado **DEMO** y no se usa en el path de producción.

## Reglas de verdad

- Nunca inventar oportunidades, proveedores, precios ni stock.
- Labels: `STOCK_NO_VERIFICADO`, `PRECIO_NO_VERIFICADO`, `COBRO_ESTIMADO`.
- `MATCH EXACTO` solo si brand/model/spec coinciden y está probado.
- Toda fila externa: `source_url` + `verified_at` cuando aplica.
- Cotizaciones **nunca** cuentan como caja.
- Compra / oferta / dinero: **aprobación humana** (nunca auto).

Fórmula:

`CAPITAL OPERATIVO REAL = caja + CxC firmes − deudas − impuestos − compromisos`

## Pantallas MVP

1. **HOY** — capital operativo real, caja, por cobrar, comprometido, libre, metas, tareas, cuello de botella, alertas.
2. **Oportunidades** — URL oficial (fuente) + **DESCARGAR PLIEGO** (botón real solo si `pliego_url`/`pliego_file`). Detalle: **RESUMEN EJECUTIVO** + **CHECKLIST DE PRESENTACIÓN** desde extract determinístico del pliego (nunca inventa; campos faltantes = `NO VERIFICADO`).
3. **Cotizaciones** — borradores; nunca = caja.
4. **Caja** — ledger + fórmula.
5. **Cobranzas** — estados + FIRMES vs COBRO_ESTIMADO.
6. **Indicadores** — KPIs reales (ceros si vacío).
7. **Proyecciones** — etiquetadas **ESTIMACIÓN**.

## Score M&M (0–100)

| Componente | Max |
|---|---|
| Encaje | 20 |
| Margen | 20 |
| Abastecimiento | 15 |
| Capital | 10 |
| Cobro | 15 |
| Probabilidad | 10 |
| Historial | 10 |

Bandas: **ATACAR / COTIZAR / REVISAR / DESCARTAR**.

Prioridad rubros: IT, redes, librería, oficina, electrodomésticos, electrónica, herramientas livianas, AA. Baja prioridad: salud, policía, construcción pesada, obras.

## Schema D1

Tablas: `opportunities`, `opportunity_items`, `suppliers`, `supplier_matches` (+ vista `supplier_quotes`), `quotes`, `purchases`, `deliveries`, `invoices`, `collections` (receivables), `cash_ledger`, `alerts`, `config`/`settings`, `backups`, `ventas_mes`, `capital_snapshot`. Vistas: `operations`, `receivables`, `cotizaciones`, `cobranzas`, etc.

## Correr en local

```bash
cd /workspace/mm-radar   # o el clone
npm install
npm run seed:commerce    # importa mm-ai-commerce si existe; si no, DB vacía (sin fake)
npm test
npm run dev              # http://127.0.0.1:8787
```

Variables útiles:

- `MM_RADAR_DB` — ruta SQLite local (default `data/local.sqlite`)
- `COMMERCE_DB` — SQLite de mm-ai-commerce (default `/workspace/mm-ai-commerce/data/mm_commerce.db`)
- `PORT` — default `8787`

API clave: `/api/hoy`, `/api/que-hago-hoy`, `/api/oportunidades`, `/api/oportunidades/:id/extract` (POST `pliego_text`), `/api/pliego/extract`, `/api/cotizaciones`, `/api/caja`, `/api/cobranzas`, `/api/indicadores`, `/api/proyecciones`, `/api/bottleneck`, `/api/alertas`, `/api/import`, `/api/refresh`, `/api/policy`, `/api/backup`.

## Deploy gratis (Cloudflare)

1. `npx wrangler login` (**requiere a Mariano** — cuenta Cloudflare free).
2. Crear D1 `mm-radar-db` y pegar el `database_id` real en `wrangler.toml` (hoy hay placeholder).
3. Migración:

```bash
npx wrangler d1 execute mm-radar-db --file=migrations/0001_init.sql
```

4. Deploy:

```bash
npx wrangler deploy
# o Pages: npx wrangler pages deploy public --project-name=mm-radar
```

5. (Opcional) importar JSON real:

```bash
curl -X POST https://<tu-dominio>/api/import -H 'content-type: application/json' --data @import-out/import.json
```

Secretos: solo en env / Cloudflare dashboard (no commitear `.dev.vars` ni `.env`).

## Qué necesita Mariano

1. **`wrangler login`** + cuenta Cloudflare free.
2. Crear D1 `mm-radar-db` y actualizar `database_id` en `wrangler.toml`.
3. **Deploy** (`wrangler deploy` / conectar Pages al repo `cargazul33/mm-radar`).
4. Cargar **caja / cobranzas / ventas reales** (la app no inventa capital).
5. **Aprobar** compra/oferta/pago — la app nunca lo hace sola.

## Tests

```bash
npm test
```

Cubre: score, fórmula de capital, guards anti-invención, hard-skip 16514, match exacto, rentabilidad, extract de pliego + checklist (sin inventar).

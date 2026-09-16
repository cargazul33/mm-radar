# M&M RADAR

Sistema diario de operaciones para **M&M Insumos Neuquén**: qué cotizar, qué vence, dónde comprar, stock verificado?, capital, precio de venta, márgenes, días de capital, mejor ROI, cobranzas, capital libre, acciones de hoy y siguiente mejor acción.

**Stack (gratis):** Cloudflare Workers + Assets (Pages) + D1 · TypeScript · UI mobile-first en español.

**Repo:** https://github.com/cargazul33/mm-radar

## Reglas de negocio (no negociables)

- **Nunca inventar** oportunidades, precios, stock ni proveedores.
- Todo hecho necesita `source_url` + `verified_at` cuando aplica.
- Si falta evidencia → `NO VERIFICADO` / `STOCK_NO_VERIFICADO` / `PRECIO_NO_VERIFICADO`.
- **MATCH EXACTO** solo si coinciden marca/modelo/especificación.
- Compra / presentación / pago: **siempre aprobación humana** (nunca auto).
- Precio default = **COSTO × 1.90** (configurable en `config` / `wrangler.toml`).
- **Excluir CODINEU 16514** (hard-skip permanente).
- Depriorizar: salud / policía / obra pesada.
- Priorizar: IT / redes / oficina / librería / electro / herramientas / AA.
- Metas display: ventas **$40M** / ganancia **$10M** ARS/mes (barras solo desde ledger real; ceros si vacío).
- **Capital operativo real** = caja + CxC firmes − deudas − impuestos − compromisos compra.  
  **Nunca** contar cotizaciones/oportunidades como dinero.

## Pipeline

`DETECTADA` → `ANALISIS` → `BUSCANDO_PROVEEDOR` → `COTIZANDO` → `LISTA_PARA_PRESENTAR` → `PRESENTADA` → `OPS_GANADA` → `COMPRANDO` → `ENTREGANDO` → `FACTURANDO` → `COBRANDO` → `COBRADA` / `DESCARTADA` / `PERDIDA` / `SKIPPED_HARD`

## Módulos UI

| Vista | Contenido |
|-------|-----------|
| HOY | Capital operativo, caja, por cobrar, urgentes, % meta |
| Qué hago hoy | Tareas rankeadas (urgente / alta / oportunidades) |
| Oportunidades | Lista + **DESCARGAR PLIEGO** + Score M&M 0–100 explicado |
| Proveedores | Alta + match EXACTO / EQUIVALENTE / NO MATCH |
| Rentabilidad | Ranking por eficiencia de capital |
| Caja / Capital / Cobranzas / Alertas | Ledger y alertas &lt;72h / &lt;24h |
| Indicadores | Solo datos reales de DB |
| Proyecciones | Escenarios etiquetados **ESTIMACIÓN** |

## Score M&M (0–100)

Encaje 0–20 · margen 0–20 · abastecimiento 0–15 · capital 0–10 · cobro 0–15 · probabilidad 0–10 · historial 0–10.

Bandas: **ATACAR** 75–100 · **COTIZAR** 55–74 · **REVISAR** 35–54 · **DESCARTAR** 0–34.

## Arranque local (sin cuenta Cloudflare)

```bash
cd mm-radar
npm install
npm test
npm run export:commerce   # si existe /workspace/mm-ai-commerce
npm run dev
# → http://127.0.0.1:8787
```

Importar datos reales:

```bash
curl -s -X POST http://127.0.0.1:8787/api/import \
  -H 'content-type: application/json' \
  --data-binary @import-out/opportunities-export.json
```

DB local: `data/local.sqlite` (sql.js, mismo schema que D1).

## Deploy Cloudflare (Mariano debe hacer login)

1. Login Wrangler (una vez, en tu máquina / cuenta Cloudflare):

```bash
npx wrangler login
```

2. Crear D1 y pegar el `database_id` en `wrangler.toml`:

```bash
npx wrangler d1 create mm-radar-db
# editar wrangler.toml → [[d1_databases]].database_id
npx wrangler d1 execute mm-radar-db --remote --file=migrations/0001_init.sql
```

3. Variables (ya en `wrangler.toml` `[vars]`):

- `MARKUP_DEFAULT=1.90`
- `META_VENTAS_MENSUAL=40000000`
- `META_GANANCIA_MENSUAL=10000000`
- `HARD_SKIP_CODINEU=16514`

**No subir secretos al git.** Usar `wrangler secret put …` si agregás auth.

4. Deploy:

```bash
npm run deploy
# o: npx wrangler deploy
```

5. Preview local con D1:

```bash
npm run db:migrate:local
npm run dev:cf
```

## Tests

```bash
npm test
```

Cubre: bandas de score, fórmula de capital, hard-skip 16514, reglas de match exacto, política no-inventar.

## Backup

- `GET /api/backup/json`
- `GET /api/backup/csv?table=opportunities`

## Schema D1 (resumen)

`opportunities` (+ `pliego_url`, `source_url`) · `opportunity_items` / `items` · `suppliers` · `quotes` · `operations` (vista) · `purchases` · `deliveries` · `invoices` · `collections` / `receivables` · `cash_ledger` · `alerts` · `config` / `settings` · `capital_snapshot` · `ventas_mes`.

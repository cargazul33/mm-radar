# M&M RADAR

Sistema operativo diario para **M&M Insumos (Neuquén)**: oportunidades → cotizar → comprar → entregar → facturar → cobrar → reinvertir.

Meta aspiracional de referencia: ~$30–40M ARS ventas / ~$10M neto por mes. **No se afirma que esté lograda**; el progreso en HOY solo avanza con datos reales cargados.

Stack: **Cloudflare Pages + Workers + D1** (SQLite local para desarrollo/tests). UI mobile-first en español, vanilla (sin CRM pesado). Markup default **1.90**. Hard-skip permanente **CODINEU 16514**. Sin auto-buy / auto-bid / movimiento de dinero automático.

## Reglas de verdad

- Nunca inventar oportunidades, proveedores, precios ni stock.
- Labels: `STOCK_NO_VERIFICADO`, `PRECIO_NO_VERIFICADO`, `COBRO_ESTIMADO`.
- `MATCH EXACTO` solo si está probado.
- Toda fila externa: `source_url` + `verified_at` cuando aplica.
- Cotizaciones **nunca** cuentan como caja.
- Fórmula documentada:

`CAPITAL OPERATIVO REAL = caja + CxC firmes − deudas − impuestos − compromisos`

## Pantallas MVP

1. **HOY** — capital operativo real, caja, por cobrar, comprometido, libre, metas.
2. **Qué hago hoy** — tareas ordenadas desde el estado real de la DB.
3. **Oportunidades** — URL oficial + **DESCARGAR PLIEGO**.
4. **Detalle** — ítems, score M&M 0–100 con porqués, pipeline, proveedores, rentabilidad, `bid_scope`.
5. **Caja** — panel + fórmula.
6. **Cobranzas** — listado y estados.
7. **Alertas**.
8. **Proyecciones** — etiquetadas **ESTIMACIÓN** (conservador / base / agresivo).
9. **Cuello de botella** — texto.

## Score M&M

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

API clave: `/api/hoy`, `/api/que-hago-hoy`, `/api/oportunidades`, `/api/caja`, `/api/cobranzas`, `/api/alertas`, `/api/proyecciones`, `/api/bottleneck`, `/api/import`, `/api/refresh`, `/api/policy`.

## Deploy gratis (Cloudflare)

1. Crear proyecto Pages/Workers con este repo.
2. Crear D1 `mm-radar-db` y pegar el `database_id` en `wrangler.toml`.
3. Aplicar migración:

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

## Acciones que requieren a Mariano

Únicas intervenciones humanas necesarias:

1. **Login Cloudflare** (cuenta free) y vincular el proyecto a `cargazul33/mm-radar`.
2. **Crear D1** `mm-radar-db` y actualizar `database_id` en `wrangler.toml`.
3. **Deploy** (`wrangler login` + `wrangler deploy` / Pages connect).
4. **Secrets/vars** en el dashboard si más adelante hay tokens de portales (hoy no hay secrets obligatorios).
5. **Cargar caja / cobranzas / ventas reales** (la app no inventa números de capital).
6. **Decisiones de compra/oferta** — la app nunca compra ni puja sola.

Todo lo demás (código, schema, UI, tests, seed desde commerce, push a GitHub) lo hace el agente en este box.

## Tests

```bash
npm test
```

Cubre: score, fórmula de caja, guards anti-invención, hard-skip 16514, match exacto, rentabilidad.

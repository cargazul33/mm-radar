# MARIANO ONE

Dashboard operativo verificable para M&M Insumos.

- No incluye oportunidades, proveedores, precios ni stock ficticios.
- `scripts/scan_public.py` lee fuentes públicas oficiales de Neuquén y actualiza `data/opportunities.json`.
- La UI guarda caja/proveedores/costos en `localStorage` del navegador y permite backup/importación JSON.
- Ninguna compra u oferta se ejecuta automáticamente.

-- M&M RADAR schema (D1 / SQLite)
-- Nunca inventar oportunidades, precios, stock ni proveedores.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO config (key, value) VALUES
  ('markup_default', '1.90'),
  ('meta_ventas_mensual', '40000000'),
  ('meta_ganancia_mensual', '10000000'),
  ('hard_skip_codineu', '16514'),
  ('auto_buy', '0');

-- Alias settings = config (compat)
CREATE VIEW IF NOT EXISTS settings AS SELECT key, value FROM config;

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'CODINEU',
  title TEXT NOT NULL DEFAULT '',
  organism TEXT NOT NULL DEFAULT '',
  rubros TEXT NOT NULL DEFAULT '',
  modality TEXT NOT NULL DEFAULT '',
  numero TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  pliego_url TEXT NOT NULL DEFAULT '',
  pliego_file TEXT NOT NULL DEFAULT '',
  bid_scope TEXT NOT NULL DEFAULT '',
  apertura_at TEXT NOT NULL DEFAULT '',
  cierre_at TEXT NOT NULL DEFAULT '',
  publicacion_at TEXT NOT NULL DEFAULT '',
  timing_state TEXT NOT NULL DEFAULT 'NO VERIFICADO',
  pipeline TEXT NOT NULL DEFAULT 'NUEVA',
  fit_hint INTEGER,
  mm_score INTEGER,
  mm_score_json TEXT NOT NULL DEFAULT '{}',
  risk_level TEXT NOT NULL DEFAULT '',
  cost_total REAL,
  precio_objetivo REAL,
  utilidad_estimada REAL,
  capital_requerido REAL,
  margin_ratio REAL,
  verification TEXT NOT NULL DEFAULT 'NO VERIFICADO',
  match_type TEXT NOT NULL DEFAULT '',
  stock_verified INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  skip_reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_opp_pipeline ON opportunities(pipeline);
CREATE INDEX IF NOT EXISTS idx_opp_score ON opportunities(mm_score);
CREATE INDEX IF NOT EXISTS idx_opp_cierre ON opportunities(cierre_at);
CREATE INDEX IF NOT EXISTS idx_opp_skip ON opportunities(skipped);

CREATE TABLE IF NOT EXISTS opportunity_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'u',
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  unit_cost REAL,
  cost_verified INTEGER NOT NULL DEFAULT 0,
  verification TEXT NOT NULL DEFAULT 'NO VERIFICADO',
  source_url TEXT NOT NULL DEFAULT '',
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  razon_social TEXT NOT NULL DEFAULT '',
  web TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  telefono TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplier_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES opportunity_items(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL DEFAULT '',
  product_label TEXT NOT NULL DEFAULT '',
  match_type TEXT NOT NULL DEFAULT 'NO MATCH',
  unit_cost REAL,
  currency TEXT NOT NULL DEFAULT 'ARS',
  stock REAL,
  stock_verified INTEGER NOT NULL DEFAULT 0,
  cost_verified INTEGER NOT NULL DEFAULT 0,
  why TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT 'NO VERIFICADO',
  source_url TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  markup REAL NOT NULL DEFAULT 1.9,
  cost_products REAL,
  cost_shipping REAL,
  cost_other REAL,
  cost_total REAL,
  sell_price REAL,
  gross REAL,
  net_estimated REAL,
  capital REAL,
  days_locked REAL,
  roi REAL,
  capital_efficiency REAL,
  status TEXT NOT NULL DEFAULT 'BORRADOR',
  notes TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT 'NO VERIFICADO',
  source_url TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  amount REAL,
  status TEXT NOT NULL DEFAULT 'PENDIENTE',
  committed_at TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT 'NO VERIFICADO',
  source_url TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  destino TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT NOT NULL DEFAULT '',
  delivered_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDIENTE',
  notes TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  numero TEXT NOT NULL DEFAULT '',
  amount REAL,
  issued_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDIENTE',
  notes TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  amount REAL,
  due_at TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'PENDIENTE',
  firmes INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT 'COBRO_ESTIMADO',
  source_url TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cash_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  amount REAL NOT NULL,
  concept TEXT NOT NULL DEFAULT '',
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER,
  moved_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS capital_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caja REAL NOT NULL DEFAULT 0,
  cxc_firmes REAL NOT NULL DEFAULT 0,
  deudas REAL NOT NULL DEFAULT 0,
  impuestos REAL NOT NULL DEFAULT 0,
  compromisos REAL NOT NULL DEFAULT 0,
  compromisos_compra REAL NOT NULL DEFAULT 0,
  capital_operativo_real REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL DEFAULT 'info',
  kind TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id TEXT NOT NULL DEFAULT '',
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ventas_mes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year_month TEXT NOT NULL UNIQUE,
  ventas REAL NOT NULL DEFAULT 0,
  ganancia REAL NOT NULL DEFAULT 0,
  source_url TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Compat views (nombres ES)
CREATE VIEW IF NOT EXISTS cotizaciones AS SELECT * FROM quotes;
CREATE VIEW IF NOT EXISTS compras AS SELECT * FROM purchases;
CREATE VIEW IF NOT EXISTS entregas AS SELECT * FROM deliveries;
CREATE VIEW IF NOT EXISTS facturas AS SELECT * FROM invoices;
CREATE VIEW IF NOT EXISTS cobranzas AS SELECT * FROM collections;
CREATE VIEW IF NOT EXISTS caja_movimientos AS SELECT * FROM cash_ledger;
CREATE VIEW IF NOT EXISTS alertas AS SELECT * FROM alerts;


-- Alias nombres producto
CREATE VIEW IF NOT EXISTS items AS SELECT * FROM opportunity_items;
CREATE VIEW IF NOT EXISTS operations AS SELECT * FROM opportunities WHERE pipeline IN ('OPS_GANADA','COMPRANDO','ENTREGANDO','FACTURANDO','COBRANDO','COBRADA','COBRADO');
CREATE VIEW IF NOT EXISTS receivables AS SELECT * FROM collections;
CREATE VIEW IF NOT EXISTS receivables_es AS SELECT * FROM cobranzas;


-- Tablas / vistas de producto (nombres canónicos del MVP)
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'manual',
  label TEXT NOT NULL DEFAULT '',
  path_or_url TEXT NOT NULL DEFAULT '',
  row_counts_json TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- supplier_quotes: alias canónico de supplier_matches (mismo contenido)
CREATE VIEW IF NOT EXISTS supplier_quotes AS SELECT * FROM supplier_matches;

-- settings ya es VIEW sobre config; operations / receivables ya definidos arriba

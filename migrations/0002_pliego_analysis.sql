-- Pliego analysis JSON + item specs (idempotent via app ensureSchema)
ALTER TABLE opportunities ADD COLUMN pliego_analysis_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE opportunity_items ADD COLUMN specs TEXT NOT NULL DEFAULT '';
ALTER TABLE opportunity_items ADD COLUMN mandatory_reqs TEXT NOT NULL DEFAULT '';

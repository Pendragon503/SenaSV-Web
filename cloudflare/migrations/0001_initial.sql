CREATE TABLE IF NOT EXISTS contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL UNIQUE,
  participant_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  features_json TEXT NOT NULL,
  feature_count INTEGER NOT NULL CHECK(feature_count = 126),
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consent_version TEXT NOT NULL,
  app_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contributions_label
  ON contributions(label);

CREATE INDEX IF NOT EXISTS idx_contributions_participant
  ON contributions(participant_hash);

CREATE INDEX IF NOT EXISTS idx_contributions_received_at
  ON contributions(received_at);

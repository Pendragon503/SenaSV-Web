import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(databasePathInput) {
  const databasePath = resolve(databasePathInput);
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_hash TEXT NOT NULL,
      label TEXT NOT NULL,
      features_json TEXT NOT NULL,
      feature_count INTEGER NOT NULL CHECK(feature_count = 126),
      captured_at TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      consent_version TEXT NOT NULL,
      app_version TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_contributions_label ON contributions(label);
    CREATE INDEX IF NOT EXISTS idx_contributions_participant ON contributions(participant_hash);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS user_progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('in-progress','completed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      best_accuracy REAL,
      last_attempt_at TEXT,
      completed_at TEXT,
      PRIMARY KEY (user_id, lesson_id)
    );
    CREATE INDEX IF NOT EXISTS idx_progress_user ON user_progress(user_id);
  `);

  const statements = {
    insertContribution: database.prepare(`
      INSERT INTO contributions
        (participant_hash, label, features_json, feature_count, captured_at, consent_version, app_version)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),

    insertUser: database.prepare(`
      INSERT INTO users (email, password_hash) VALUES (?, ?)
    `),
    findUserByEmail: database.prepare(`
      SELECT id, email, password_hash, created_at FROM users WHERE email = ?
    `),
    findUserById: database.prepare(`
      SELECT id, email, created_at FROM users WHERE id = ?
    `),

    insertSession: database.prepare(`
      INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)
    `),
    findSession: database.prepare(`
      SELECT s.token_hash, s.user_id, s.expires_at, u.id AS user_id, u.email, u.created_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `),
    deleteSession: database.prepare(`DELETE FROM sessions WHERE token_hash = ?`),
    deleteExpiredSessions: database.prepare(`DELETE FROM sessions WHERE expires_at <= ?`),

    getProgressForUser: database.prepare(`
      SELECT lesson_id, status, attempts, best_accuracy, last_attempt_at, completed_at
      FROM user_progress WHERE user_id = ?
    `),
    getProgressRow: database.prepare(`
      SELECT lesson_id, status, attempts, best_accuracy, last_attempt_at, completed_at
      FROM user_progress WHERE user_id = ? AND lesson_id = ?
    `),
    upsertProgress: database.prepare(`
      INSERT INTO user_progress (user_id, lesson_id, status, attempts, best_accuracy, last_attempt_at, completed_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(user_id, lesson_id) DO UPDATE SET
        status = excluded.status,
        attempts = user_progress.attempts + 1,
        best_accuracy = MAX(COALESCE(user_progress.best_accuracy, 0), excluded.best_accuracy),
        last_attempt_at = excluded.last_attempt_at,
        completed_at = COALESCE(user_progress.completed_at, excluded.completed_at)
    `),
  };

  return { database, statements };
}

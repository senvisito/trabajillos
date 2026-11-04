// Base de datos SQLite: un solo fichero en DATA_DIR, fácil de copiar como copia de seguridad.
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'trabajillos.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pass TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('cliente','profesional')),
  barrio TEXT,
  phone TEXT,
  bio TEXT,
  skills TEXT DEFAULT '',          -- categorías separadas por coma
  remote INTEGER DEFAULT 0,        -- trabaja en remoto
  is_admin INTEGER DEFAULT 0,
  hidden INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  barrio TEXT NOT NULL,
  modality TEXT DEFAULT 'presencial', -- presencial | remoto | ambos
  urgency TEXT DEFAULT 'normal',      -- urgente | normal | sin prisa
  budget_min INTEGER, budget_max INTEGER,
  status TEXT DEFAULT 'abierto' CHECK (status IN ('abierto','asignado','terminado','cerrado')),
  assigned_to INTEGER REFERENCES users(id),
  hidden INTEGER DEFAULT 0,
  alerted INTEGER DEFAULT 0,          -- aviso de "sin respuesta en 24 h" ya enviado
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  pro_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  price INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (job_id, pro_id)
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  from_id INTEGER NOT NULL REFERENCES users(id),
  to_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text TEXT,
  reply TEXT,
  hidden INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (job_id, from_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL, target_id INTEGER NOT NULL,
  reason TEXT NOT NULL, reporter TEXT,
  resolved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  pro_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (job_id, pro_id)
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS reviews_to ON reviews(to_id);
`);

module.exports = db;

// ---------- v0.2: soporte, captación y métricas ----------
db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  pro_id INTEGER NOT NULL REFERENCES users(id),   -- conversación cliente <-> este profesional
  from_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(job_id, pro_id, created_at);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  by_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL,            -- estado | nota
  value TEXT, note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,            -- llamada | empresa
  name TEXT NOT NULL, phone TEXT, email TEXT, company TEXT, barrio TEXT,
  message TEXT NOT NULL, source TEXT,
  status TEXT DEFAULT 'nuevo',   -- nuevo | contactado | cliente | descartado
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pageviews (day TEXT NOT NULL, path TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path));
CREATE TABLE IF NOT EXISTS sources (day TEXT NOT NULL, source TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, source));
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
`);
for (const [t, col] of [['jobs', "ticket TEXT DEFAULT 'pendiente'"], ['jobs', 'nudged INTEGER DEFAULT 0'], ['jobs', 'review_asked INTEGER DEFAULT 0'],
  ['jobs', 'source TEXT'], ['users', 'source TEXT'], ['users', 'reset_token TEXT'], ['users', 'reset_exp INTEGER'], ['users', 'digest INTEGER DEFAULT 1']]) {
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${col}`); } catch {}
}

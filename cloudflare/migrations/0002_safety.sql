
CREATE TABLE IF NOT EXISTS email_checks(user_id TEXT PRIMARY KEY REFERENCES users(id),verified_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),purpose TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER);
CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id,purpose);
CREATE TABLE IF NOT EXISTS owner_sessions(token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash),verified_until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS access_audit(id TEXT PRIMARY KEY,user_id TEXT,action TEXT NOT NULL,created_at INTEGER NOT NULL);

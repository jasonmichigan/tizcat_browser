-- TizCat accounts (D1 database tizcat-accounts). Passwords are never stored:
-- only a verifier made from the page's stretched key (shared/password.js).

CREATE TABLE users (
  id TEXT PRIMARY KEY,                -- "u_" + random
  email TEXT NOT NULL UNIQUE,         -- normalized: trimmed, lower case
  salt TEXT NOT NULL,                 -- random per account (base64url)
  verifier TEXT NOT NULL,             -- HMAC-SHA256(pepper, salt || authKey)
  kdf TEXT NOT NULL,                  -- how the page stretched it, e.g. pbkdf2-sha256-600000-v1
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,        -- milliseconds since 1970
  updated_at INTEGER NOT NULL
);

-- Logged-in website sessions (account.tizcat.com cookie). Only a hash of
-- the token is kept.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- A TizCat browser linked to an account (TizCat Services keeps the token).
CREATE TABLE devices (
  id TEXT PRIMARY KEY,                -- "d_" + random
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX devices_user ON devices(user_id);

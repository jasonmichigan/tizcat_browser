-- Email confirmation, password reset and sync (2026-11-20).
--
-- An account is active once its email is confirmed (email_verified = 1);
-- until then it cannot log in, and signing up again with the same address
-- replaces it.

-- The account's sync key, locked with a key from the password that the
-- server never sees (shared/vault.js). Set on sign-up and on a reset.
ALTER TABLE users ADD COLUMN vault_key TEXT;
ALTER TABLE users ADD COLUMN verified_at INTEGER;
ALTER TABLE users ADD COLUMN password_changed_at INTEGER;

-- Links sent by email: confirm the address ("verify") or reset the
-- password ("reset"). Only a hash of the token is kept; each works once.
-- A "verify" link carries the password of the sign-up that sent it, and
-- confirming applies that one: if someone else signs up with your address
-- before you confirm, the link in your email still activates YOUR password.
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- verify | reset
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  salt TEXT,                          -- verify only: that sign-up's
  verifier TEXT,                      --   password verifier,
  kdf TEXT,                           --   how it was stretched,
  vault_key TEXT                      --   and its locked sync key
);
CREATE INDEX email_tokens_user ON email_tokens(user_id, kind);

-- TizCat sync (D1 database tizcat-sync). Everything here is encrypted on
-- the TizCat browser with the account's vault key (shared/vault.js); the
-- server cannot read it and stores it as text in pieces of at most 1 MB.

-- One row per kind of data per account: "bookmarks", "settings", "wallet",
-- and any kind added later (TizCat Services decides; the server does not
-- need to know them).
CREATE TABLE collections (
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,           -- +1 on every upload
  write_id TEXT NOT NULL,             -- which pieces are current
  size INTEGER NOT NULL,              -- characters of encrypted data
  pieces INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,        -- milliseconds since 1970
  updated_by TEXT,                    -- device id
  PRIMARY KEY (account_id, name)
);

CREATE TABLE pieces (
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  write_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (account_id, name, write_id, n)
);

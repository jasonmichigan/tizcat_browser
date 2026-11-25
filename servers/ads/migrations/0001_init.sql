-- TizCat ads (D1 database tizcat-ads): the catalog TizCat Services
-- downloads. Matching happens in the browser, as in Brave: the catalog goes
-- to the device and no browsing data comes back.

CREATE TABLE ads (
  id TEXT PRIMARY KEY,                -- lower case, digits and dashes
  placement TEXT NOT NULL CHECK (placement IN ('ntp', 'notification')),
  advertiser TEXT NOT NULL,
  title TEXT NOT NULL,                -- notification title, or the New Tab caption
  body TEXT NOT NULL DEFAULT '',      -- notification text
  image TEXT NOT NULL DEFAULT '',     -- file in ads\media, served at /v1/ads/media/<file>
  target_url TEXT NOT NULL,           -- https only
  weight INTEGER NOT NULL DEFAULT 1,  -- how often, against the others
  starts_at INTEGER NOT NULL DEFAULT 0,
  ends_at INTEGER NOT NULL DEFAULT 0, -- 0: no end
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

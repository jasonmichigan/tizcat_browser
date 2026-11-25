-- TizCat Rewards (D1 database tizcat-rewards): points for ads viewed. Points
-- are whole numbers; once JibCoin exists, a payout part turns them into coin
-- (config.json "coin"), and this ledger does not change.

-- One row per ad event that earned points. The id is the browser's own
-- random event id, so an event sent twice counts once.
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  placement TEXT NOT NULL,            -- ntp | notification
  kind TEXT NOT NULL,                 -- view | click
  points INTEGER NOT NULL,
  day TEXT NOT NULL,                  -- UTC date, YYYY-MM-DD, for the daily cap
  created_at INTEGER NOT NULL
);
CREATE INDEX events_device_day ON events(device_id, day);
CREATE INDEX events_account ON events(account_id, created_at);

CREATE TABLE balances (
  account_id TEXT PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

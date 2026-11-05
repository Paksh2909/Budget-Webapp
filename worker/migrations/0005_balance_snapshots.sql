-- One balance per account per (local) day. Written on every sync (latest wins) and by the cron
-- once a day even if nothing synced, so the net-worth chart has real history, incl. market moves.
CREATE TABLE balance_snapshots (
  date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  current_balance REAL,
  available_balance REAL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (date, account_id)
);

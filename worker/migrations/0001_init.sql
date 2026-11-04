-- Linked Plaid Items (one per bank login). Access tokens are AES-GCM encrypted.
CREATE TABLE items (
  item_id TEXT PRIMARY KEY,
  access_token_enc TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  cursor TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  error_code TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  official_name TEXT,
  mask TEXT,
  type TEXT NOT NULL,
  subtype TEXT,
  current_balance REAL,
  available_balance REAL,
  currency TEXT,
  display_name TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_accounts_item ON accounts(item_id);

-- amount follows Plaid's convention: positive = money out, negative = money in.
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  item_id TEXT,
  amount REAL NOT NULL,
  currency TEXT,
  date TEXT NOT NULL,
  datetime TEXT,
  name TEXT NOT NULL,
  merchant_name TEXT,
  logo_url TEXT,
  pending INTEGER NOT NULL DEFAULT 0,
  pending_transaction_id TEXT,
  pfc_primary TEXT,
  pfc_detailed TEXT,
  category TEXT NOT NULL,
  subcategory TEXT,
  user_category TEXT,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'plaid',
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tx_date ON transactions(date);
CREATE INDEX idx_tx_item ON transactions(item_id);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  categories TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE login_attempts (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Credit card statements from Plaid Liabilities (one row per card).
CREATE TABLE card_statements (
  account_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  last_statement_balance REAL,
  last_statement_issue_date TEXT,
  minimum_payment_amount REAL,
  next_payment_due_date TEXT,
  last_payment_amount REAL,
  last_payment_date TEXT,
  is_overdue INTEGER,
  updated_at TEXT NOT NULL
);

-- Whether statement data is available per bank:
-- NULL = not checked yet, 'ok', 'consent_required', 'unsupported', 'not_enabled', or 'error:<CODE>'.
ALTER TABLE items ADD COLUMN liabilities_status TEXT;
ALTER TABLE items ADD COLUMN liabilities_checked_at TEXT;

-- Bills you track by hand (e.g. rent via Bilt): matched by description, due within a day-of-month window.
CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  account_id TEXT,
  day_start INTEGER NOT NULL,
  day_end INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

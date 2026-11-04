-- Auto-categorize rules: "description contains <pattern>" -> category (+ optional subcategory).
-- Applied when the app loads data, so new rules also fix past transactions and deleting one undoes it.
-- A manual category on a transaction always wins over a rule.
CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  created_at TEXT NOT NULL
);

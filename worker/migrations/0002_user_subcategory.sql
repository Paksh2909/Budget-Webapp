-- User-chosen subcategory. NULL = use Plaid's; '' = explicitly none.
ALTER TABLE transactions ADD COLUMN user_subcategory TEXT;

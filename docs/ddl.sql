-- accounting-app DDL draft for Supabase PostgreSQL
-- This file defines the target model. Convert it into Supabase migration files
-- after validating against the actual project and current Supabase CLI/docs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS accounting;

CREATE TABLE accounting.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounting.fiscal_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES accounting.companies(id),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_years_date_check CHECK (start_date <= end_date),
  CONSTRAINT fiscal_years_unique UNIQUE (company_id, start_date, end_date)
);

CREATE TABLE accounting.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES accounting.companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  source_system TEXT,
  source_record_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounts_code_unique UNIQUE (company_id, code),
  CONSTRAINT accounts_category_check CHECK (
    category IN ('asset', 'liability', 'equity', 'revenue', 'expense')
  )
);

CREATE TABLE accounting.sub_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES accounting.companies(id),
  account_id UUID NOT NULL REFERENCES accounting.accounts(id),
  code TEXT,
  name TEXT NOT NULL,
  source_system TEXT,
  source_record_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sub_accounts_unique UNIQUE (company_id, account_id, name)
);

CREATE TABLE accounting.journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES accounting.companies(id),
  fiscal_year_id UUID NOT NULL REFERENCES accounting.fiscal_years(id),
  entry_date DATE NOT NULL,
  voucher_no TEXT NOT NULL,
  description TEXT,
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  total_debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  source_system TEXT NOT NULL DEFAULT 'manual',
  source_record_id TEXT,
  source_data JSONB,
  reversal_of_journal_id UUID REFERENCES accounting.journals(id),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT journals_voucher_unique UNIQUE (company_id, voucher_no),
  CONSTRAINT journals_status_check CHECK (status IN ('draft', 'posted', 'reversed')),
  CONSTRAINT journals_totals_check CHECK (total_debit = total_credit),
  CONSTRAINT journals_source_unique UNIQUE (company_id, source_system, source_record_id)
);

CREATE TABLE accounting.journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id UUID NOT NULL REFERENCES accounting.journals(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  account_id UUID NOT NULL REFERENCES accounting.accounts(id),
  sub_account_id UUID REFERENCES accounting.sub_accounts(id),
  side TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  memo TEXT,
  department TEXT,
  tax_name TEXT,
  partner_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT journal_lines_side_check CHECK (side IN ('debit', 'credit')),
  CONSTRAINT journal_lines_amount_check CHECK (amount > 0),
  CONSTRAINT journal_lines_line_unique UNIQUE (journal_id, line_no, side)
);

CREATE TABLE accounting.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES accounting.companies(id),
  receipt_code TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  supplier_name TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  document_kind TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'accounting-receipts',
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  captured_at TIMESTAMPTZ,
  supersedes_receipt_id UUID REFERENCES accounting.receipts(id),
  source_metadata JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT receipts_code_unique UNIQUE (company_id, receipt_code),
  CONSTRAINT receipts_storage_unique UNIQUE (storage_bucket, storage_path),
  CONSTRAINT receipts_sha256_check CHECK (length(sha256) = 64),
  CONSTRAINT receipts_document_kind_check CHECK (
    document_kind IN ('paper_scan', 'electronic_original', 'other')
  )
);

CREATE TABLE accounting.journal_receipts (
  journal_id UUID NOT NULL REFERENCES accounting.journals(id) ON DELETE CASCADE,
  receipt_id UUID NOT NULL REFERENCES accounting.receipts(id),
  relation_type TEXT NOT NULL DEFAULT 'evidence',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (journal_id, receipt_id)
);

CREATE TABLE accounting.import_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES accounting.companies(id),
  source_system TEXT NOT NULL,
  file_kind TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'accounting-imports',
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  row_count INTEGER,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  import_metadata JSONB,
  CONSTRAINT import_files_storage_unique UNIQUE (storage_bucket, storage_path),
  CONSTRAINT import_files_sha_unique UNIQUE (company_id, source_system, sha256),
  CONSTRAINT import_files_sha256_check CHECK (length(sha256) = 64)
);

CREATE TABLE accounting.bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES accounting.companies(id),
  import_file_id UUID NOT NULL REFERENCES accounting.import_files(id),
  source_system TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  description TEXT,
  balance NUMERIC(14,2),
  source_record_id TEXT,
  source_row_hash TEXT NOT NULL,
  matched_journal_id UUID REFERENCES accounting.journals(id),
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bank_transactions_row_unique UNIQUE (company_id, source_system, source_row_hash)
);

CREATE TABLE accounting.card_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES accounting.companies(id),
  import_file_id UUID NOT NULL REFERENCES accounting.import_files(id),
  source_system TEXT NOT NULL,
  used_date DATE NOT NULL,
  merchant_name TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  payment_date DATE,
  source_record_id TEXT,
  source_row_hash TEXT NOT NULL,
  matched_journal_id UUID REFERENCES accounting.journals(id),
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT card_transactions_row_unique UNIQUE (company_id, source_system, source_row_hash)
);

CREATE TABLE accounting.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES accounting.companies(id),
  actor_id UUID,
  actor_kind TEXT NOT NULL DEFAULT 'user',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_journals_company_date
  ON accounting.journals (company_id, entry_date);
CREATE INDEX idx_journal_lines_journal
  ON accounting.journal_lines (journal_id);
CREATE INDEX idx_journal_lines_account
  ON accounting.journal_lines (account_id);
CREATE INDEX idx_receipts_search
  ON accounting.receipts (company_id, transaction_date, amount, supplier_name);
CREATE INDEX idx_bank_transactions_date
  ON accounting.bank_transactions (company_id, transaction_date);
CREATE INDEX idx_card_transactions_date
  ON accounting.card_transactions (company_id, used_date);

-- Defense in depth. No authenticated policies are defined yet.
-- Server-side/service access is assumed until an explicit authorization model is implemented.
ALTER TABLE accounting.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.sub_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.journal_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.import_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA accounting FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA accounting FROM anon, authenticated;

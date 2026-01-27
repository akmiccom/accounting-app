-- UUID生成用
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 会社
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 会計年度/期間
CREATE TABLE fiscal_years (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_years_date_check CHECK (start_date <= end_date)
);

-- 勘定科目
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounts_code_unique UNIQUE (company_id, code),
  CONSTRAINT accounts_category_check CHECK (category IN ('asset', 'liability', 'equity', 'revenue', 'expense'))
);

-- 仕訳ヘッダ
CREATE TABLE journals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id),
  entry_date DATE NOT NULL,
  voucher_no TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  total_debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT journals_voucher_unique UNIQUE (company_id, voucher_no),
  CONSTRAINT journals_status_check CHECK (status IN ('draft', 'posted', 'reversed')),
  CONSTRAINT journals_totals_check CHECK (total_debit = total_credit)
);

-- 仕訳明細
CREATE TABLE journal_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journal_id UUID NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  side TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  memo TEXT,
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT journal_lines_side_check CHECK (side IN ('debit', 'credit')),
  CONSTRAINT journal_lines_amount_check CHECK (amount > 0)
);

-- 監査ログ
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_action_check CHECK (action IN ('create', 'update', 'post', 'reverse', 'import'))
);

-- インデックス例
CREATE INDEX idx_journals_company_date ON journals (company_id, entry_date);
CREATE INDEX idx_journal_lines_journal ON journal_lines (journal_id);
CREATE INDEX idx_journal_lines_account ON journal_lines (account_id);

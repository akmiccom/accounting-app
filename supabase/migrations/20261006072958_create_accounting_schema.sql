-- Initial accounting schema for Supabase.
-- This migration intentionally keeps the accounting schema private from anon/authenticated.
-- Application access is server-side until an explicit end-user authorization model is added.

create extension if not exists pgcrypto;
create schema if not exists accounting;

create table accounting.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table accounting.fiscal_years (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting.companies(id),
  name text not null,
  start_date date not null,
  end_date date not null,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint fiscal_years_date_check check (start_date <= end_date),
  constraint fiscal_years_unique unique (company_id, start_date, end_date)
);

create table accounting.accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting.companies(id),
  code text not null,
  name text not null,
  category text not null,
  source_system text,
  source_record_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint accounts_code_unique unique (company_id, code),
  constraint accounts_category_check check (
    category in ('asset', 'liability', 'equity', 'revenue', 'expense')
  )
);

create unique index accounts_source_record_unique
  on accounting.accounts (company_id, source_system, source_record_id)
  where source_record_id is not null;

create table accounting.sub_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting.companies(id),
  account_id uuid not null references accounting.accounts(id),
  code text,
  name text not null,
  source_system text,
  source_record_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint sub_accounts_unique unique (company_id, account_id, name)
);

create unique index sub_accounts_source_record_unique
  on accounting.sub_accounts (company_id, source_system, source_record_id)
  where source_record_id is not null;

create table accounting.journals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting.companies(id),
  fiscal_year_id uuid not null references accounting.fiscal_years(id),
  entry_date date not null,
  voucher_no text not null,
  description text,
  memo text,
  status text not null default 'draft',
  total_debit numeric(14,2) not null default 0,
  total_credit numeric(14,2) not null default 0,
  source_system text not null default 'manual',
  source_record_id text,
  source_data jsonb,
  reversal_of_journal_id uuid references accounting.journals(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journals_voucher_unique unique (company_id, voucher_no),
  constraint journals_status_check check (status in ('draft', 'posted', 'reversed')),
  constraint journals_totals_nonnegative_check check (total_debit >= 0 and total_credit >= 0),
  constraint journals_totals_check check (total_debit = total_credit),
  constraint journals_not_self_reversal_check check (reversal_of_journal_id is null or reversal_of_journal_id <> id)
);

create unique index journals_source_record_unique
  on accounting.journals (company_id, source_system, source_record_id)
  where source_record_id is not null;

create table accounting.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references accounting.journals(id) on delete cascade,
  line_no integer not null,
  account_id uuid not null references accounting.accounts(id),
  sub_account_id uuid references accounting.sub_accounts(id),
  side text not null,
  amount numeric(14,2) not null,
  memo text,
  department text,
  tax_name text,
  partner_name text,
  created_at timestamptz not null default now(),
  constraint journal_lines_line_no_check check (line_no > 0),
  constraint journal_lines_side_check check (side in ('debit', 'credit')),
  constraint journal_lines_amount_check check (amount > 0),
  constraint journal_lines_line_unique unique (journal_id, line_no, side)
);

create table accounting.receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting.companies(id),
  receipt_code text not null,
  transaction_date date not null,
  supplier_name text not null,
  amount numeric(14,2) not null,
  currency text not null default 'JPY',
  document_kind text not null,
  storage_bucket text not null default 'accounting-receipts',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  sha256 text not null,
  captured_at timestamptz,
  supersedes_receipt_id uuid references accounting.receipts(id),
  source_metadata jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint receipts_amount_check check (amount >= 0),
  constraint receipts_code_unique unique (company_id, receipt_code),
  constraint receipts_storage_unique unique (storage_bucket, storage_path),
  constraint receipts_sha256_check check (sha256 ~ '^[0-9A-Fa-f]{64}$'),
  constraint receipts_not_self_supersede_check check (supersedes_receipt_id is null or supersedes_receipt_id <> id),
  constraint receipts_document_kind_check check (
    document_kind in ('paper_scan', 'electronic_original', 'other')
  )
);

create table accounting.journal_receipts (
  journal_id uuid not null references accounting.journals(id) on delete cascade,
  receipt_id uuid not null references accounting.receipts(id),
  relation_type text not null default 'evidence',
  created_at timestamptz not null default now(),
  primary key (journal_id, receipt_id)
);

create table accounting.import_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting.companies(id),
  source_system text not null,
  file_kind text not null,
  storage_bucket text not null default 'accounting-imports',
  storage_path text not null,
  original_filename text not null,
  sha256 text not null,
  row_count integer,
  imported_at timestamptz not null default now(),
  import_metadata jsonb,
  constraint import_files_row_count_check check (row_count is null or row_count >= 0),
  constraint import_files_storage_unique unique (storage_bucket, storage_path),
  constraint import_files_sha_unique unique (company_id, source_system, sha256),
  constraint import_files_sha256_check check (sha256 ~ '^[0-9A-Fa-f]{64}$')
);

create table accounting.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting.companies(id),
  import_file_id uuid not null references accounting.import_files(id),
  source_system text not null,
  transaction_date date not null,
  amount numeric(14,2) not null,
  description text,
  balance numeric(14,2),
  source_record_id text,
  source_row_hash text not null,
  matched_journal_id uuid references accounting.journals(id),
  raw_data jsonb,
  created_at timestamptz not null default now(),
  constraint bank_transactions_row_hash_check check (source_row_hash ~ '^[0-9A-Fa-f]{64}$'),
  constraint bank_transactions_row_unique unique (company_id, source_system, source_row_hash)
);

create table accounting.card_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting.companies(id),
  import_file_id uuid not null references accounting.import_files(id),
  source_system text not null,
  used_date date not null,
  merchant_name text not null,
  amount numeric(14,2) not null,
  payment_date date,
  source_record_id text,
  source_row_hash text not null,
  matched_journal_id uuid references accounting.journals(id),
  raw_data jsonb,
  created_at timestamptz not null default now(),
  constraint card_transactions_row_hash_check check (source_row_hash ~ '^[0-9A-Fa-f]{64}$'),
  constraint card_transactions_row_unique unique (company_id, source_system, source_row_hash)
);

create table accounting.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting.companies(id),
  actor_id uuid,
  actor_kind text not null default 'user',
  action text not null,
  target_type text not null,
  target_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

-- FK and common lookup indexes.
create index idx_fiscal_years_company
  on accounting.fiscal_years (company_id);
create index idx_accounts_company
  on accounting.accounts (company_id);
create index idx_sub_accounts_account
  on accounting.sub_accounts (account_id);
create index idx_journals_fiscal_year
  on accounting.journals (fiscal_year_id);
create index idx_journals_company_date
  on accounting.journals (company_id, entry_date);
create index idx_journal_lines_journal
  on accounting.journal_lines (journal_id);
create index idx_journal_lines_account
  on accounting.journal_lines (account_id);
create index idx_journal_lines_sub_account
  on accounting.journal_lines (sub_account_id)
  where sub_account_id is not null;
create index idx_receipts_search
  on accounting.receipts (company_id, transaction_date, amount, supplier_name);
create index idx_receipts_supersedes
  on accounting.receipts (supersedes_receipt_id)
  where supersedes_receipt_id is not null;
create index idx_journal_receipts_receipt
  on accounting.journal_receipts (receipt_id);
create index idx_import_files_company
  on accounting.import_files (company_id);
create index idx_bank_transactions_import_file
  on accounting.bank_transactions (import_file_id);
create index idx_bank_transactions_date
  on accounting.bank_transactions (company_id, transaction_date);
create index idx_bank_transactions_matched_journal
  on accounting.bank_transactions (matched_journal_id)
  where matched_journal_id is not null;
create index idx_card_transactions_import_file
  on accounting.card_transactions (import_file_id);
create index idx_card_transactions_date
  on accounting.card_transactions (company_id, used_date);
create index idx_card_transactions_matched_journal
  on accounting.card_transactions (matched_journal_id)
  where matched_journal_id is not null;
create index idx_audit_logs_company_created
  on accounting.audit_logs (company_id, created_at desc);

-- Keep journal totals synchronized while the journal is still a draft.
create or replace function accounting.recalculate_journal_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_journal_id uuid;
begin
  -- Recalculate the destination/current journal.
  if tg_op <> 'DELETE' then
    v_journal_id := new.journal_id;

    update accounting.journals j
       set total_debit = coalesce((
             select sum(l.amount)
               from accounting.journal_lines l
              where l.journal_id = v_journal_id
                and l.side = 'debit'
           ), 0),
           total_credit = coalesce((
             select sum(l.amount)
               from accounting.journal_lines l
              where l.journal_id = v_journal_id
                and l.side = 'credit'
           ), 0),
           updated_at = now()
     where j.id = v_journal_id;
  end if;

  -- If a line was deleted or moved, also recalculate the old journal.
  if tg_op = 'DELETE' then
    v_journal_id := old.journal_id;

    update accounting.journals j
       set total_debit = coalesce((
             select sum(l.amount)
               from accounting.journal_lines l
              where l.journal_id = v_journal_id
                and l.side = 'debit'
           ), 0),
           total_credit = coalesce((
             select sum(l.amount)
               from accounting.journal_lines l
              where l.journal_id = v_journal_id
                and l.side = 'credit'
           ), 0),
           updated_at = now()
     where j.id = v_journal_id;
  elsif tg_op = 'UPDATE' and old.journal_id is distinct from new.journal_id then
    v_journal_id := old.journal_id;

    update accounting.journals j
       set total_debit = coalesce((
             select sum(l.amount)
               from accounting.journal_lines l
              where l.journal_id = v_journal_id
                and l.side = 'debit'
           ), 0),
           total_credit = coalesce((
             select sum(l.amount)
               from accounting.journal_lines l
              where l.journal_id = v_journal_id
                and l.side = 'credit'
           ), 0),
           updated_at = now()
     where j.id = v_journal_id;
  end if;

  return null;
end;
$$;

create trigger journal_lines_recalculate_totals
after insert or update or delete on accounting.journal_lines
for each row execute function accounting.recalculate_journal_totals();

-- A posted/reversed journal is immutable, except posted -> reversed status marking.
create or replace function accounting.protect_finalized_journal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.status in ('posted', 'reversed') then
    raise exception 'Finalized journals cannot be deleted';
  end if;

  if tg_op = 'UPDATE' and old.status in ('posted', 'reversed') then
    if old.status = 'posted'
       and new.status = 'reversed'
       and (to_jsonb(new) - 'status' - 'updated_at')
           = (to_jsonb(old) - 'status' - 'updated_at') then
      return new;
    end if;

    raise exception 'Finalized journals are immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger journals_protect_finalized
before update or delete on accounting.journals
for each row execute function accounting.protect_finalized_journal();

-- Lines belonging to posted/reversed journals cannot be altered.
create or replace function accounting.protect_finalized_journal_lines()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op in ('DELETE', 'UPDATE') then
    select j.status
      into v_status
      from accounting.journals j
     where j.id = old.journal_id;

    if v_status in ('posted', 'reversed') then
      raise exception 'Lines of finalized journals are immutable';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select j.status
      into v_status
      from accounting.journals j
     where j.id = new.journal_id;

    if v_status in ('posted', 'reversed') then
      raise exception 'Lines of finalized journals are immutable';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger journal_lines_protect_finalized
before insert or update or delete on accounting.journal_lines
for each row execute function accounting.protect_finalized_journal_lines();

-- Posting is allowed only for a non-empty, balanced journal.
create or replace function accounting.validate_journal_posting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line_count integer;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Journals must be inserted as draft and posted after lines are added';
    end if;
    return new;
  end if;

  if new.status = 'posted' and old.status = 'draft' then
    select count(*),
           coalesce(sum(amount) filter (where side = 'debit'), 0),
           coalesce(sum(amount) filter (where side = 'credit'), 0)
      into v_line_count, v_debit, v_credit
      from accounting.journal_lines
     where journal_id = new.id;

    if v_line_count < 2 or v_debit <= 0 or v_debit <> v_credit then
      raise exception 'Journal must contain balanced debit/credit lines before posting';
    end if;

    new.total_debit := v_debit;
    new.total_credit := v_credit;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger journals_validate_posting
before insert or update of status on accounting.journals
for each row execute function accounting.validate_journal_posting();

-- Evidence metadata and imported originals are append-only.
create or replace function accounting.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% records are append-only; insert a replacement/superseding record instead', tg_table_name;
end;
$$;

create trigger receipts_append_only
before update or delete on accounting.receipts
for each row execute function accounting.reject_mutation();

create trigger import_files_append_only
before update or delete on accounting.import_files
for each row execute function accounting.reject_mutation();

create trigger audit_logs_append_only
before update or delete on accounting.audit_logs
for each row execute function accounting.reject_mutation();

-- Private Storage buckets for evidence and original import files.
-- No anon/authenticated storage policies are created in this migration.
insert into storage.buckets (id, name, public)
values
  ('accounting-receipts', 'accounting-receipts', false),
  ('accounting-imports', 'accounting-imports', false)
on conflict (id) do update
set public = excluded.public;

-- Defense in depth. No anon/authenticated policies are defined yet.
alter table accounting.companies enable row level security;
alter table accounting.fiscal_years enable row level security;
alter table accounting.accounts enable row level security;
alter table accounting.sub_accounts enable row level security;
alter table accounting.journals enable row level security;
alter table accounting.journal_lines enable row level security;
alter table accounting.receipts enable row level security;
alter table accounting.journal_receipts enable row level security;
alter table accounting.import_files enable row level security;
alter table accounting.bank_transactions enable row level security;
alter table accounting.card_transactions enable row level security;
alter table accounting.audit_logs enable row level security;

revoke all on schema accounting from anon, authenticated;
revoke all on all tables in schema accounting from anon, authenticated;
revoke all on all functions in schema accounting from anon, authenticated;

create table accounting.accounting_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting.companies(id) on delete cascade,
  name text not null,
  source_kind text not null,
  match_type text not null default 'exact',
  match_value text not null,
  direction text not null default 'any',
  amount_min numeric(14,2),
  amount_max numeric(14,2),
  debit_account_id uuid not null references accounting.accounts(id),
  debit_sub_account_id uuid references accounting.sub_accounts(id),
  credit_account_id uuid not null references accounting.accounts(id),
  credit_sub_account_id uuid references accounting.sub_accounts(id),
  priority integer not null default 100,
  auto_post boolean not null default false,
  is_active boolean not null default true,
  valid_from date,
  valid_to date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounting_rules_source_kind_check
    check (source_kind in ('card','bank')),
  constraint accounting_rules_match_type_check
    check (match_type in ('exact','contains','prefix')),
  constraint accounting_rules_direction_check
    check (direction in ('any','inflow','outflow')),
  constraint accounting_rules_amount_range_check
    check (amount_min is null or amount_max is null or amount_min <= amount_max),
  constraint accounting_rules_valid_range_check
    check (valid_from is null or valid_to is null or valid_from <= valid_to),
  constraint accounting_rules_priority_check
    check (priority >= 0),
  constraint accounting_rules_match_value_nonempty_check
    check (length(btrim(match_value)) > 0)
);

create index accounting_rules_lookup_idx
  on accounting.accounting_rules
  (company_id, source_kind, is_active, priority desc);

create index accounting_rules_match_value_idx
  on accounting.accounting_rules
  (company_id, source_kind, match_value);

alter table accounting.accounting_rules enable row level security;
revoke all on accounting.accounting_rules from anon, authenticated;

comment on table accounting.accounting_rules is
  'Explicit journal classification rules. Rules take precedence over historical-learning candidates.';

comment on column accounting.accounting_rules.auto_post is
  'Reserved for future use. Candidate generation currently always creates draft journals.';

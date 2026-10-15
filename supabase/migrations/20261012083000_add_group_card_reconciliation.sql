-- Add explicit group reconciliation for ambiguous many-to-many card matches.
-- The two 2026-04-11 / 150 JPY SMBC rows correspond to two Money Forward
-- journals, but there is no reliable one-to-one ordering. Keep matched_journal_id
-- NULL and record the 2x2 set as a reconciled group instead.

begin;

create table if not exists accounting.reconciliation_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting.companies(id),
  group_key text not null,
  source_kind text not null,
  match_method text not null,
  status text not null default 'matched',
  match_date date,
  amount numeric,
  transaction_count integer not null,
  journal_count integer not null,
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint reconciliation_groups_source_kind_check check (source_kind in ('card','bank','other')),
  constraint reconciliation_groups_status_check check (status in ('matched','review')),
  constraint reconciliation_groups_counts_check check (transaction_count > 0 and journal_count > 0),
  constraint reconciliation_groups_company_key_unique unique (company_id, group_key)
);

create table if not exists accounting.reconciliation_group_card_transactions (
  group_id uuid not null references accounting.reconciliation_groups(id) on delete cascade,
  card_transaction_id uuid not null references accounting.card_transactions(id),
  primary key (group_id, card_transaction_id),
  constraint reconciliation_group_card_transaction_unique unique (card_transaction_id)
);

create table if not exists accounting.reconciliation_group_journals (
  group_id uuid not null references accounting.reconciliation_groups(id) on delete cascade,
  journal_id uuid not null references accounting.journals(id),
  primary key (group_id, journal_id),
  constraint reconciliation_group_journal_unique unique (journal_id)
);

alter table accounting.reconciliation_groups enable row level security;
alter table accounting.reconciliation_group_card_transactions enable row level security;
alter table accounting.reconciliation_group_journals enable row level security;

revoke all on accounting.reconciliation_groups from anon, authenticated;
revoke all on accounting.reconciliation_group_card_transactions from anon, authenticated;
revoke all on accounting.reconciliation_group_journals from anon, authenticated;

do $$
declare
  v_card_count integer;
  v_journal_count integer;
begin
  select count(*) into v_card_count
  from accounting.card_transactions
  where company_id = '3cb6f6ef-3c74-47d9-8266-2ceafcdb2b73'
    and source_system = 'smbc_card_csv'
    and used_date = date '2026-04-11'
    and amount = 150
    and merchant_name = 'マクドナルドモバイルオーダー'
    and matched_journal_id is null;

  select count(*) into v_journal_count
  from accounting.journals j
  where j.company_id = '3cb6f6ef-3c74-47d9-8266-2ceafcdb2b73'
    and j.source_system = 'moneyforward'
    and j.source_record_id in (
      'apUHxL3a583d%2FY1w6ObqaLQmZYmLLY%2FZPRLWPfrn9h4%3D',
      'eBhPafK%2BroTCBP5vwtRVwF6QbheHrth6EqzXYF9jqAI%3D'
    );

  if v_card_count <> 2 then
    raise exception 'Expected exactly 2 unmatched card transactions, got %', v_card_count;
  end if;
  if v_journal_count <> 2 then
    raise exception 'Expected exactly 2 matching journals, got %', v_journal_count;
  end if;
end
$$;

insert into accounting.reconciliation_groups (
  company_id, group_key, source_kind, match_method, status,
  match_date, amount, transaction_count, journal_count, metadata
)
values (
  '3cb6f6ef-3c74-47d9-8266-2ceafcdb2b73',
  'card_exact_group:2026-04-11:150:2x2',
  'card',
  'exact_date_amount_count_group',
  'matched',
  date '2026-04-11',
  150,
  2,
  2,
  jsonb_build_object(
    'merchant_name', 'マクドナルドモバイルオーダー',
    'reason', 'Two card rows and two journals have identical date and amount; one-to-one pairing is not reliably distinguishable.',
    'individual_matched_journal_id_left_null', true
  )
)
on conflict (company_id, group_key) do nothing;

insert into accounting.reconciliation_group_card_transactions (group_id, card_transaction_id)
select g.id, c.id
from accounting.reconciliation_groups g
join accounting.card_transactions c on c.company_id = g.company_id
where g.company_id = '3cb6f6ef-3c74-47d9-8266-2ceafcdb2b73'
  and g.group_key = 'card_exact_group:2026-04-11:150:2x2'
  and c.source_system = 'smbc_card_csv'
  and c.used_date = date '2026-04-11'
  and c.amount = 150
  and c.merchant_name = 'マクドナルドモバイルオーダー'
  and c.matched_journal_id is null
on conflict (card_transaction_id) do nothing;

insert into accounting.reconciliation_group_journals (group_id, journal_id)
select g.id, j.id
from accounting.reconciliation_groups g
join accounting.journals j on j.company_id = g.company_id
where g.company_id = '3cb6f6ef-3c74-47d9-8266-2ceafcdb2b73'
  and g.group_key = 'card_exact_group:2026-04-11:150:2x2'
  and j.source_system = 'moneyforward'
  and j.source_record_id in (
    'apUHxL3a583d%2FY1w6ObqaLQmZYmLLY%2FZPRLWPfrn9h4%3D',
    'eBhPafK%2BroTCBP5vwtRVwF6QbheHrth6EqzXYF9jqAI%3D'
  )
on conflict (journal_id) do nothing;

create or replace view accounting.card_transaction_reconciliation_v
with (security_invoker = true)
as
select
  c.*,
  case
    when c.matched_journal_id is not null then 'direct'
    when rg.status = 'matched' then 'group'
    when rg.status = 'review' then 'review'
    else 'unmatched'
  end as reconciliation_status,
  rg.id as reconciliation_group_id,
  rg.group_key as reconciliation_group_key,
  rg.match_method as reconciliation_match_method
from accounting.card_transactions c
left join accounting.reconciliation_group_card_transactions rgc
  on rgc.card_transaction_id = c.id
left join accounting.reconciliation_groups rg
  on rg.id = rgc.group_id;

do $$
declare
  v_group_cards integer;
  v_group_journals integer;
  v_effective_matched integer;
  v_fy_rows integer;
begin
  select count(*) into v_group_cards
  from accounting.reconciliation_group_card_transactions rgc
  join accounting.reconciliation_groups rg on rg.id = rgc.group_id
  where rg.company_id = '3cb6f6ef-3c74-47d9-8266-2ceafcdb2b73'
    and rg.group_key = 'card_exact_group:2026-04-11:150:2x2';

  select count(*) into v_group_journals
  from accounting.reconciliation_group_journals rgj
  join accounting.reconciliation_groups rg on rg.id = rgj.group_id
  where rg.company_id = '3cb6f6ef-3c74-47d9-8266-2ceafcdb2b73'
    and rg.group_key = 'card_exact_group:2026-04-11:150:2x2';

  select count(*), count(*) filter (where reconciliation_status in ('direct','group'))
  into v_fy_rows, v_effective_matched
  from accounting.card_transaction_reconciliation_v
  where company_id = '3cb6f6ef-3c74-47d9-8266-2ceafcdb2b73'
    and source_system = 'smbc_card_csv'
    and used_date between date '2025-11-01' and date '2026-10-31';

  if v_group_cards <> 2 then
    raise exception 'Expected 2 card rows in reconciliation group, got %', v_group_cards;
  end if;
  if v_group_journals <> 2 then
    raise exception 'Expected 2 journals in reconciliation group, got %', v_group_journals;
  end if;
  if v_fy_rows <> 318 then
    raise exception 'Expected 318 FY2025 card rows, got %', v_fy_rows;
  end if;
  if v_effective_matched <> 318 then
    raise exception 'Expected all 318 FY2025 card rows effectively reconciled, got %', v_effective_matched;
  end if;
end
$$;

commit;

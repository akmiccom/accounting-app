-- Formalize bank reconciliation status.
-- Current FY2025 state:
--   28 rows already have matched_journal_id -> direct
--   2 rows are valid bank facts but corresponding MF journals are not yet imported -> pending_journal

begin;

alter table accounting.bank_transactions
  add column if not exists reconciliation_status text;

-- Backfill a safe initial state before adding NOT NULL / CHECK constraints.
update accounting.bank_transactions
set reconciliation_status =
  case
    when matched_journal_id is not null then 'direct'
    else 'unmatched'
  end
where reconciliation_status is null;

-- The two known FY2025 bank rows are not errors. They are waiting for
-- Money Forward journals dated after the current import cutoff (2026-09-27).
update accounting.bank_transactions
set reconciliation_status = 'pending_journal'
where company_id = '3cb6f6ef-3c74-47d9-8266-2ceafcdb2b73'
  and source_system = 'gmo_aozora_bank_csv'
  and matched_journal_id is null
  and source_record_id in (
    'statement-102-1-1189135.csv:3',
    'statement-102-1-1189135.csv:2'
  );

alter table accounting.bank_transactions
  alter column reconciliation_status set default 'unmatched',
  alter column reconciliation_status set not null;

alter table accounting.bank_transactions
  drop constraint if exists bank_transactions_reconciliation_status_check;

alter table accounting.bank_transactions
  add constraint bank_transactions_reconciliation_status_check
  check (reconciliation_status in ('direct', 'pending_journal', 'review', 'unmatched'));

alter table accounting.bank_transactions
  drop constraint if exists bank_transactions_reconciliation_consistency_check;

alter table accounting.bank_transactions
  add constraint bank_transactions_reconciliation_consistency_check
  check (
    (matched_journal_id is not null and reconciliation_status = 'direct')
    or
    (matched_journal_id is null and reconciliation_status <> 'direct')
  );

-- Keep status synchronized when a direct journal link is created or removed.
create or replace function accounting.sync_bank_reconciliation_status()
returns trigger
language plpgsql
set search_path = accounting, public
as $$
begin
  if new.matched_journal_id is not null then
    new.reconciliation_status := 'direct';
  elsif old.matched_journal_id is not null
        and new.matched_journal_id is null
        and new.reconciliation_status = 'direct' then
    new.reconciliation_status := 'unmatched';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_bank_reconciliation_status
  on accounting.bank_transactions;

create trigger trg_sync_bank_reconciliation_status
before update of matched_journal_id
on accounting.bank_transactions
for each row
execute function accounting.sync_bank_reconciliation_status();

-- Provide the same style of read surface as the card reconciliation view.
create or replace view accounting.bank_transaction_reconciliation_v
with (security_invoker = true)
as
select
  b.*,
  case
    when b.matched_journal_id is not null then 'direct'
    else b.reconciliation_status
  end as effective_reconciliation_status
from accounting.bank_transactions b;

-- Fail the migration unless the expected current state is exactly:
-- direct=28, pending_journal=2, review=0, unmatched=0.
do $$
declare
  v_direct integer;
  v_pending integer;
  v_review integer;
  v_unmatched integer;
  v_total integer;
begin
  select
    count(*) filter (where effective_reconciliation_status = 'direct'),
    count(*) filter (where effective_reconciliation_status = 'pending_journal'),
    count(*) filter (where effective_reconciliation_status = 'review'),
    count(*) filter (where effective_reconciliation_status = 'unmatched'),
    count(*)
  into v_direct, v_pending, v_review, v_unmatched, v_total
  from accounting.bank_transaction_reconciliation_v
  where company_id = '3cb6f6ef-3c74-47d9-8266-2ceafcdb2b73'
    and source_system = 'gmo_aozora_bank_csv';

  if v_total <> 30 then
    raise exception 'Expected 30 GMO Aozora bank rows, got %', v_total;
  end if;

  if v_direct <> 28
     or v_pending <> 2
     or v_review <> 0
     or v_unmatched <> 0 then
    raise exception
      'Unexpected bank reconciliation state: direct %, pending %, review %, unmatched %',
      v_direct, v_pending, v_review, v_unmatched;
  end if;
end
$$;

commit;

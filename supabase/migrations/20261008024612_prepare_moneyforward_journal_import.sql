alter table accounting.journals
  add column if not exists entry_kind text not null default 'regular';

alter table accounting.journals
  drop constraint if exists journals_entry_kind_check;

alter table accounting.journals
  add constraint journals_entry_kind_check
  check (entry_kind in ('opening', 'regular', 'adjusting'));

create index if not exists idx_journals_reversal_of_journal_id
  on accounting.journals (reversal_of_journal_id)
  where reversal_of_journal_id is not null;

alter table accounting.journals
  drop constraint if exists journals_voucher_unique;

alter table accounting.journals
  add constraint journals_voucher_unique
  unique (company_id, fiscal_year_id, voucher_no);
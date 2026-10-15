-- Support direct bank API imports that do not originate from an uploaded file.
-- Applied to production as Supabase migration 20261015054816.

alter table accounting.bank_transactions
  alter column import_file_id drop not null;

create unique index if not exists bank_transactions_source_record_unique
  on accounting.bank_transactions (company_id, source_system, source_record_id)
  where source_record_id is not null;

create or replace view accounting.bank_transaction_reconciliation_readable_v
with (security_invoker = true)
as
select
  c.name as "会社名",
  v.transaction_date as "取引日",
  v.description as "摘要",
  v.amount as "金額",
  v.balance as "残高",
  case v.reconciliation_status
    when 'matched' then '照合済み'
    when 'unmatched' then '未照合'
    when 'pending_journal' then '仕訳待ち'
    else v.reconciliation_status
  end as "照合状態",
  case v.effective_reconciliation_status
    when 'matched' then '照合済み'
    when 'unmatched' then '未照合'
    when 'pending_journal' then '仕訳待ち'
    else v.effective_reconciliation_status
  end as "実効照合状態",
  f.original_filename as "取込ファイル名",
  j.voucher_no as "対応伝票番号",
  j.description as "対応仕訳摘要",
  v.source_system as "取込元",
  v.source_record_id as "取込元レコードID",
  v.source_row_hash as "取込行ハッシュ",
  v.raw_data as "元データ",
  v.created_at as "登録日時"
from accounting.bank_transaction_reconciliation_v v
join accounting.companies c on c.id = v.company_id
left join accounting.import_files f on f.id = v.import_file_id
left join accounting.journals j on j.id = v.matched_journal_id;

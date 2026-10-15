begin;

with c as (
  select id from accounting.companies where name='akmic合同会社' limit 1
),
bank_account as (
  select a.id account_id, sa.id sub_account_id
  from accounting.accounts a
  join accounting.sub_accounts sa on sa.account_id=a.id and sa.company_id=a.company_id
  join c on c.id=a.company_id
  where a.name='普通預金'
    and sa.name='GMOあおぞらネット銀行法人第二営業部普通預金(有利息)11'
),
interest as (
  select a.id account_id
  from accounting.accounts a
  join c on c.id=a.company_id
  where a.name='受取利息'
),
fee as (
  select a.id account_id, sa.id sub_account_id
  from accounting.accounts a
  join accounting.sub_accounts sa on sa.account_id=a.id and sa.company_id=a.company_id
  join c on c.id=a.company_id
  where a.name='支払手数料'
    and sa.name='GMOあおぞらネット銀行'
),
rows as (
  select
    c.id company_id,
    '普通預金 利息'::text name,
    '普通預金 利息'::text match_value,
    'inflow'::text direction,
    ba.account_id debit_account_id,
    ba.sub_account_id debit_sub_account_id,
    i.account_id credit_account_id,
    null::uuid credit_sub_account_id,
    '2026-11-01'::date valid_from,
    '今後用。過去30件すべて受取利息。'::text notes
  from c cross join bank_account ba cross join interest i
  union all
  select
    c.id,
    '振込手数料',
    '振込手数料',
    'outflow',
    f.account_id,
    f.sub_account_id,
    ba.account_id,
    ba.sub_account_id,
    '2026-11-01'::date,
    '今後用。振込手数料はGMOあおぞらネット銀行の支払手数料へ統一。'
  from c cross join bank_account ba cross join fee f
)
insert into accounting.accounting_rules (
  company_id,name,source_kind,match_type,match_value,direction,
  debit_account_id,debit_sub_account_id,
  credit_account_id,credit_sub_account_id,
  priority,auto_post,is_active,valid_from,notes
)
select
  company_id,name,'bank','exact',match_value,direction,
  debit_account_id,debit_sub_account_id,
  credit_account_id,credit_sub_account_id,
  100,false,true,valid_from,notes
from rows
where not exists (
  select 1
  from accounting.accounting_rules ar
  where ar.company_id=rows.company_id
    and ar.source_kind='bank'
    and ar.match_type='exact'
    and ar.match_value=rows.match_value
    and ar.direction=rows.direction
    and ar.is_active=true
);

commit;

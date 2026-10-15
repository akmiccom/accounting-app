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
rakuten as (
  select a.id account_id, sa.id sub_account_id
  from accounting.accounts a
  join accounting.sub_accounts sa on sa.account_id=a.id and sa.company_id=a.company_id
  join c on c.id=a.company_id
  where a.name='預け金' and sa.name='楽天証券'
)
insert into accounting.accounting_rules (
  company_id,name,source_kind,match_type,match_value,direction,
  debit_account_id,debit_sub_account_id,
  credit_account_id,credit_sub_account_id,
  priority,auto_post,is_active,valid_from,notes
)
select
  c.id,'楽天証券振込','bank','exact','振込 ラクテン ラクテンシヨウケン','outflow',
  r.account_id,r.sub_account_id,b.account_id,b.sub_account_id,
  100,false,true,'2026-11-01'::date,
  '今後用。過去15件中14件が預け金/楽天証券。1件は楽天証券 預け金(円)の例外。'
from c cross join bank_account b cross join rakuten r
where not exists (
  select 1 from accounting.accounting_rules ar
  where ar.company_id=c.id
    and ar.source_kind='bank'
    and ar.match_type='exact'
    and ar.match_value='振込 ラクテン ラクテンシヨウケン'
    and ar.direction='outflow'
    and ar.is_active=true
);
commit;

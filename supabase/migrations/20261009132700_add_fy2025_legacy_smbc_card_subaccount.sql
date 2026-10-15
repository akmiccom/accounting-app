-- Add the FY2025 legacy SMBC card sub-account referenced by Money Forward journals.
-- This source_record_id appears in 283 FY2025 journal lines and is required
-- before importing 2025 journals.

begin;

with c as (
  select id
  from accounting.companies
  where name = 'akmic合同会社'
  order by created_at
  limit 1
),
parent_account as (
  select a.id
  from accounting.accounts a
  join c on c.id = a.company_id
  where a.source_system = 'moneyforward'
    and a.source_record_id = 'b8fAk3xeYsBmHNXczmO3ig%3D%3D'
    and a.name = '未払金'
  limit 1
)
insert into accounting.sub_accounts (
  company_id,
  account_id,
  code,
  name,
  source_system,
  source_record_id,
  is_active
)
select
  c.id,
  parent_account.id,
  null,
  '三井住友カードご本人/代表会員オーナーズV',
  'moneyforward',
  'eOCEMUAA%2FLJUda99tgjCSQ%3D%3D',
  true
from c
cross join parent_account
where not exists (
  select 1
  from accounting.sub_accounts s
  where s.company_id = c.id
    and s.account_id = parent_account.id
    and s.source_system = 'moneyforward'
    and s.source_record_id = 'eOCEMUAA%2FLJUda99tgjCSQ%3D%3D'
);

do $$
declare
  v_count integer;
begin
  select count(*)
    into v_count
  from accounting.sub_accounts s
  join accounting.accounts a on a.id = s.account_id
  join accounting.companies c on c.id = s.company_id
  where c.name = 'akmic合同会社'
    and a.source_system = 'moneyforward'
    and a.source_record_id = 'b8fAk3xeYsBmHNXczmO3ig%3D%3D'
    and s.source_system = 'moneyforward'
    and s.source_record_id = 'eOCEMUAA%2FLJUda99tgjCSQ%3D%3D'
    and s.name = '三井住友カードご本人/代表会員オーナーズV';

  if v_count <> 1 then
    raise exception 'Expected exactly one legacy SMBC card sub-account, got %', v_count;
  end if;
end
$$;

commit;

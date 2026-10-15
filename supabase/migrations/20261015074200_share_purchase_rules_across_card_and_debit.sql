alter table accounting.accounting_rules
  drop constraint if exists accounting_rules_source_kind_check;

alter table accounting.accounting_rules
  add constraint accounting_rules_source_kind_check
  check (source_kind in ('purchase','card','bank'));

alter table accounting.accounting_rules
  alter column credit_account_id drop not null;

alter table accounting.accounting_rules
  drop constraint if exists accounting_rules_credit_shape_check;

alter table accounting.accounting_rules
  add constraint accounting_rules_credit_shape_check
  check (
    (source_kind = 'purchase' and credit_account_id is null and credit_sub_account_id is null)
    or
    (source_kind in ('card','bank') and credit_account_id is not null)
  );

update accounting.accounting_rules
set source_kind='purchase',
    credit_account_id=null,
    credit_sub_account_id=null,
    credit_tax_name=null,
    credit_department=null,
    notes=coalesce(notes,'') || ' / purchase共通分類へ移行'
where source_kind='card'
  and is_active=true;

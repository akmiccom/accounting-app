create index accounting_rules_debit_account_idx
  on accounting.accounting_rules (debit_account_id);

create index accounting_rules_debit_sub_account_idx
  on accounting.accounting_rules (debit_sub_account_id)
  where debit_sub_account_id is not null;

create index accounting_rules_credit_account_idx
  on accounting.accounting_rules (credit_account_id);

create index accounting_rules_credit_sub_account_idx
  on accounting.accounting_rules (credit_sub_account_id)
  where credit_sub_account_id is not null;

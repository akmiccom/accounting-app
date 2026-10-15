alter table accounting.accounting_rules
  add column debit_tax_name text,
  add column debit_department text,
  add column credit_tax_name text,
  add column credit_department text;

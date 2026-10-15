-- Extend accounting.receipts for Money Forward CloudBox index imports.
-- Purpose:
--   - Preserve external evidence references from Money Forward CloudBox
--   - Allow index-only receipt rows when the evidence file itself is not stored in Supabase Storage
--   - Track the import file that produced each receipt index row
--   - Prevent duplicate imports by source file ID

begin;

alter table accounting.receipts
  add column if not exists source_system text,
  add column if not exists source_record_id text,
  add column if not exists external_url text,
  add column if not exists import_file_id uuid;

alter table accounting.receipts
  add constraint receipts_import_file_id_fkey
  foreign key (import_file_id)
  references accounting.import_files(id);

create unique index if not exists receipts_source_record_unique
  on accounting.receipts (company_id, source_system, source_record_id)
  where source_record_id is not null;

-- CloudBox index rows can exist before the underlying evidence file is copied
-- into Supabase Storage, so these fields must be nullable.
alter table accounting.receipts
  alter column transaction_date drop not null,
  alter column supplier_name drop not null,
  alter column amount drop not null,
  alter column storage_bucket drop not null,
  alter column storage_path drop not null,
  alter column mime_type drop not null,
  alter column sha256 drop not null;

comment on column accounting.receipts.source_system is
  'Source system for externally indexed evidence, e.g. moneyforward_cloudbox.';

comment on column accounting.receipts.source_record_id is
  'Stable source-side identifier. For Money Forward CloudBox this is the file ID.';

comment on column accounting.receipts.external_url is
  'External source URL for the evidence file. May stop working after source-service changes; retained as an index/audit reference.';

comment on column accounting.receipts.import_file_id is
  'Import file that produced this receipt index row.';

commit;

-- Allow draft journals to be temporarily unbalanced while journal lines are being built.
-- Final balance is still enforced by accounting.validate_journal_posting()
-- when a journal transitions from draft -> posted.
--
-- Existing constraint accounting.journals_totals_nonnegative_check remains in place.

begin;

alter table accounting.journals
  drop constraint if exists journals_totals_check;

-- Safety check: posting validation trigger/function must still exist.
do $$
declare
  v_trigger_count integer;
  v_function_count integer;
begin
  select count(*)
    into v_trigger_count
  from pg_trigger t
  where t.tgrelid = 'accounting.journals'::regclass
    and not t.tgisinternal
    and pg_get_triggerdef(t.oid) ilike '%validate_journal_posting%';

  select count(*)
    into v_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'accounting'
    and p.proname = 'validate_journal_posting';

  if v_trigger_count < 1 or v_function_count <> 1 then
    raise exception
      'Posting validation safety check failed: trigger_count %, function_count %',
      v_trigger_count, v_function_count;
  end if;
end
$$;

commit;

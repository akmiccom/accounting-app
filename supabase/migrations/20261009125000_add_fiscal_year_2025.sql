-- Add FY2025 fiscal year for akmic合同会社
-- FY2025: 2025-11-01 through 2026-10-31
-- This is the currently open fiscal year, so is_closed=false.

begin;

insert into accounting.fiscal_years (
  company_id,
  name,
  start_date,
  end_date,
  is_closed
)
select
  c.id,
  '2025年度',
  date '2025-11-01',
  date '2026-10-31',
  false
from accounting.companies c
where c.name = 'akmic合同会社'
  and not exists (
    select 1
    from accounting.fiscal_years f
    where f.company_id = c.id
      and f.start_date = date '2025-11-01'
      and f.end_date = date '2026-10-31'
  );

do $$
declare
  v_count integer;
begin
  select count(*)
    into v_count
  from accounting.fiscal_years f
  join accounting.companies c
    on c.id = f.company_id
  where c.name = 'akmic合同会社'
    and f.name = '2025年度'
    and f.start_date = date '2025-11-01'
    and f.end_date = date '2026-10-31'
    and f.is_closed = false;

  if v_count <> 1 then
    raise exception 'Expected exactly one open FY2025 row, got %', v_count;
  end if;
end
$$;

commit;

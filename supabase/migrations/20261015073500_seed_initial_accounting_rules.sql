begin;

with c as (
  select id from accounting.companies where name='akmic合同会社' limit 1
),
a as (
  select a.id
  from accounting.accounts a
  join c on c.id=a.company_id
  where a.name='支払手数料'
  limit 1
)
insert into accounting.sub_accounts (
  company_id, account_id, code, name, source_system, source_record_id, is_active
)
select c.id, a.id, null, '会費', 'manual', 'accounting-rule-subaccount:membership-fee', true
from c cross join a
where not exists (
  select 1
  from accounting.sub_accounts sa
  where sa.company_id=c.id and sa.account_id=a.id and sa.name='会費'
);

with c as (
  select id from accounting.companies where name='akmic合同会社' limit 1
),
rule_input(
  name, match_value, debit_account_name, debit_sub_name, history_count, notes
) as (
  values
    ('セブン－イレブン','セブン－イレブン','会議費','会議飲食代',42,'コンビニ'),
    ('ファミリーマート','ファミリーマート','会議費','会議飲食代',30,'コンビニ'),
    ('ヤオコー 一本松南店','ヤオコー　一本松南店','備品・消耗品費','コーヒーなど',19,'スーパー'),
    ('まいばすけっと','まいばすけっと','備品・消耗品費','コーヒーなど',12,'スーパー'),
    ('ローソン','ローソン','会議費','会議飲食代',12,'コンビニ'),
    ('OPENAI ChatGPT','OPENAI *CHATGPT SUBSCR (OPENAI.COM )','支払手数料','会費',10,'SaaS会費'),
    ('マクドナルドモバイルオーダー','マクドナルドモバイルオーダー','会議費','テレワーク費',10,'テレワーク'),
    ('ベイシア','ベイシア','備品・消耗品費','コーヒーなど',7,'スーパー'),
    ('スターバックスコーヒージャパン','スターバックスコーヒージャパン','会議費','テレワーク費',6,'テレワーク'),
    ('倉林スポーツ整体院','倉林スポーツ整体院','福利厚生費','予防医療',6,'福利厚生'),
    ('スパゲッティーのパンチョ渋谷店','スパゲッティーのパンチョ渋谷店','福利厚生費','昼食費',5,'レストラン/昼食'),
    ('ヘアデザイン ティアロ/NFC','ヘアデザイン　ティアロ／ＮＦＣ','福利厚生費','ヘアカット等',5,'福利厚生'),
    ('中華 萬来','中華　萬来','福利厚生費','残業食費',5,'レストラン/残業食')
),
resolved as (
  select
    c.id as company_id,
    ri.*,
    da.id as debit_account_id,
    dsa.id as debit_sub_account_id,
    ca.id as credit_account_id,
    csa.id as credit_sub_account_id
  from c
  join rule_input ri on true
  join accounting.accounts da
    on da.company_id=c.id and da.name=ri.debit_account_name
  join accounting.sub_accounts dsa
    on dsa.company_id=c.id and dsa.account_id=da.id and dsa.name=ri.debit_sub_name
  join accounting.accounts ca
    on ca.company_id=c.id and ca.name='未払金'
  join accounting.sub_accounts csa
    on csa.company_id=c.id and csa.account_id=ca.id
   and csa.name='三井住友カードご本人/代表会員オーナーズV'
)
insert into accounting.accounting_rules (
  company_id, name, source_kind, match_type, match_value, direction,
  debit_account_id, debit_sub_account_id,
  credit_account_id, credit_sub_account_id,
  priority, auto_post, is_active, notes
)
select
  r.company_id,
  r.name,
  'card',
  'exact',
  r.match_value,
  'outflow',
  r.debit_account_id,
  r.debit_sub_account_id,
  r.credit_account_id,
  r.credit_sub_account_id,
  100,
  false,
  true,
  '初期ルール。過去履歴=' || r.history_count || '件。分類=' || r.notes
from resolved r
where not exists (
  select 1
  from accounting.accounting_rules ar
  where ar.company_id=r.company_id
    and ar.source_kind='card'
    and ar.match_type='exact'
    and ar.match_value=r.match_value
    and ar.direction='outflow'
    and ar.is_active=true
);

commit;

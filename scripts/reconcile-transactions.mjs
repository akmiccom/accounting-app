import postgres from "postgres";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const preview = process.argv.includes("--preview") || process.argv.includes("--dry-run");
const databaseUrl = requiredEnv("DATABASE_URL");
const companyName = process.env.ACCOUNTING_COMPANY_NAME?.trim() || "akmic合同会社";

const sql = postgres(databaseUrl, {
  ssl: "require",
  max: 1,
  prepare: false,
});

async function getCompanyId() {
  const rows = await sql`
    select id
    from accounting.companies
    where name=${companyName}
  `;
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one company named "${companyName}", found ${rows.length}`);
  }
  return rows[0].id;
}

async function cardCandidates(companyId) {
  return sql`
    with fy as (
      select id
      from accounting.fiscal_years
      where company_id=${companyId}
        and is_closed=false
    ),
    card_journal as (
      select j.id journal_id,j.entry_date,j.voucher_no,j.description,jl.amount
      from accounting.journals j
      join fy on fy.id=j.fiscal_year_id
      join accounting.journal_lines jl on jl.journal_id=j.id
      join accounting.accounts a on a.id=jl.account_id
      left join accounting.sub_accounts sa on sa.id=jl.sub_account_id
      where j.source_system='moneyforward'
        and coalesce(j.source_data ? 'import_file_id', false)
        and not exists (
          select 1
          from accounting.card_transactions used_card
          where used_card.matched_journal_id=j.id
        )
        and not exists (
          select 1
          from accounting.reconciliation_group_journals used_group
          where used_group.journal_id=j.id
        )
        and a.name='未払金'
        and sa.name in (
          '三井住友カードご本人/代表会員オーナーズV',
          '三井住友カードご本人/代表会員オーナーズV NL'
        )
        and jl.side='credit'
    ),
    tx as (
      select c.id,c.used_date,c.amount,c.merchant_name
      from accounting.card_transaction_reconciliation_v c
      where c.company_id=${companyId}
        and c.reconciliation_status='unmatched'
    ),
    pairs as (
      select
        tx.id transaction_id,
        cj.journal_id,
        tx.used_date transaction_date,
        tx.amount,
        tx.merchant_name transaction_description,
        cj.voucher_no,
        cj.description journal_description,
        count(*) over(partition by tx.id) transaction_candidate_count,
        count(*) over(partition by cj.journal_id) journal_candidate_count
      from tx
      join card_journal cj
        on cj.entry_date=tx.used_date
       and cj.amount=tx.amount
    )
    select *
    from pairs
    where transaction_candidate_count=1
      and journal_candidate_count=1
    order by transaction_date,transaction_id
  `;
}

async function bankCandidates(companyId) {
  return sql`
    with fy as (
      select id
      from accounting.fiscal_years
      where company_id=${companyId}
        and is_closed=false
    ),
    bank_account as (
      select a.id account_id,sa.id sub_account_id
      from accounting.accounts a
      join accounting.sub_accounts sa
        on sa.account_id=a.id and sa.company_id=a.company_id
      where a.company_id=${companyId}
        and a.name='普通預金'
        and sa.name='GMOあおぞらネット銀行法人第二営業部普通預金(有利息)11'
    ),
    bank_journal as (
      select
        j.id journal_id,
        j.entry_date,
        j.voucher_no,
        j.description,
        case when jl.side='debit' then jl.amount else -jl.amount end signed_amount
      from accounting.journals j
      join fy on fy.id=j.fiscal_year_id
      join accounting.journal_lines jl on jl.journal_id=j.id
      join bank_account ba
        on ba.account_id=jl.account_id
       and ba.sub_account_id=jl.sub_account_id
      where j.source_system='moneyforward'
        and coalesce(j.source_data ? 'import_file_id', false)
        and not exists (
          select 1
          from accounting.bank_transactions used_bank
          where used_bank.matched_journal_id=j.id
        )
    ),
    tx as (
      select b.id,b.transaction_date,b.amount,b.description
      from accounting.bank_transaction_reconciliation_v b
      where b.company_id=${companyId}
        and b.effective_reconciliation_status in ('unmatched','pending_journal')
    ),
    pairs as (
      select
        tx.id transaction_id,
        bj.journal_id,
        tx.transaction_date,
        tx.amount,
        tx.description transaction_description,
        bj.voucher_no,
        bj.description journal_description,
        count(*) over(partition by tx.id) transaction_candidate_count,
        count(*) over(partition by bj.journal_id) journal_candidate_count
      from tx
      join bank_journal bj
        on bj.entry_date=tx.transaction_date
       and bj.signed_amount=tx.amount
    )
    select *
    from pairs
    where transaction_candidate_count=1
      and journal_candidate_count=1
    order by transaction_date,transaction_id
  `;
}

try {
  const companyId = await getCompanyId();
  const cards = await cardCandidates(companyId);
  const banks = await bankCandidates(companyId);

  console.log(`Reconciliation candidates: card=${cards.length}, bank=${banks.length}, total=${cards.length + banks.length}`);

  for (const row of cards) {
    console.log(
      `[card] ${String(row.transaction_date).slice(0, 10)} ¥${row.amount} ${row.transaction_description} -> voucher ${row.voucher_no} ${row.journal_description ?? ""}`
    );
  }
  for (const row of banks) {
    console.log(
      `[bank] ${String(row.transaction_date).slice(0, 10)} ¥${row.amount} ${row.transaction_description ?? ""} -> voucher ${row.voucher_no} ${row.journal_description ?? ""}`
    );
  }

  if (preview) {
    console.log("Preview mode: database write skipped.");
  } else {
    const result = await sql.begin(async (tx) => {
      let cardMatched = 0;
      let bankMatched = 0;

      for (const row of cards) {
        const updated = await tx`
          update accounting.card_transactions
          set matched_journal_id=${row.journal_id}
          where id=${row.transaction_id}
            and matched_journal_id is null
          returning id
        `;
        cardMatched += updated.length;
      }

      for (const row of banks) {
        const updated = await tx`
          update accounting.bank_transactions
          set matched_journal_id=${row.journal_id}
          where id=${row.transaction_id}
            and matched_journal_id is null
          returning id
        `;
        bankMatched += updated.length;
      }

      return { cardMatched, bankMatched };
    });

    console.log(
      `Reconciled: card=${result.cardMatched}, bank=${result.bankMatched}, total=${result.cardMatched + result.bankMatched}`
    );
  }
} finally {
  await sql.end();
}

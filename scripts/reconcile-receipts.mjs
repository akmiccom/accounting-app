import postgres from "postgres";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ーｰ−]/g, "-")
    .replace(/[／]/g, "/")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();
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

async function getReceipts(companyId) {
  return sql`
    select
      r.id,
      r.receipt_code,
      r.transaction_date,
      r.supplier_name,
      r.amount,
      r.source_system
    from accounting.receipts r
    join accounting.fiscal_years fy
      on fy.company_id=r.company_id
     and r.transaction_date between fy.start_date and fy.end_date
     and fy.is_closed=false
    where r.company_id=${companyId}
      and r.transaction_date is not null
      and r.amount is not null
      and not exists (
        select 1
        from accounting.journal_receipts jr
        where jr.receipt_id=r.id
      )
    order by r.transaction_date,r.receipt_code
  `;
}

async function getJournalCandidates(companyId, receipt) {
  const rows = await sql`
    select
      j.id,
      j.entry_date,
      j.voucher_no,
      j.description,
      j.memo,
      j.status,
      j.total_debit,
      j.source_system
    from accounting.journals j
    where j.company_id=${companyId}
      and j.entry_date=${receipt.transaction_date}
      and j.total_debit=${receipt.amount}
      and j.status in ('draft','posted')
      and not exists (
        select 1
        from accounting.journal_receipts jr
        where jr.journal_id=j.id
      )
    order by j.voucher_no,j.id
  `;

  const supplier = normalizeText(receipt.supplier_name);
  if (!supplier) return rows.length === 1 ? rows : [];

  const textMatches = rows.filter((row) => {
    const description = normalizeText(row.description);
    const memo = normalizeText(row.memo);
    if (!description && !memo) return false;
    return (
      description === supplier ||
      description.includes(supplier) ||
      supplier.includes(description) ||
      memo === supplier ||
      memo.includes(supplier) ||
      supplier.includes(memo)
    );
  });

  return textMatches.length === 1 ? textMatches : [];
}

try {
  const companyId = await getCompanyId();
  const receipts = await getReceipts(companyId);
  const candidates = [];
  let incomplete = 0;
  let ambiguousOrNoMatch = 0;

  for (const receipt of receipts) {
    if (!receipt.transaction_date || receipt.amount == null) {
      incomplete += 1;
      continue;
    }

    const journals = await getJournalCandidates(companyId, receipt);
    if (journals.length !== 1) {
      ambiguousOrNoMatch += 1;
      continue;
    }

    candidates.push({
      receipt,
      journal: journals[0],
    });
  }

  console.log(
    `Receipt reconciliation: inspected=${receipts.length}, candidates=${candidates.length}, unmatched_or_ambiguous=${ambiguousOrNoMatch}, incomplete=${incomplete}`
  );

  for (const item of candidates) {
    const r = item.receipt;
    const j = item.journal;
    console.log(
      `[receipt] ${String(r.transaction_date).slice(0, 10)} ¥${r.amount} ${r.supplier_name ?? ""} (${r.receipt_code}) -> voucher ${j.voucher_no} ${j.description ?? ""}`
    );
  }

  if (preview) {
    console.log("Preview mode: database write skipped.");
  } else {
    const linked = await sql.begin(async (tx) => {
      let count = 0;

      for (const item of candidates) {
        const inserted = await tx`
          insert into accounting.journal_receipts (
            journal_id,
            receipt_id,
            relation_type
          )
          select
            ${item.journal.id},
            ${item.receipt.id},
            'evidence'
          where not exists (
            select 1
            from accounting.journal_receipts jr
            where jr.receipt_id=${item.receipt.id}
          )
            and not exists (
              select 1
              from accounting.journal_receipts jr
              where jr.journal_id=${item.journal.id}
            )
          on conflict do nothing
          returning receipt_id
        `;
        count += inserted.length;
      }

      return count;
    });

    console.log(`Receipt links created: ${linked}/${candidates.length}`);
  }
} finally {
  await sql.end();
}

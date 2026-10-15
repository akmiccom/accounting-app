import { createHash } from "node:crypto";
import postgres from "postgres";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function defaultFrom(to) {
  const date = new Date(`${to}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 14);
  return isoDate(date);
}

function signedAmount(transactionType, amount) {
  const value = Math.abs(Number(amount));
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  if (transactionType === "1") return value;
  if (transactionType === "2") return -value;
  throw new Error(`Unknown transactionType: ${transactionType}`);
}

function rowHash(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

const databaseUrl = requiredEnv("DATABASE_URL");
const accessToken = requiredEnv("GMO_BANK_API_ACCESS_TOKEN");
const accountId = requiredEnv("GMO_BANK_API_ACCOUNT_ID");
const companyName = process.env.ACCOUNTING_COMPANY_NAME?.trim() || "akmic合同会社";
const sourceSystem = process.env.GMO_BANK_API_SOURCE_SYSTEM?.trim() || "gmo_aozora_sunabar_api";
const baseUrl = (
  process.env.GMO_BANK_API_BASE_URL?.trim() ||
  "https://api.sunabar.gmo-aozora.com/corporation/v1"
).replace(/\/$/, "");

const to = arg("to") || isoDate(new Date());
const from = arg("from") || defaultFrom(to);
const preview = process.argv.includes("--preview") || process.argv.includes("--dry-run");

if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  throw new Error("--from and --to must be YYYY-MM-DD");
}

async function fetchTransactions() {
  const all = [];
  let nextItemKey = null;

  for (;;) {
    const url = new URL(`${baseUrl}/accounts/transactions`);
    url.searchParams.set("accountId", accountId);
    url.searchParams.set("dateFrom", from);
    url.searchParams.set("dateTo", to);
    if (nextItemKey) url.searchParams.set("nextItemKey", nextItemKey);

    const response = await fetch(url, {
      headers: {
        accept: "application/json;charset=UTF-8",
        "x-access-token": accessToken,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GMO API ${response.status}: ${body}`);
    }

    const body = await response.json();
    all.push(...(body.transactions ?? []));

    const hasNext = body.hasNext === true || body.hasNext === "true";
    if (!hasNext) break;
    if (!body.nextItemKey) throw new Error("hasNext=true but nextItemKey is missing");
    nextItemKey = body.nextItemKey;
  }

  return all;
}

const transactions = await fetchTransactions();
console.log(`GMO API: ${from} - ${to}, ${transactions.length} transaction(s)`);

if (preview) {
  console.log("Preview mode: database write skipped.");
  console.dir(transactions, { depth: null });
  process.exit(0);
}

const sql = postgres(databaseUrl, {
  ssl: "require",
  max: 1,
  prepare: false,
});

try {
  const companies = await sql`
    select id, name
    from accounting.companies
    where name = ${companyName}
  `;

  if (companies.length !== 1) {
    throw new Error(
      `Expected exactly one company named "${companyName}", found ${companies.length}`
    );
  }

  const companyId = companies[0].id;

  let processed = 0;

  await sql.begin(async (tx) => {
    for (const item of transactions) {
      if (!item.itemKey) {
        throw new Error(
          `itemKey is missing for transaction ${item.transactionDate ?? "unknown"}`
        );
      }

      const sourceRecordId = `${accountId}:${item.itemKey}`;
      const amount = signedAmount(String(item.transactionType), item.amount);
      const stable = {
        sourceRecordId,
        transactionDate: item.transactionDate,
        valueDate: item.valueDate,
        transactionType: String(item.transactionType),
        amount: String(item.amount),
        remarks: item.remarks ?? null,
        balance: item.balance ?? null,
      };

      const rawData = {
        accountId,
        source: sourceSystem,
        apiPeriod: { from, to },
        transaction: item,
      };

      await tx`
        insert into accounting.bank_transactions (
          company_id,
          import_file_id,
          source_system,
          transaction_date,
          amount,
          description,
          balance,
          source_record_id,
          source_row_hash,
          raw_data,
          reconciliation_status
        )
        values (
          ${companyId},
          null,
          ${sourceSystem},
          ${item.transactionDate},
          ${amount},
          ${item.remarks ?? null},
          ${item.balance == null ? null : Number(item.balance)},
          ${sourceRecordId},
          ${rowHash(stable)},
          ${tx.json(rawData)},
          'unmatched'
        )
        on conflict (company_id, source_system, source_record_id)
          where source_record_id is not null
        do update set
          transaction_date = excluded.transaction_date,
          amount = excluded.amount,
          description = excluded.description,
          balance = excluded.balance,
          source_row_hash = excluded.source_row_hash,
          raw_data = excluded.raw_data
      `;

      processed += 1;
    }
  });

  console.log(`bank_transactions: ${processed} row(s) upserted`);
} finally {
  await sql.end();
}

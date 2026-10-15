import postgres from "postgres";
import {
  GMO_API_SOURCE_SYSTEM,
  normalizeApiTransaction,
  previewDuplicateCount,
  saveBankTransactions,
} from "./lib/gmo-bank-common.mjs";

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

const databaseUrl = requiredEnv("DATABASE_URL");
const accessToken = requiredEnv("GMO_BANK_API_ACCESS_TOKEN");
const accountId = requiredEnv("GMO_BANK_API_ACCOUNT_ID");
const companyName =
  process.env.ACCOUNTING_COMPANY_NAME?.trim() || "akmic合同会社";
const sourceSystem =
  process.env.GMO_BANK_API_SOURCE_SYSTEM?.trim() || GMO_API_SOURCE_SYSTEM;
const baseUrl = (
  process.env.GMO_BANK_API_BASE_URL?.trim() ||
  "https://api.sunabar.gmo-aozora.com/corporation/v1"
).replace(/\/$/, "");

const to = arg("to") || isoDate(new Date());
const from = arg("from") || defaultFrom(to);
const preview =
  process.argv.includes("--preview") || process.argv.includes("--dry-run");

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
    if (!body.nextItemKey) {
      throw new Error("hasNext=true but nextItemKey is missing");
    }
    nextItemKey = body.nextItemKey;
  }

  return all;
}

const apiTransactions = await fetchTransactions();
const transactions = apiTransactions.map((item) =>
  normalizeApiTransaction(item, {
    accountId,
    apiPeriod: { from, to },
    sourceSystem,
  })
);

console.log(
  `GMO API: ${from} - ${to}, ${transactions.length} transaction(s)`
);

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
  const duplicateCount = await previewDuplicateCount(
    sql,
    companyId,
    transactions
  );

  if (preview) {
    console.log(
      `Preview mode: database write skipped. duplicates=${duplicateCount}, new=${
        transactions.length - duplicateCount
      }`
    );
    console.dir(transactions, { depth: null });
  } else {
    const result = await sql.begin((tx) =>
      saveBankTransactions(tx, {
        companyId,
        importFileId: null,
        transactions,
      })
    );

    console.log(
      `bank_transactions: inserted=${result.inserted}, updated=${result.updated}, duplicates=${result.duplicates}`
    );
  }
} finally {
  await sql.end();
}

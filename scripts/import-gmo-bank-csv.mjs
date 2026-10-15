import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import {
  GMO_CSV_SOURCE_SYSTEM,
  fileHash,
  transactionHash,
  previewDuplicateCount,
  saveBankTransactions,
} from "./lib/gmo-bank-common.mjs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function compactDate(value) {
  const v = String(value ?? "").trim();
  if (!/^\d{8}$/.test(v)) throw new Error(`Invalid date: ${value}`);
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

function numberOrNull(value) {
  const v = String(value ?? "")
    .trim()
    .replace(/,/g, "");
  if (!v) return null;

  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${value}`);
  return n;
}

function extractTid(description) {
  const match = String(description ?? "").match(/TID[：:]\s*([0-9]+)/i);
  return match ? match[1] : null;
}

function normalizeRows(rows, filename) {
  if (rows.length < 2) throw new Error("CSV has no data rows");

  const header = rows[0].map((value) => value.trim());
  const expected = ["日付", "摘要", "入金金額", "出金金額", "残高", "メモ"];

  if (expected.some((name, index) => header[index] !== name)) {
    throw new Error(`Unexpected CSV header: ${header.join(",")}`);
  }

  const transactions = [];
  const errors = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.every((value) => !String(value ?? "").trim())) continue;

    try {
      const [
        date,
        description,
        depositRaw,
        withdrawalRaw,
        balanceRaw,
        memo,
      ] = row;

      const deposit = numberOrNull(depositRaw);
      const withdrawal = numberOrNull(withdrawalRaw);

      if (deposit != null && withdrawal != null) {
        throw new Error("Both deposit and withdrawal are present");
      }
      if (deposit == null && withdrawal == null) {
        throw new Error("Both deposit and withdrawal are empty");
      }

      const transactionDate = compactDate(date);
      const amount =
        deposit != null ? Math.abs(deposit) : -Math.abs(withdrawal);
      const balance = numberOrNull(balanceRaw);
      const tid = extractTid(description);

      const transaction = {
        sourceSystem: GMO_CSV_SOURCE_SYSTEM,
        sourceRecordId: tid ? `tid:${tid}` : null,
        transactionDate,
        amount,
        description: description?.trim() || null,
        balance,
        rawData: {
          acquisitionMethod: "csv",
          file: filename,
          rowNo: i + 1,
          row: {
            日付: date ?? "",
            摘要: description ?? "",
            入金金額: depositRaw ?? "",
            出金金額: withdrawalRaw ?? "",
            残高: balanceRaw ?? "",
            メモ: memo ?? "",
          },
        },
      };

      transaction.sourceRowHash = transactionHash(transaction);
      transactions.push(transaction);
    } catch (error) {
      errors.push({
        rowNo: i + 1,
        message: error instanceof Error ? error.message : String(error),
        row,
      });
    }
  }

  return { transactions, errors };
}

const inputPath = process.argv.find(
  (value) =>
    !value.startsWith("--") &&
    value !== process.argv[0] &&
    value !== process.argv[1]
);

if (!inputPath) throw new Error("CSV file path is required");

const preview =
  process.argv.includes("--preview") || process.argv.includes("--dry-run");
const databaseUrl = requiredEnv("DATABASE_URL");
const companyName =
  process.env.ACCOUNTING_COMPANY_NAME?.trim() || "akmic合同会社";

const bytes = await fs.readFile(inputPath);
const sha256 = fileHash(bytes);
const csvText = new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
const rows = parseCsv(csvText);
const { transactions, errors } = normalizeRows(
  rows,
  path.basename(inputPath)
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

  console.log(`GMO CSV: ${inputPath}`);
  console.log("Encoding: CP932/Shift_JIS");
  console.log(
    `Rows: ${transactions.length}, duplicates: ${duplicateCount}, new: ${
      transactions.length - duplicateCount
    }, errors: ${errors.length}`
  );
  console.dir(transactions, { depth: null });
  if (errors.length) console.dir(errors, { depth: null });

  if (preview) {
    console.log("Preview mode: database write skipped.");
    if (errors.length) process.exitCode = 2;
  } else {
    if (errors.length) {
      throw new Error("CSV contains invalid rows; import aborted");
    }

    const storagePath = `bank/gmo/${sha256}/${path.basename(inputPath)}`;

    const result = await sql.begin(async (tx) => {
      let importFileId;

      const existingFile = await tx`
        select id
        from accounting.import_files
        where company_id = ${companyId}
          and source_system = ${GMO_CSV_SOURCE_SYSTEM}
          and sha256 = ${sha256}
        limit 1
      `;

      if (existingFile.length === 1) {
        importFileId = existingFile[0].id;
      } else {
        const inserted = await tx`
          insert into accounting.import_files (
            company_id,
            source_system,
            file_kind,
            storage_path,
            original_filename,
            sha256,
            row_count,
            import_metadata
          ) values (
            ${companyId},
            ${GMO_CSV_SOURCE_SYSTEM},
            'bank_statement_csv',
            ${storagePath},
            ${path.basename(inputPath)},
            ${sha256},
            ${transactions.length},
            ${tx.json({
              acquisition_method: "csv",
              encoding: "cp932",
              storage_object_present: false,
            })}
          )
          returning id
        `;
        importFileId = inserted[0].id;
      }

      return saveBankTransactions(tx, {
        companyId,
        importFileId,
        transactions,
      });
    });

    console.log(
      `bank_transactions: inserted=${result.inserted}, updated=${result.updated}, duplicates=${result.duplicates}`
    );
  }
} finally {
  await sql.end();
}

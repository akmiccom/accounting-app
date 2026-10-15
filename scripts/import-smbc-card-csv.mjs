import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";

const SOURCE_SYSTEM = "smbc_card_csv";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function parseDate(value) {
  const v = String(value ?? "").trim();
  const match = v.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseAmount(value) {
  const v = String(value ?? "").trim().replace(/,/g, "");
  if (!v) throw new Error("Amount is empty");
  const amount = Number(v);
  if (!Number.isFinite(amount)) throw new Error(`Invalid amount: ${value}`);
  return amount;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalRowHash({ usedDate, merchantName, amount, memo, occurrence }) {
  return sha256(
    JSON.stringify({
      usedDate,
      merchantName: normalizeText(merchantName),
      amount: Number(amount).toFixed(2),
      memo: normalizeText(memo),
      occurrence,
    })
  );
}

function normalizeRows(rows, filename) {
  if (rows.length < 2) throw new Error("CSV has no transaction rows");

  const metadata = {
    owner: rows[0]?.[0]?.trim() || null,
    maskedCard: rows[0]?.[1]?.trim() || null,
    cardName: rows[0]?.[2]?.trim() || null,
  };

  const occurrences = new Map();
  const transactions = [];
  const errors = [];

  for (let i = 1; i < rows.length; i += 1) {
    const columns = rows[i];
    if (columns.every((value) => !String(value ?? "").trim())) continue;

    const usedDate = parseDate(columns[0]);
    if (!usedDate) continue;

    try {
      const merchantName = String(columns[1] ?? "").trim();
      if (!merchantName) throw new Error("Merchant name is empty");

      const amount = parseAmount(columns[2]);
      const memo = String(columns[6] ?? "").trim();

      const baseKey = JSON.stringify({
        usedDate,
        merchantName: normalizeText(merchantName),
        amount: Number(amount).toFixed(2),
        memo: normalizeText(memo),
      });
      const occurrence = (occurrences.get(baseKey) ?? 0) + 1;
      occurrences.set(baseKey, occurrence);

      transactions.push({
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordId: `${filename}:${i + 1}`,
        usedDate,
        merchantName,
        amount,
        paymentDate: null,
        sourceRowHash: canonicalRowHash({
          usedDate,
          merchantName,
          amount,
          memo,
          occurrence,
        }),
        rawData: {
          acquisitionMethod: "csv",
          file: filename,
          rowNo: i + 1,
          columns,
          memo: memo || null,
          occurrence,
        },
      });
    } catch (error) {
      errors.push({
        rowNo: i + 1,
        message: error instanceof Error ? error.message : String(error),
        row: columns,
      });
    }
  }

  return { metadata, transactions, errors };
}

async function companyIdFor(sql, companyName) {
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

  return companies[0].id;
}

async function countDuplicates(sql, companyId, fileSha, transactions) {
  const importedFile = await sql`
    select id
    from accounting.import_files
    where company_id = ${companyId}
      and source_system = ${SOURCE_SYSTEM}
      and sha256 = ${fileSha}
    limit 1
  `;

  if (importedFile.length === 1) {
    return transactions.length;
  }

  let duplicates = 0;

  for (const transaction of transactions) {
    const existing = await sql`
      select id
      from accounting.card_transactions
      where company_id = ${companyId}
        and source_system = ${SOURCE_SYSTEM}
        and source_row_hash = ${transaction.sourceRowHash}
      limit 1
    `;
    if (existing.length === 1) duplicates += 1;
  }

  return duplicates;
}

const inputPath = process.argv.find(
  (value) =>
    !value.startsWith("--") &&
    value !== process.argv[0] &&
    value !== process.argv[1]
);

if (!inputPath) throw new Error("SMBC card CSV file path is required");

const preview =
  process.argv.includes("--preview") || process.argv.includes("--dry-run");

const databaseUrl = requiredEnv("DATABASE_URL");
const companyName =
  process.env.ACCOUNTING_COMPANY_NAME?.trim() || "akmic合同会社";

const bytes = await fs.readFile(inputPath);
const fileSha = sha256(bytes);
const csvText = new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
const rows = parseCsv(csvText);
const filename = path.basename(inputPath);
const { metadata, transactions, errors } = normalizeRows(rows, filename);

const sql = postgres(databaseUrl, {
  ssl: "require",
  max: 1,
  prepare: false,
});

try {
  const companyId = await companyIdFor(sql, companyName);
  const duplicateCount = await countDuplicates(
    sql,
    companyId,
    fileSha,
    transactions
  );

  console.log(`SMBC CSV: ${inputPath}`);
  console.log("Encoding: CP932/Shift_JIS");
  console.log(
    `Card: ${metadata.maskedCard ?? "(unknown)"} / ${metadata.cardName ?? "(unknown)"}`
  );
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

    const storagePath = `card/smbc/${fileSha}/${filename}`;

    const result = await sql.begin(async (tx) => {
      let importFileId;
      let fileAlreadyImported = false;

      const existingFile = await tx`
        select id
        from accounting.import_files
        where company_id = ${companyId}
          and source_system = ${SOURCE_SYSTEM}
          and sha256 = ${fileSha}
        limit 1
      `;

      if (existingFile.length === 1) {
        importFileId = existingFile[0].id;
        fileAlreadyImported = true;
      } else {
        const insertedFile = await tx`
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
            ${SOURCE_SYSTEM},
            'card_statement_csv',
            ${storagePath},
            ${filename},
            ${fileSha},
            ${transactions.length},
            ${tx.json({
              acquisition_method: "csv",
              encoding: "cp932",
              owner: metadata.owner,
              masked_card: metadata.maskedCard,
              card_name: metadata.cardName,
              storage_object_present: false,
            })}
          )
          returning id
        `;
        importFileId = insertedFile[0].id;
      }

      if (fileAlreadyImported) {
        return {
          inserted: 0,
          duplicates: transactions.length,
        };
      }

      let inserted = 0;
      let duplicates = 0;

      for (const transaction of transactions) {
        const existing = await tx`
          select id
          from accounting.card_transactions
          where company_id = ${companyId}
            and source_system = ${SOURCE_SYSTEM}
            and source_row_hash = ${transaction.sourceRowHash}
          limit 1
        `;

        if (existing.length === 1) {
          duplicates += 1;
          continue;
        }

        const result = await tx`
          insert into accounting.card_transactions (
            company_id,
            import_file_id,
            source_system,
            used_date,
            merchant_name,
            amount,
            payment_date,
            source_record_id,
            source_row_hash,
            raw_data
          ) values (
            ${companyId},
            ${importFileId},
            ${SOURCE_SYSTEM},
            ${transaction.usedDate},
            ${transaction.merchantName},
            ${transaction.amount},
            ${transaction.paymentDate},
            ${transaction.sourceRecordId},
            ${transaction.sourceRowHash},
            ${tx.json(transaction.rawData)}
          )
          on conflict (company_id, source_system, source_row_hash) do nothing
          returning id
        `;

        if (result.length === 1) inserted += 1;
        else duplicates += 1;
      }

      return { inserted, duplicates };
    });

    console.log(
      `card_transactions: inserted=${result.inserted}, duplicates=${result.duplicates}`
    );
  }
} finally {
  await sql.end();
}

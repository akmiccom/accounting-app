import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const SOURCE_SYSTEM = "google_drive_receipt_json";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function checkDate(value, name) {
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--${name} must be YYYY-MM-DD`);
  }
  return value;
}

function transactionDate(value) {
  const text = String(value ?? "");
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function inRange(date, from, to) {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

const inputDir = process.argv.find(
  (value) =>
    !value.startsWith("--") &&
    value !== process.argv[0] &&
    value !== process.argv[1]
);

if (!inputDir) {
  throw new Error("Receipt JSON directory path is required");
}

const preview = process.argv.includes("--preview") || process.argv.includes("--dry-run");
const from = checkDate(arg("from"), "from");
const to = checkDate(arg("to"), "to");
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

async function loadReceiptJsons(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result = [];
  const errors = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;

    try {
      const filePath = path.join(dir, entry.name);
      const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
      const date = transactionDate(raw.transaction_at);
      if (!inRange(date, from, to)) continue;

      if (!raw.receipt_id) throw new Error("receipt_id is missing");
      if (!date) throw new Error("transaction_at is missing or invalid");
      if (!raw.merchant) throw new Error("merchant is missing");
      if (raw.total == null || !Number.isFinite(Number(raw.total))) {
        throw new Error("total is missing or invalid");
      }

      result.push({
        jsonFilename: entry.name,
        receiptCode: String(raw.receipt_id),
        transactionDate: date,
        supplierName: String(raw.merchant),
        amount: Number(raw.total),
        originalFilename:
          raw.source_original_name || `${raw.receipt_id}.jpg`,
        mimeType: raw.source_mime_type || "image/jpeg",
        sha256: raw.other?.source_sha256 || null,
        capturedAt: raw.received_at || null,
        sourceRecordId:
          raw.source_file_id || `receipt:${raw.receipt_id}`,
        externalUrl: raw.source_file_id
          ? `https://drive.google.com/file/d/${raw.source_file_id}/view`
          : null,
        sourceMetadata: raw,
      });
    } catch (error) {
      errors.push({
        file: entry.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { receipts: result, errors };
}

async function existingReceipt(companyId, receipt) {
  const rows = await sql`
    select id, receipt_code
    from accounting.receipts
    where company_id=${companyId}
      and (
        receipt_code=${receipt.receiptCode}
        or (
          source_system=${SOURCE_SYSTEM}
          and source_record_id=${receipt.sourceRecordId}
        )
      )
    limit 1
  `;
  return rows[0] ?? null;
}

try {
  const companyId = await getCompanyId();
  const { receipts, errors } = await loadReceiptJsons(inputDir);

  const newReceipts = [];
  let duplicates = 0;

  for (const receipt of receipts) {
    const existing = await existingReceipt(companyId, receipt);
    if (existing) {
      duplicates += 1;
      continue;
    }
    newReceipts.push(receipt);
  }

  console.log(
    `Drive receipt sync: inspected=${receipts.length}, new=${newReceipts.length}, duplicates=${duplicates}, errors=${errors.length}`
  );

  for (const receipt of newReceipts) {
    console.log(
      `[receipt] ${receipt.transactionDate} ¥${receipt.amount} ${receipt.supplierName} (${receipt.receiptCode})`
    );
  }
  if (errors.length) console.dir(errors, { depth: null });

  if (preview) {
    console.log("Preview mode: database write skipped.");
    if (errors.length) process.exitCode = 2;
  } else {
    if (errors.length) {
      throw new Error("Receipt JSON contains invalid files; import aborted");
    }

    const inserted = await sql.begin(async (tx) => {
      let count = 0;

      for (const receipt of newReceipts) {
        const rows = await tx`
          insert into accounting.receipts (
            company_id,
            receipt_code,
            transaction_date,
            supplier_name,
            amount,
            currency,
            document_kind,
            storage_bucket,
            storage_path,
            original_filename,
            mime_type,
            sha256,
            captured_at,
            source_metadata,
            source_system,
            source_record_id,
            external_url
          ) values (
            ${companyId},
            ${receipt.receiptCode},
            ${receipt.transactionDate},
            ${receipt.supplierName},
            ${receipt.amount},
            'JPY',
            'paper_scan',
            'accounting-receipts',
            null,
            ${receipt.originalFilename},
            ${receipt.mimeType},
            ${receipt.sha256},
            ${receipt.capturedAt},
            ${tx.json({
              ...receipt.sourceMetadata,
              drive_json_filename: receipt.jsonFilename,
              sync_method: "local_google_drive_folder",
            })},
            ${SOURCE_SYSTEM},
            ${receipt.sourceRecordId},
            ${receipt.externalUrl}
          )
          on conflict do nothing
          returning id
        `;
        count += rows.length;
      }

      return count;
    });

    console.log(`receipts inserted: ${inserted}/${newReceipts.length}`);
  }
} finally {
  await sql.end();
}

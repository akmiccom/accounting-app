import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";

const IMPORT_SOURCE = "moneyforward_journal_csv";
const JOURNAL_SOURCE = "moneyforward";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/\s/g, "");
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

  if (quoted) throw new Error("CSV has an unclosed quoted field");

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function decodeCsv(bytes) {
  try {
    return {
      encoding: "utf-8",
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return {
      encoding: "cp932",
      text: new TextDecoder("shift_jis", { fatal: true }).decode(bytes),
    };
  }
}

function headerIndex(headers, aliases, required = false) {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const index = normalized.indexOf(normalizeHeader(alias));
    if (index >= 0) return index;
  }
  if (required) {
    throw new Error(`Missing required CSV column: ${aliases[0]}`);
  }
  return -1;
}

function valueAt(row, index) {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function parseDate(value) {
  const text = normalizeText(value);
  let match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!match) match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) throw new Error(`Invalid date: ${value}`);
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseAmount(value, label) {
  const text = String(value ?? "")
    .replace(/[￥¥,]/g, "")
    .trim();
  if (!text) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return amount;
}

function isTruthyAdjustment(value) {
  const text = normalizeText(value).toLowerCase();
  return ["1", "true", "yes", "有", "あり", "決算整理", "決算整理仕訳"].includes(text);
}

function canonicalText(value) {
  return normalizeText(value).toLowerCase();
}

function lineSignature(line) {
  return [
    line.lineNo,
    line.side,
    canonicalText(line.accountName),
    canonicalText(line.subAccountName),
    Number(line.amount).toFixed(2),
    canonicalText(line.memo),
    canonicalText(line.department),
    canonicalText(line.taxName),
    canonicalText(line.partnerName),
  ].join("|");
}

function journalFingerprint(journal) {
  return JSON.stringify({
    entryDate: journal.entryDate,
    voucherNo: String(journal.voucherNo),
    description: canonicalText(journal.description),
    memo: canonicalText(journal.memo),
    entryKind: journal.entryKind,
    lines: [...journal.lines].sort((a, b) => {
      if (a.lineNo !== b.lineNo) return a.lineNo - b.lineNo;
      return a.side.localeCompare(b.side);
    }).map(lineSignature),
  });
}

function buildHeaderMap(headers) {
  return {
    voucherNo: headerIndex(headers, ["取引No", "取引NO", "取引番号"], true),
    entryDate: headerIndex(headers, ["取引日", "日付"], true),

    debitAccountCode: headerIndex(headers, ["借方勘定科目コード"]),
    debitAccountName: headerIndex(headers, ["借方勘定科目"], true),
    debitSubCode: headerIndex(headers, ["借方補助科目コード"]),
    debitSubName: headerIndex(headers, ["借方補助科目"]),
    debitDepartment: headerIndex(headers, ["借方部門名", "借方部門"]),
    debitPartner: headerIndex(headers, ["借方取引先名", "借方取引先"]),
    debitTaxName: headerIndex(headers, ["借方税区分"]),
    debitAmount: headerIndex(headers, ["借方金額(円)", "借方金額（円）", "借方金額"], true),

    creditAccountCode: headerIndex(headers, ["貸方勘定科目コード"]),
    creditAccountName: headerIndex(headers, ["貸方勘定科目"], true),
    creditSubCode: headerIndex(headers, ["貸方補助科目コード"]),
    creditSubName: headerIndex(headers, ["貸方補助科目"]),
    creditDepartment: headerIndex(headers, ["貸方部門名", "貸方部門"]),
    creditPartner: headerIndex(headers, ["貸方取引先名", "貸方取引先"]),
    creditTaxName: headerIndex(headers, ["貸方税区分"]),
    creditAmount: headerIndex(headers, ["貸方金額(円)", "貸方金額（円）", "貸方金額"], true),

    description: headerIndex(headers, ["摘要"]),
    memo: headerIndex(headers, ["仕訳メモ", "メモ"]),
    journalType: headerIndex(headers, ["MF仕訳タイプ"]),
    adjustment: headerIndex(headers, ["決算整理仕訳"]),
    updatedAt: headerIndex(headers, ["最終更新日時"]),
    updatedBy: headerIndex(headers, ["最終更新者"]),
  };
}

function normalizeRows(rows, filename) {
  if (rows.length < 2) throw new Error("CSV has no data rows");

  const headers = rows[0].map((value) => String(value ?? "").replace(/^\uFEFF/, "").trim());
  const map = buildHeaderMap(headers);
  const groups = new Map();
  const errors = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.every((value) => !String(value ?? "").trim())) continue;

    try {
      const voucherNo = valueAt(row, map.voucherNo);
      if (!voucherNo) throw new Error("取引No is empty");

      const entryDate = parseDate(valueAt(row, map.entryDate));
      const debitAmount = parseAmount(valueAt(row, map.debitAmount), "借方金額");
      const creditAmount = parseAmount(valueAt(row, map.creditAmount), "貸方金額");

      if (debitAmount == null && creditAmount == null) {
        throw new Error("Both debit and credit amounts are empty");
      }

      const description = valueAt(row, map.description) || null;
      const memo = valueAt(row, map.memo) || null;
      const adjustment = valueAt(row, map.adjustment);
      const entryKind = isTruthyAdjustment(adjustment) ? "adjusting" : "regular";

      let group = groups.get(voucherNo);
      if (!group) {
        group = {
          voucherNo,
          entryDate,
          description,
          memo,
          entryKind,
          lines: [],
          rawRows: [],
          sourceUpdatedAt: valueAt(row, map.updatedAt) || null,
          sourceUpdatedBy: valueAt(row, map.updatedBy) || null,
        };
        groups.set(voucherNo, group);
      } else {
        if (group.entryDate !== entryDate) {
          throw new Error(`Transaction ${voucherNo} has multiple dates`);
        }
        if (!group.description && description) group.description = description;
        if (!group.memo && memo) group.memo = memo;
        if (entryKind === "adjusting") group.entryKind = "adjusting";
      }

      const lineNo = group.rawRows.length + 1;
      const rawData = {};
      for (let h = 0; h < headers.length; h += 1) {
        rawData[headers[h] || `column_${h + 1}`] = row[h] ?? "";
      }
      group.rawRows.push({ rowNo: i + 1, values: rawData });

      if (debitAmount != null) {
        const accountName = valueAt(row, map.debitAccountName);
        if (!accountName) throw new Error("Debit account name is empty");
        group.lines.push({
          lineNo,
          side: "debit",
          accountCode: valueAt(row, map.debitAccountCode) || null,
          accountName,
          subAccountCode: valueAt(row, map.debitSubCode) || null,
          subAccountName: valueAt(row, map.debitSubName) || null,
          amount: debitAmount,
          memo: description,
          department: valueAt(row, map.debitDepartment) || null,
          taxName: valueAt(row, map.debitTaxName) || null,
          partnerName: valueAt(row, map.debitPartner) || null,
        });
      }

      if (creditAmount != null) {
        const accountName = valueAt(row, map.creditAccountName);
        if (!accountName) throw new Error("Credit account name is empty");
        group.lines.push({
          lineNo,
          side: "credit",
          accountCode: valueAt(row, map.creditAccountCode) || null,
          accountName,
          subAccountCode: valueAt(row, map.creditSubCode) || null,
          subAccountName: valueAt(row, map.creditSubName) || null,
          amount: creditAmount,
          memo: description,
          department: valueAt(row, map.creditDepartment) || null,
          taxName: valueAt(row, map.creditTaxName) || null,
          partnerName: valueAt(row, map.creditPartner) || null,
        });
      }
    } catch (error) {
      errors.push({
        rowNo: i + 1,
        message: error instanceof Error ? error.message : String(error),
        row,
      });
    }
  }

  const journals = [];
  for (const group of groups.values()) {
    const debit = group.lines
      .filter((line) => line.side === "debit")
      .reduce((sum, line) => sum + line.amount, 0);
    const credit = group.lines
      .filter((line) => line.side === "credit")
      .reduce((sum, line) => sum + line.amount, 0);

    if (group.lines.length < 2 || debit <= 0 || Math.abs(debit - credit) > 0.0001) {
      errors.push({
        voucherNo: group.voucherNo,
        message: `Unbalanced journal: debit=${debit}, credit=${credit}`,
      });
      continue;
    }

    journals.push({
      ...group,
      totalDebit: debit,
      totalCredit: credit,
      sourceRecordId: `csv:${group.voucherNo}`,
      sourceData: {
        acquisition_method: "csv",
        file: filename,
        transaction_no: group.voucherNo,
        source_updated_at: group.sourceUpdatedAt,
        source_updated_by: group.sourceUpdatedBy,
        rows: group.rawRows,
      },
    });
  }

  return { headers, journals, errors };
}

async function companyIdFor(sql, companyName) {
  const rows = await sql`
    select id from accounting.companies where name=${companyName}
  `;
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one company named "${companyName}", found ${rows.length}`);
  }
  return rows[0].id;
}

async function fiscalYearFor(sql, companyId, entryDate) {
  const rows = await sql`
    select id,is_closed,start_date,end_date
    from accounting.fiscal_years
    where company_id=${companyId}
      and ${entryDate}::date between start_date and end_date
    order by start_date desc
    limit 1
  `;
  if (rows.length !== 1) throw new Error(`No fiscal year for ${entryDate}`);
  if (rows[0].is_closed) throw new Error(`Fiscal year is closed for ${entryDate}`);
  return rows[0].id;
}

async function loadMaster(sql, companyId) {
  const accounts = await sql`
    select id,code,name
    from accounting.accounts
    where company_id=${companyId} and is_active=true
  `;
  const subAccounts = await sql`
    select id,account_id,code,name
    from accounting.sub_accounts
    where company_id=${companyId} and is_active=true
  `;

  return { accounts, subAccounts };
}

function resolveAccount(master, line) {
  const normalizedName = canonicalText(line.accountName);
  let candidates = [];

  if (line.accountCode) {
    candidates = master.accounts.filter(
      (account) => canonicalText(account.code) === canonicalText(line.accountCode)
    );
  }
  if (candidates.length === 0) {
    candidates = master.accounts.filter(
      (account) => canonicalText(account.name) === normalizedName
    );
  }

  if (candidates.length !== 1) {
    throw new Error(
      `Account not uniquely resolved: ${line.accountCode ?? ""} ${line.accountName} (matches=${candidates.length})`
    );
  }

  const account = candidates[0];
  let subAccount = null;

  if (line.subAccountName || line.subAccountCode) {
    let subs = master.subAccounts.filter((sub) => sub.account_id === account.id);

    if (line.subAccountCode) {
      const byCode = subs.filter(
        (sub) => canonicalText(sub.code) === canonicalText(line.subAccountCode)
      );
      if (byCode.length) subs = byCode;
      else subs = [];
    }

    if (subs.length === 0 && line.subAccountName) {
      subs = master.subAccounts.filter(
        (sub) =>
          sub.account_id === account.id &&
          canonicalText(sub.name) === canonicalText(line.subAccountName)
      );
    }

    if (subs.length !== 1) {
      throw new Error(
        `Sub-account not uniquely resolved: ${line.accountName} / ${line.subAccountCode ?? ""} ${line.subAccountName ?? ""} (matches=${subs.length})`
      );
    }
    subAccount = subs[0];
  }

  return {
    ...line,
    accountId: account.id,
    resolvedAccountName: account.name,
    subAccountId: subAccount?.id ?? null,
    resolvedSubAccountName: subAccount?.name ?? null,
  };
}

async function existingJournal(sql, companyId, fiscalYearId, voucherNo) {
  const rows = await sql`
    select id,entry_date,voucher_no,description,memo,status,entry_kind,source_system,source_record_id
    from accounting.journals
    where company_id=${companyId}
      and fiscal_year_id=${fiscalYearId}
      and voucher_no=${voucherNo}
    limit 1
  `;
  if (!rows.length) return null;

  const journal = rows[0];
  const lines = await sql`
    select
      jl.line_no,jl.side,jl.amount,jl.memo,jl.department,jl.tax_name,jl.partner_name,
      a.name account_name,sa.name sub_account_name
    from accounting.journal_lines jl
    join accounting.accounts a on a.id=jl.account_id
    left join accounting.sub_accounts sa on sa.id=jl.sub_account_id
    where jl.journal_id=${journal.id}
    order by jl.line_no,jl.side
  `;

  return {
    ...journal,
    lines,
  };
}

function dbFingerprint(existing) {
  return JSON.stringify({
    entryDate: String(existing.entry_date).slice(0, 10),
    voucherNo: String(existing.voucher_no),
    description: canonicalText(existing.description),
    memo: canonicalText(existing.memo),
    entryKind: existing.entry_kind,
    lines: existing.lines.map((line) =>
      [
        line.line_no,
        line.side,
        canonicalText(line.account_name),
        canonicalText(line.sub_account_name),
        Number(line.amount).toFixed(2),
        canonicalText(line.memo),
        canonicalText(line.department),
        canonicalText(line.tax_name),
        canonicalText(line.partner_name),
      ].join("|")
    ),
  });
}

async function classify(sql, companyId, master, journals) {
  const result = [];
  for (const journal of journals) {
    try {
      const fiscalYearId = await fiscalYearFor(sql, companyId, journal.entryDate);
      const resolvedLines = journal.lines.map((line) => resolveAccount(master, line));
      const resolved = { ...journal, fiscalYearId, lines: resolvedLines };
      const existing = await existingJournal(
        sql,
        companyId,
        fiscalYearId,
        journal.voucherNo
      );

      if (!existing) {
        result.push({ action: "insert", journal: resolved });
        continue;
      }

      const same = dbFingerprint(existing) === journalFingerprint(resolved);
      if (same) {
        result.push({ action: "duplicate", journal: resolved, existing });
      } else if (existing.status === "draft" && existing.source_system === JOURNAL_SOURCE) {
        result.push({ action: "update_draft", journal: resolved, existing });
      } else {
        result.push({
          action: "conflict",
          journal: resolved,
          existing,
          reason: `Existing journal ${existing.status}/${existing.source_system} differs`,
        });
      }
    } catch (error) {
      result.push({
        action: "error",
        journal,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

async function insertJournal(tx, companyId, item) {
  const j = item.journal;

  const inserted = await tx`
    insert into accounting.journals (
      company_id,fiscal_year_id,entry_date,voucher_no,description,memo,status,
      total_debit,total_credit,source_system,source_record_id,source_data,entry_kind
    ) values (
      ${companyId},${j.fiscalYearId},${j.entryDate},${j.voucherNo},
      ${j.description},${j.memo},'draft',
      0,0,${JOURNAL_SOURCE},${j.sourceRecordId},${tx.json(j.sourceData)},${j.entryKind}
    )
    returning id
  `;
  const journalId = inserted[0].id;

  for (const line of j.lines) {
    await tx`
      insert into accounting.journal_lines (
        journal_id,line_no,account_id,sub_account_id,side,amount,memo,
        department,tax_name,partner_name
      ) values (
        ${journalId},${line.lineNo},${line.accountId},${line.subAccountId},
        ${line.side},${line.amount},${line.memo},
        ${line.department},${line.taxName},${line.partnerName}
      )
    `;
  }

  await tx`
    update accounting.journals
    set status='posted'
    where id=${journalId}
  `;

  return journalId;
}

async function updateDraftJournal(tx, item) {
  const j = item.journal;
  const journalId = item.existing.id;

  await tx`
    delete from accounting.journal_lines
    where journal_id=${journalId}
  `;

  await tx`
    update accounting.journals
    set entry_date=${j.entryDate},
        description=${j.description},
        memo=${j.memo},
        source_data=${tx.json(j.sourceData)},
        source_record_id=coalesce(source_record_id,${j.sourceRecordId}),
        entry_kind=${j.entryKind},
        updated_at=now()
    where id=${journalId}
      and status='draft'
      and source_system=${JOURNAL_SOURCE}
  `;

  for (const line of j.lines) {
    await tx`
      insert into accounting.journal_lines (
        journal_id,line_no,account_id,sub_account_id,side,amount,memo,
        department,tax_name,partner_name
      ) values (
        ${journalId},${line.lineNo},${line.accountId},${line.subAccountId},
        ${line.side},${line.amount},${line.memo},
        ${line.department},${line.taxName},${line.partnerName}
      )
    `;
  }

  await tx`
    update accounting.journals set status='posted' where id=${journalId}
  `;

  return journalId;
}

const inputPath = process.argv.find(
  (value) =>
    !value.startsWith("--") &&
    value !== process.argv[0] &&
    value !== process.argv[1]
);

if (!inputPath) {
  throw new Error("Money Forward journal CSV file path is required");
}

const preview =
  process.argv.includes("--preview") || process.argv.includes("--dry-run");
const databaseUrl = requiredEnv("DATABASE_URL");
const companyName =
  process.env.ACCOUNTING_COMPANY_NAME?.trim() || "akmic合同会社";

const bytes = await fs.readFile(inputPath);
const fileSha = sha256(bytes);
const decoded = decodeCsv(bytes);
const filename = path.basename(inputPath);
const rows = parseCsv(decoded.text);
const { headers, journals, errors: parseErrors } = normalizeRows(rows, filename);

const sql = postgres(databaseUrl, {
  ssl: "require",
  max: 1,
  prepare: false,
});

try {
  const companyId = await companyIdFor(sql, companyName);
  const master = await loadMaster(sql, companyId);
  const classified = await classify(sql, companyId, master, journals);

  const summary = {
    csvRows: Math.max(rows.length - 1, 0),
    journals: journals.length,
    inserts: classified.filter((x) => x.action === "insert").length,
    draftUpdates: classified.filter((x) => x.action === "update_draft").length,
    duplicates: classified.filter((x) => x.action === "duplicate").length,
    conflicts: classified.filter((x) => x.action === "conflict").length,
    errors:
      parseErrors.length + classified.filter((x) => x.action === "error").length,
  };

  console.log(`Money Forward journal CSV: ${inputPath}`);
  console.log(`Encoding: ${decoded.encoding}`);
  console.log(`Columns: ${headers.length}`);
  console.log("Summary:", summary);

  for (const item of classified) {
    if (item.action === "duplicate") continue;
    const j = item.journal;
    console.log(
      `[${item.action}] No=${j.voucherNo} ${j.entryDate} ${j.description ?? ""} debit=${j.totalDebit} credit=${j.totalCredit}${item.reason ? ` | ${item.reason}` : ""}`
    );
  }

  if (parseErrors.length) {
    console.log("CSV parse/validation errors:");
    console.dir(parseErrors, { depth: null });
  }

  if (preview) {
    console.log("Preview mode: database write skipped.");
    if (summary.errors || summary.conflicts) process.exitCode = 2;
  } else {
    if (summary.errors || summary.conflicts) {
      throw new Error(
        `Import aborted: errors=${summary.errors}, conflicts=${summary.conflicts}. Resolve them or use a corrected CSV first.`
      );
    }

    const storagePath = `journals/moneyforward/${fileSha}/${filename}`;

    const result = await sql.begin(async (tx) => {
      let importFileId;
      const existingFile = await tx`
        select id
        from accounting.import_files
        where company_id=${companyId}
          and source_system=${IMPORT_SOURCE}
          and sha256=${fileSha}
        limit 1
      `;

      if (existingFile.length) {
        importFileId = existingFile[0].id;
      } else {
        const insertedFile = await tx`
          insert into accounting.import_files (
            company_id,source_system,file_kind,storage_path,original_filename,
            sha256,row_count,import_metadata
          ) values (
            ${companyId},${IMPORT_SOURCE},'journal_csv',${storagePath},${filename},
            ${fileSha},${summary.csvRows},${tx.json({
              acquisition_method: "csv",
              encoding: decoded.encoding,
              storage_object_present: false,
              journal_count: summary.journals,
              columns: headers,
            })}
          )
          returning id
        `;
        importFileId = insertedFile[0].id;
      }

      let inserted = 0;
      let updated = 0;

      for (const item of classified) {
        if (item.action === "insert") {
          const id = await insertJournal(tx, companyId, item);
          await tx`
            update accounting.journals
            set source_data = coalesce(source_data,'{}'::jsonb)
              || ${tx.json({ import_file_id: importFileId, import_file_sha256: fileSha })}
            where id=${id}
          `;
          inserted += 1;
        } else if (item.action === "update_draft") {
          const id = await updateDraftJournal(tx, item);
          await tx`
            update accounting.journals
            set source_data = coalesce(source_data,'{}'::jsonb)
              || ${tx.json({ import_file_id: importFileId, import_file_sha256: fileSha })}
            where id=${id}
          `;
          updated += 1;
        }
      }

      return { inserted, updated };
    });

    console.log(
      `journals: inserted=${result.inserted}, updated=${result.updated}, duplicates=${summary.duplicates}`
    );
  }
} finally {
  await sql.end();
}

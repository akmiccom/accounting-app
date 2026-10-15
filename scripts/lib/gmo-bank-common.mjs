import { createHash } from "node:crypto";

export const GMO_API_SOURCE_SYSTEM = "gmo_aozora_sunabar_api";
export const GMO_CSV_SOURCE_SYSTEM = "gmo_aozora_bank_csv";

export function normalizeDescription(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function moneyKey(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric value: ${value}`);
  return n.toFixed(2);
}

export function canonicalTransactionPayload({ transactionDate, amount, description, balance }) {
  return {
    transactionDate,
    amount: moneyKey(amount),
    description: normalizeDescription(description),
    balance: moneyKey(balance),
  };
}

export function transactionHash(transaction) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalTransactionPayload(transaction)))
    .digest("hex");
}

export function fileHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function signedApiAmount(transactionType, amount) {
  const value = Math.abs(Number(amount));
  if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${amount}`);
  if (String(transactionType) === "1") return value;
  if (String(transactionType) === "2") return -value;
  throw new Error(`Unknown transactionType: ${transactionType}`);
}

export function normalizeApiTransaction(
  item,
  { accountId, apiPeriod, sourceSystem = GMO_API_SOURCE_SYSTEM }
) {
  if (!item.itemKey) {
    throw new Error(
      `itemKey is missing for transaction ${item.transactionDate ?? "unknown"}`
    );
  }

  const amount = signedApiAmount(item.transactionType, item.amount);
  return {
    sourceSystem,
    sourceRecordId: `${accountId}:${item.itemKey}`,
    transactionDate: item.transactionDate,
    amount,
    description: item.remarks ?? null,
    balance: item.balance == null ? null : Number(item.balance),
    sourceRowHash: transactionHash({
      transactionDate: item.transactionDate,
      amount,
      description: item.remarks ?? null,
      balance: item.balance == null ? null : Number(item.balance),
    }),
    rawData: {
      accountId,
      acquisitionMethod: "api",
      apiPeriod,
      transaction: item,
    },
  };
}

function sameBalance(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

export async function findEquivalentBankTransaction(tx, companyId, transaction) {
  const candidates = await tx`
    select id, source_system, source_record_id, transaction_date, amount, description, balance
    from accounting.bank_transactions
    where company_id = ${companyId}
      and source_system in (${GMO_API_SOURCE_SYSTEM}, ${GMO_CSV_SOURCE_SYSTEM})
      and transaction_date = ${transaction.transactionDate}
      and amount = ${transaction.amount}
  `;

  const normalizedDescription = normalizeDescription(transaction.description);
  return (
    candidates.find(
      (row) =>
        normalizeDescription(row.description) === normalizedDescription &&
        sameBalance(row.balance, transaction.balance)
    ) ?? null
  );
}

export async function saveBankTransactions(
  tx,
  { companyId, importFileId = null, transactions }
) {
  let inserted = 0;
  let updated = 0;
  let duplicates = 0;

  for (const transaction of transactions) {
    if (transaction.sourceRecordId) {
      const existing = await tx`
        select id
        from accounting.bank_transactions
        where company_id = ${companyId}
          and source_system = ${transaction.sourceSystem}
          and source_record_id = ${transaction.sourceRecordId}
        limit 1
      `;

      if (existing.length === 1) {
        await tx`
          update accounting.bank_transactions
          set transaction_date = ${transaction.transactionDate},
              amount = ${transaction.amount},
              description = ${transaction.description},
              balance = ${transaction.balance},
              source_row_hash = ${transaction.sourceRowHash},
              raw_data = ${tx.json(transaction.rawData)}
          where id = ${existing[0].id}
        `;
        updated += 1;
        continue;
      }
    }

    const equivalent = await findEquivalentBankTransaction(
      tx,
      companyId,
      transaction
    );
    if (equivalent) {
      duplicates += 1;
      continue;
    }

    const result = await tx`
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
      ) values (
        ${companyId},
        ${importFileId},
        ${transaction.sourceSystem},
        ${transaction.transactionDate},
        ${transaction.amount},
        ${transaction.description},
        ${transaction.balance},
        ${transaction.sourceRecordId},
        ${transaction.sourceRowHash},
        ${tx.json(transaction.rawData)},
        'unmatched'
      )
      on conflict (company_id, source_system, source_row_hash) do nothing
      returning id
    `;

    if (result.length === 1) inserted += 1;
    else duplicates += 1;
  }

  return { inserted, updated, duplicates };
}

export async function previewDuplicateCount(sql, companyId, transactions) {
  let duplicates = 0;

  for (const transaction of transactions) {
    if (transaction.sourceRecordId) {
      const existing = await sql`
        select id
        from accounting.bank_transactions
        where company_id = ${companyId}
          and source_system = ${transaction.sourceSystem}
          and source_record_id = ${transaction.sourceRecordId}
        limit 1
      `;
      if (existing.length === 1) {
        duplicates += 1;
        continue;
      }
    }

    const equivalent = await findEquivalentBankTransaction(
      sql,
      companyId,
      transaction
    );
    if (equivalent) duplicates += 1;
  }

  return duplicates;
}

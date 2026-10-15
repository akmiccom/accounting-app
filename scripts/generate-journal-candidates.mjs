import postgres from "postgres";

const AUTO_SOURCE = "auto_candidate";
const CARD_SOURCE = "smbc_card_csv";
const CARD_SUBACCOUNT = "三井住友カードご本人/代表会員オーナーズV";
const GMO_SUBACCOUNT_SOURCE_ID = "xQwY1B2EXE%2BJKn0HassIcg%3D%3D";

function arg(name) {
  const p = "--" + name + "=";
  const v = process.argv.find((x) => x.startsWith(p));
  return v ? v.slice(p.length) : null;
}
function env(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(name + " is required");
  return v;
}
function checkDate(v, name) {
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("--" + name + " must be YYYY-MM-DD");
  return v;
}
function key(r) {
  return [r.account_id, r.sub_account_id ?? "", r.tax_name ?? "", r.department ?? "", r.side ?? ""].join("|");
}
function oneVariant(rows) {
  const m = new Map();
  for (const r of rows) m.set(key(r), r);
  return [...m.values()];
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractVisaDebitMerchant(description) {
  const text = String(description ?? "").normalize("NFKC").trim();
  const match = text.match(/^Visaデビット利用\s+(.+?)\s+承認番号[:：]/i);
  return match ? match[1].trim() : null;
}

function ruleTextMatches(rule, text) {
  const value = normalizeMatchText(rule.match_value);
  const target = normalizeMatchText(text);
  if (rule.match_type === "exact") return target === value;
  if (rule.match_type === "contains") return target.includes(value);
  if (rule.match_type === "prefix") return target.startsWith(value);
  return false;
}

async function findAccountingRule(companyId, sourceKind, text, amount, direction, date) {
  const rows = await sql`
    select
      r.id,
      r.name,
      r.match_type,
      r.match_value,
      r.direction,
      r.priority,
      r.auto_post,
      da.id as debit_account_id,
      da.name as debit_account_name,
      dsa.id as debit_sub_account_id,
      dsa.name as debit_sub_account_name,
      r.debit_tax_name,
      r.debit_department,
      ca.id as credit_account_id,
      ca.name as credit_account_name,
      csa.id as credit_sub_account_id,
      csa.name as credit_sub_account_name,
      r.credit_tax_name,
      r.credit_department
    from accounting.accounting_rules r
    join accounting.accounts da on da.id = r.debit_account_id
    left join accounting.accounts ca on ca.id = r.credit_account_id
    left join accounting.sub_accounts dsa on dsa.id = r.debit_sub_account_id
    left join accounting.sub_accounts csa on csa.id = r.credit_sub_account_id
    where r.company_id = ${companyId}
      and r.source_kind = ${sourceKind}
      and r.is_active = true
      and (r.direction = 'any' or r.direction = ${direction})
      and (r.amount_min is null or ${amount} >= r.amount_min)
      and (r.amount_max is null or ${amount} <= r.amount_max)
      and (r.valid_from is null or ${date}::date >= r.valid_from)
      and (r.valid_to is null or ${date}::date <= r.valid_to)
    order by r.priority desc, r.created_at asc
  `;

  const matches = rows.filter((row) => ruleTextMatches(row, text));
  if (!matches.length) return { ok:false, reason:"no_rule" };

  const topPriority = matches[0].priority;
  const top = matches.filter((row) => row.priority === topPriority);
  const outcomeKey = (row) => [
    row.debit_account_id,
    row.debit_sub_account_id ?? "",
    row.debit_tax_name ?? "",
    row.debit_department ?? "",
    row.credit_account_id,
    row.credit_sub_account_id ?? "",
    row.credit_tax_name ?? "",
    row.credit_department ?? "",
  ].join("|");
  const outcomes = new Set(top.map(outcomeKey));
  if (outcomes.size > 1) {
    return { ok:false, reason:"ambiguous_rule", count:top.length };
  }

  const rule = top[0];
  return {
    ok:true,
    rule,
    debit:{
      account_id:rule.debit_account_id,
      account_name:rule.debit_account_name,
      sub_account_id:rule.debit_sub_account_id,
      sub_account_name:rule.debit_sub_account_name,
      tax_name:rule.debit_tax_name,
      department:rule.debit_department,
    },
    credit:{
      account_id:rule.credit_account_id,
      account_name:rule.credit_account_name,
      sub_account_id:rule.credit_sub_account_id,
      sub_account_name:rule.credit_sub_account_name,
      tax_name:rule.credit_tax_name,
      department:rule.credit_department,
    },
  };
}

const databaseUrl = env("DATABASE_URL");
const companyName = process.env.ACCOUNTING_COMPANY_NAME?.trim() || "akmic合同会社";
const source = arg("source") || "all";
const from = checkDate(arg("from"), "from");
const to = checkDate(arg("to"), "to");
const preview = process.argv.includes("--preview") || process.argv.includes("--dry-run");
if (!["all","card","bank"].includes(source)) throw new Error("--source must be all, card, or bank");

const sql = postgres(databaseUrl, { ssl:"require", max:1, prepare:false });

async function companyId() {
  const r = await sql`select id from accounting.companies where name = ${companyName}`;
  if (r.length !== 1) throw new Error("Expected exactly one company, found " + r.length);
  return r[0].id;
}
async function fiscalYear(companyId, date) {
  const r = await sql`
    select id, is_closed from accounting.fiscal_years
    where company_id=${companyId} and ${date}::date between start_date and end_date
    order by start_date desc limit 1
  `;
  if (r.length !== 1 || r[0].is_closed) return null;
  return r[0].id;
}
async function existing(companyId, sourceRecordId) {
  const r = await sql`
    select id from accounting.journals
    where company_id=${companyId} and source_system=${AUTO_SOURCE} and source_record_id=${sourceRecordId}
    limit 1
  `;
  return r[0] ?? null;
}
async function cardPayable(companyId) {
  const r = await sql`
    select a.id account_id, a.name account_name, sa.id sub_account_id, sa.name sub_account_name,
           null::text tax_name, null::text department
    from accounting.accounts a
    join accounting.sub_accounts sa on sa.account_id=a.id and sa.company_id=a.company_id
    where a.company_id=${companyId} and a.name='未払金' and sa.name=${CARD_SUBACCOUNT}
      and a.is_active and sa.is_active
  `;
  if (r.length !== 1) throw new Error("SMBC payable sub-account not uniquely found: " + r.length);
  return r[0];
}
async function bankAccount(companyId) {
  const r = await sql`
    select a.id account_id, a.name account_name, sa.id sub_account_id, sa.name sub_account_name,
           null::text tax_name, null::text department
    from accounting.accounts a
    join accounting.sub_accounts sa on sa.account_id=a.id and sa.company_id=a.company_id
    where a.company_id=${companyId} and a.name='普通預金'
      and sa.source_record_id=${GMO_SUBACCOUNT_SOURCE_ID}
      and a.is_active and sa.is_active
  `;
  if (r.length !== 1) throw new Error("GMO bank sub-account not uniquely found: " + r.length);
  return r[0];
}
async function learnCard(companyId, t) {
  const r = await sql`
    select a.id account_id, a.name account_name, jl.sub_account_id, sa.name sub_account_name,
           jl.tax_name, jl.department, 'debit'::text side, count(*)::int usage_count
    from accounting.card_transactions ct
    join accounting.journals j on j.id=ct.matched_journal_id
    join accounting.journal_lines jl on jl.journal_id=j.id and jl.side='debit'
    join accounting.accounts a on a.id=jl.account_id
    left join accounting.sub_accounts sa on sa.id=jl.sub_account_id
    where ct.company_id=${companyId} and ct.id<>${t.id}
      and ct.merchant_name=${t.merchant_name} and ct.matched_journal_id is not null
      and (select count(*) from accounting.journal_lines x where x.journal_id=j.id)=2
      and a.name<>'未払金'
    group by a.id,a.name,jl.sub_account_id,sa.name,jl.tax_name,jl.department
  `;
  const u = oneVariant(r);
  return u.length === 1 ? {ok:true,row:u[0]} : {ok:false,reason:u.length ? "ambiguous":"no_history"};
}
async function learnBank(companyId, t, bank) {
  const r = await sql`
    select a.id account_id, a.name account_name, jl.sub_account_id, sa.name sub_account_name,
           jl.tax_name, jl.department, jl.side, count(*)::int usage_count
    from accounting.bank_transactions bt
    join accounting.journals j on j.id=bt.matched_journal_id
    join accounting.journal_lines jl on jl.journal_id=j.id
    join accounting.accounts a on a.id=jl.account_id
    left join accounting.sub_accounts sa on sa.id=jl.sub_account_id
    where bt.company_id=${companyId} and bt.id<>${t.id}
      and bt.description=${t.description} and bt.matched_journal_id is not null
      and jl.account_id<>${bank.account_id}
      and (select count(*) from accounting.journal_lines x where x.journal_id=j.id)=2
    group by a.id,a.name,jl.sub_account_id,sa.name,jl.tax_name,jl.department,jl.side
  `;
  const u = oneVariant(r);
  if (u.length !== 1) return {ok:false,reason:u.length ? "ambiguous":"no_history"};
  const expected = Number(t.amount) > 0 ? "credit" : "debit";
  return u[0].side === expected ? {ok:true,row:u[0]} : {ok:false,reason:"side_mismatch"};
}
async function createDraft(tx, p) {
  const r = await tx`
    insert into accounting.journals
      (company_id,fiscal_year_id,entry_date,voucher_no,description,memo,status,total_debit,total_credit,
       source_system,source_record_id,source_data)
    values
      (${p.companyId},${p.fiscalYearId},${p.date},${p.voucherNo},${p.description},
       '自動生成された仕訳候補。確認後にpostedへ変更すること。','draft',${p.amount},${p.amount},
       ${AUTO_SOURCE},${p.sourceRecordId},${tx.json(p.sourceData)})
    on conflict (company_id,source_system,source_record_id) where source_record_id is not null
    do nothing returning id
  `;
  if (!r.length) return false;
  const id=r[0].id;
  await tx`
    insert into accounting.journal_lines
      (journal_id,line_no,account_id,sub_account_id,side,amount,memo,department,tax_name,partner_name)
    values
      (${id},1,${p.debit.account_id},${p.debit.sub_account_id ?? null},'debit',${p.amount},${p.description},
       ${p.debit.department ?? null},${p.debit.tax_name ?? null},${p.description}),
      (${id},2,${p.credit.account_id},${p.credit.sub_account_id ?? null},'credit',${p.amount},${p.description},
       ${p.credit.department ?? null},${p.credit.tax_name ?? null},${p.description})
  `;
  return true;
}

const summary={inspected:0,candidates:0,created:0,existing:0,ruleMatches:0,historyMatches:0,noHistory:0,ambiguous:0,ruleAmbiguous:0,other:0};
try {
  const cid=await companyId();
  const payable=(source==="all"||source==="card") ? await cardPayable(cid) : null;
  const bank=(source==="all"||source==="bank") ? await bankAccount(cid) : null;
  const cards=(source==="all"||source==="card") ? await sql`
    select id,used_date,merchant_name,amount
    from accounting.card_transaction_reconciliation_v
    where company_id=${cid} and reconciliation_status='unmatched'
      and (${from}::date is null or used_date>=${from}::date)
      and (${to}::date is null or used_date<=${to}::date)
    order by used_date,id
  ` : [];
  const banks=(source==="all"||source==="bank") ? await sql`
    select id,transaction_date,description,amount
    from accounting.bank_transaction_reconciliation_v
    where company_id=${cid} and effective_reconciliation_status='unmatched'
      and (${from}::date is null or transaction_date>=${from}::date)
      and (${to}::date is null or transaction_date<=${to}::date)
    order by transaction_date,id
  ` : [];
  const proposals=[];

  for (const t of cards) {
    summary.inspected++;
    const sr="card:"+t.id;
    if (await existing(cid,sr)) { summary.existing++; continue; }
    const fy=await fiscalYear(cid,t.used_date);
    if (!fy) { summary.other++; continue; }
    const amount=Number(t.amount);
    let rule=await findAccountingRule(cid,"purchase",t.merchant_name,amount,"outflow",t.used_date);
    let ruleKind="purchase";
    if (!rule.ok && rule.reason==="no_rule") {
      rule=await findAccountingRule(cid,"card",t.merchant_name,amount,"outflow",t.used_date);
      ruleKind="card";
    }
    if (rule.ok) {
      proposals.push({
        kind:"card", companyId:cid, fiscalYearId:fy, date:t.used_date, description:t.merchant_name,
        amount, debit:rule.debit, credit:payable, sourceRecordId:sr,
        voucherNo:"AUTO-CARD-"+t.id,
        sourceData:{
          candidate_kind:"card",
          transaction_id:t.id,
          classification_method:"accounting_rule",
          accounting_rule_kind:ruleKind,
          accounting_rule_id:rule.rule.id,
          accounting_rule_name:rule.rule.name,
          auto_post_requested:rule.rule.auto_post,
          review_required:true
        }
      });
      summary.ruleMatches++;
      summary.candidates++;
      continue;
    }
    if (rule.reason==="ambiguous_rule") {
      summary.ruleAmbiguous++;
      continue;
    }
    const l=await learnCard(cid,t);
    if (!l.ok) { l.reason==="no_history" ? summary.noHistory++ : summary.ambiguous++; continue; }
    proposals.push({
      kind:"card", companyId:cid, fiscalYearId:fy, date:t.used_date, description:t.merchant_name,
      amount, debit:l.row, credit:payable, sourceRecordId:sr,
      voucherNo:"AUTO-CARD-"+t.id,
      sourceData:{
        candidate_kind:"card",
        transaction_id:t.id,
        classification_method:"history",
        history_count:l.row.usage_count,
        review_required:true
      }
    });
    summary.historyMatches++;
    summary.candidates++;
  }

  for (const t of banks) {
    summary.inspected++;
    const sr="bank:"+t.id;
    if (await existing(cid,sr)) { summary.existing++; continue; }
    const fy=await fiscalYear(cid,t.transaction_date);
    if (!fy) { summary.other++; continue; }
    const signedAmount=Number(t.amount);
    const amount=Math.abs(signedAmount);
    const direction=signedAmount<0 ? "outflow" : "inflow";
    const debitMerchant = signedAmount < 0 ? extractVisaDebitMerchant(t.description) : null;
    let rule;
    let ruleKind;
    if (debitMerchant) {
      rule=await findAccountingRule(cid,"purchase",debitMerchant,amount,"outflow",t.transaction_date);
      ruleKind="purchase";
    } else {
      rule={ok:false,reason:"no_rule"};
    }
    if (!rule.ok && rule.reason==="no_rule") {
      rule=await findAccountingRule(cid,"bank",t.description || "",amount,direction,t.transaction_date);
      ruleKind="bank";
    }
    if (rule.ok) {
      proposals.push({
        kind:debitMerchant ? "debit" : "bank",
        companyId:cid, fiscalYearId:fy, date:t.transaction_date,
        description:debitMerchant || t.description || "銀行取引",
        amount,
        debit:rule.debit,
        credit:debitMerchant ? bank : rule.credit,
        sourceRecordId:sr,
        voucherNo:"AUTO-BANK-"+t.id,
        sourceData:{
          candidate_kind:debitMerchant ? "debit_card" : "bank",
          transaction_id:t.id,
          original_bank_description:t.description,
          normalized_merchant:debitMerchant,
          classification_method:"accounting_rule",
          accounting_rule_kind:ruleKind,
          accounting_rule_id:rule.rule.id,
          accounting_rule_name:rule.rule.name,
          auto_post_requested:rule.rule.auto_post,
          review_required:true
        }
      });
      summary.ruleMatches++;
      summary.candidates++;
      continue;
    }
    if (rule.reason==="ambiguous_rule") {
      summary.ruleAmbiguous++;
      continue;
    }
    const l=await learnBank(cid,t,bank);
    if (!l.ok) { l.reason==="no_history" ? summary.noHistory++ : l.reason==="ambiguous" ? summary.ambiguous++ : summary.other++; continue; }
    const out=signedAmount<0;
    proposals.push({
      kind:"bank", companyId:cid, fiscalYearId:fy, date:t.transaction_date, description:t.description || "銀行取引",
      amount, debit:out ? l.row : bank, credit:out ? bank : l.row,
      sourceRecordId:sr, voucherNo:"AUTO-BANK-"+t.id,
      sourceData:{
        candidate_kind:"bank",
        transaction_id:t.id,
        classification_method:"history",
        history_count:l.row.usage_count,
        review_required:true
      }
    });
    summary.historyMatches++;
    summary.candidates++;
  }

  console.log("Journal candidates:",summary);
  for (const p of proposals) {
    const basis = p.sourceData.classification_method === "accounting_rule"
      ? "| rule="+p.sourceData.accounting_rule_name
      : "| history="+p.sourceData.history_count;
    console.log("["+p.kind+"]",p.date,p.description,p.amount+"円",
      "| 借方="+p.debit.account_name+(p.debit.sub_account_name?"/"+p.debit.sub_account_name:""),
      "| 貸方="+p.credit.account_name+(p.credit.sub_account_name?"/"+p.credit.sub_account_name:""),
      basis);
  }
  if (preview) {
    console.log("Preview mode: journal writes skipped.");
  } else {
    await sql.begin(async (tx) => {
      for (const p of proposals) if (await createDraft(tx,p)) summary.created++;
    });
    console.log("draft journals created:",summary.created,"/",summary.candidates);
  }
} finally {
  await sql.end();
}

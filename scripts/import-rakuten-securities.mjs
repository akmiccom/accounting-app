import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import postgres from "postgres";

const SOURCE_SYSTEM = "rakuten_securities";
const COMPANY_NAME = process.env.ACCOUNTING_COMPANY_NAME?.trim() || "akmic合同会社";
const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const positional = args.filter((value, index) => {
  if (value.startsWith("--")) return false;
  const prev = args[index - 1];
  if (prev === "--trades" || prev === "--dividends") return false;
  return true;
});
const tradePath = flag("--trades") || positional[0] || null;
const dividendPath = flag("--dividends") || positional[1] || null;
const preview = args.includes("--preview") || args.includes("--dry-run");
if (!tradePath && !dividendPath) throw new Error("--trades and/or --dividends is required");

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim()));
}

function objectsFromCsv(text, requiredHeaders) {
  const rows = parseCsv(text);
  const headerRow = rows.findIndex((r) => requiredHeaders.every((h) => r.includes(h)));
  if (headerRow < 0) throw new Error(`CSV header not found: ${requiredHeaders.join(", ")}`);
  const headers = rows[headerRow].map((x) => x.trim());
  return rows.slice(headerRow + 1)
    .filter((r) => r.some((v) => String(v).trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "").trim()])));
}

const num = (v) => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s || s === "-") return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${v}`);
  return n;
};
const date = (v) => {
  const m = String(v).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) throw new Error(`Invalid date: ${v}`);
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
};
const sourceId = (prefix, raw) => `${prefix}:${createHash("sha256").update(JSON.stringify(raw)).digest("hex")}`;
const short = (id) => id.split(":").at(-1).slice(0, 10).toUpperCase();

async function readCp932(file) {
  const bytes = await fs.readFile(file);
  return new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
}

async function loadTrades(file) {
  const rows = objectsFromCsv(await readCp932(file), ["約定日", "ティッカー", "受渡金額［円］"]);
  return rows.map((raw) => {
    if (!(["積立", "買付"].includes(raw["取引区分"]) || raw["売買区分"] === "買")) {
      throw new Error(`Unsupported trade: ${raw["取引区分"]}/${raw["売買区分"]}`);
    }
    if (raw["決済通貨"] !== "円") throw new Error(`Unsupported settlement currency: ${raw["決済通貨"]}`);
    const entryDate = date(raw["約定日"]);
    const amount = Math.round(num(raw["受渡金額［円］"]));
    const id = sourceId("us_trade", raw);
    return {
      entryDate,
      voucherNo: `RS-T-${entryDate.replaceAll("-", "")}-${short(id)}`,
      description: `${raw["ティッカー"]} / ${raw["銘柄名"]}`,
      sourceRecordId: id,
      sourceData: { type: "us_trade", raw },
      lines: [
        ["debit", "投資有価証券", "楽天証券", amount, `${raw["ティッカー"]}買付`],
        ["credit", "預け金", "楽天証券 預け金(円)", amount, "楽天証券円預け金から買付"],
      ],
    };
  });
}

async function loadDividends(file) {
  const rows = objectsFromCsv(await readCp932(file), ["入金日(受渡日)", "外国税額[円]", "国内税額合計[円]"]);
  return rows.map((raw) => {
    if (raw["受取通貨"] !== "USドル") throw new Error(`Unsupported dividend currency: ${raw["受取通貨"]}`);
    const entryDate = date(raw["入金日(受渡日)"]);
    const grossUsd = num(raw["配当金・分配金・利金合計(税引前)[円/現地通貨]"]);
    const declarationRate = num(raw["申告レート"]);
    const grossYen = Math.round(grossUsd * declarationRate);
    const foreignTax = Math.round(num(raw["外国税額[円]"]));
    const domesticTax = Math.round(num(raw["国内税額合計[円]"]));
    const depositYen = grossYen - foreignTax - domesticTax;
    if (depositYen < 0) throw new Error(`Invalid dividend amounts: ${JSON.stringify(raw)}`);
    const id = sourceId("us_dividend", raw);
    return {
      entryDate,
      voucherNo: `RS-D-${entryDate.replaceAll("-", "")}-${short(id)}`,
      description: `${raw["銘柄コード"]} 配当金`,
      sourceRecordId: id,
      sourceData: {
        type: "us_dividend",
        accounting_policy: {
          gross_yen: "税引前USD×申告レートを円単位四捨五入",
          foreign_tax: "CSV外国税額[円]。米国源泉税として仮払金管理",
          domestic_tax: "CSV国内税額合計[円]。国内源泉所得税等として仮払金管理",
          usd_deposit: "gross_yen-foreign_tax-domestic_tax",
          fx: "CSV為替レートは参考値として保存し、配当受取時に為替差損益は計上しない",
        },
        computed: {
          gross_usd: grossUsd,
          declaration_rate: declarationRate,
          reference_rate: num(raw["為替レート"]),
          gross_yen: grossYen,
          foreign_tax_yen: foreignTax,
          domestic_tax_yen: domesticTax,
          usd_deposit_book_yen: depositYen,
        },
        raw,
      },
      lines: [
        ["debit", "預け金", "楽天証券 外貨預け金", depositYen, `税引後 ${raw["受取金額(税引後)[円/現地通貨]"]} USD`],
        ["debit", "仮払金", "楽天証券 米国源泉税", foreignTax, "外国税額控除検討"],
        ["debit", "仮払金", "楽天証券 国内源泉所得税", domesticTax, "所得税額控除検討"],
        ["credit", "受取配当金", "楽天証券", grossYen, `${grossUsd} USD × 申告レート ${declarationRate}`],
      ],
    };
  });
}

const sql = postgres(DATABASE_URL, { ssl: "require", max: 1, prepare: false });

async function companyId(tx) {
  const rows = await tx`select id from accounting.companies where name=${COMPANY_NAME}`;
  if (rows.length !== 1) throw new Error(`Expected one company named ${COMPANY_NAME}, found ${rows.length}`);
  return rows[0].id;
}
async function fiscalYear(tx, company, d) {
  const rows = await tx`select id,is_closed,name from accounting.fiscal_years where company_id=${company} and ${d}::date between start_date and end_date`;
  if (rows.length !== 1) throw new Error(`Fiscal year not found: ${d}`);
  if (rows[0].is_closed) throw new Error(`Fiscal year is closed: ${rows[0].name}`);
  return rows[0].id;
}
async function master(tx, company, accountName, subName, createSub = false) {
  const a = await tx`select id from accounting.accounts where company_id=${company} and name=${accountName} and is_active=true`;
  if (a.length !== 1) throw new Error(`Account not uniquely found: ${accountName}`);
  let s = await tx`select id from accounting.sub_accounts where company_id=${company} and account_id=${a[0].id} and name=${subName} and is_active=true`;
  if (!s.length && createSub) {
    s = await tx`insert into accounting.sub_accounts(company_id,account_id,name,source_system,source_record_id) values(${company},${a[0].id},${subName},${SOURCE_SYSTEM},${`bootstrap:${subName}`}) returning id`;
  }
  if (s.length !== 1) throw new Error(`Sub-account not uniquely found: ${accountName}/${subName}`);
  return { accountId: a[0].id, subAccountId: s[0].id };
}

async function write(entries) {
  return sql.begin(async (tx) => {
    const company = await companyId(tx);
    const cache = new Map();
    const resolve = async (a, s) => {
      const key = `${a}/${s}`;
      if (!cache.has(key)) cache.set(key, await master(tx, company, a, s, a === "仮払金"));
      return cache.get(key);
    };
    let inserted = 0, duplicates = 0;
    for (const e of entries) {
      const dup = await tx`select id from accounting.journals where company_id=${company} and source_system=${SOURCE_SYSTEM} and source_record_id=${e.sourceRecordId}`;
      if (dup.length) { duplicates += 1; continue; }
      const fy = await fiscalYear(tx, company, e.entryDate);
      const debit = e.lines.filter(([side]) => side === "debit").reduce((s, x) => s + x[3], 0);
      const credit = e.lines.filter(([side]) => side === "credit").reduce((s, x) => s + x[3], 0);
      if (debit !== credit) throw new Error(`Unbalanced: ${e.voucherNo} debit=${debit} credit=${credit}`);
      const j = await tx`insert into accounting.journals(company_id,fiscal_year_id,entry_date,voucher_no,description,status,total_debit,total_credit,source_system,source_record_id,source_data,entry_kind) values(${company},${fy},${e.entryDate},${e.voucherNo},${e.description},'posted',${debit},${credit},${SOURCE_SYSTEM},${e.sourceRecordId},${tx.json(e.sourceData)},'regular') returning id`;
      for (let i = 0; i < e.lines.length; i += 1) {
        const [side, a, s, amount, memo] = e.lines[i];
        const ids = await resolve(a, s);
        await tx`insert into accounting.journal_lines(journal_id,line_no,account_id,sub_account_id,side,amount,memo,partner_name) values(${j[0].id},${i + 1},${ids.accountId},${ids.subAccountId},${side},${amount},${memo},'楽天証券')`;
      }
      inserted += 1;
    }
    return { inserted, duplicates };
  });
}

const entries = [
  ...(tradePath ? await loadTrades(tradePath) : []),
  ...(dividendPath ? await loadDividends(dividendPath) : []),
];
for (const e of entries) {
  console.log(`\n${e.entryDate} ${e.description}`);
  for (const [side, a, s, amount] of e.lines) console.log(`  ${side === "debit" ? "借方" : "貸方"} ${a}/${s} ${amount.toLocaleString("ja-JP")}円`);
}
console.log(`\nentries=${entries.length}, trades=${entries.filter((e) => e.sourceData.type === "us_trade").length}, dividends=${entries.filter((e) => e.sourceData.type === "us_dividend").length}`);

if (preview) console.log("Preview mode: database write skipped.");
else console.log(await write(entries));
await sql.end();

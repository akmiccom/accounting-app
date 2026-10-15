import { sql } from "@/lib/db";
import { yen } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function JournalsPage({ searchParams }: Props) {
  const p = await searchParams;
  const q = typeof p.q === "string" ? p.q.trim() : "";
  const account = typeof p.account === "string" ? p.account.trim() : "";

  const rows = await sql`
    select
      "取引日"::text as entry_date, "伝票番号" as voucher_no, "借方科目" as debit_account,
      "借方補助科目" as debit_sub, "借方金額" as debit_amount, "貸方科目" as credit_account,
      "貸方補助科目" as credit_sub, "貸方金額" as credit_amount, "仕訳摘要" as description,
      "証憑件数" as receipt_count, "仕訳状態" as status
    from accounting.journal_book_readable_v
    where "会計年度" = '2025年度'
      and (${q} = '' or coalesce("仕訳摘要",'') ilike ${'%' + q + '%'} or coalesce("伝票番号",'') ilike ${'%' + q + '%'})
      and (${account} = '' or "借方科目" = ${account} or "貸方科目" = ${account})
    order by "取引日" desc, "伝票番号" desc, "明細番号"
    limit 300
  `;

  const accounts = await sql`
    select distinct account_name from (
      select "借方科目" as account_name from accounting.journal_book_readable_v where "会計年度"='2025年度'
      union
      select "貸方科目" as account_name from accounting.journal_book_readable_v where "会計年度"='2025年度'
    ) x where account_name is not null order by account_name
  `;

  return <>
    <h1>仕訳帳</h1><p className="lead">FY2025・最大300行</p>
    <form className="toolbar">
      <label>摘要 / 伝票番号<input name="q" defaultValue={q} placeholder="検索" /></label>
      <label>勘定科目<select name="account" defaultValue={account}><option value="">すべて</option>{accounts.map((a:any)=><option key={a.account_name}>{a.account_name}</option>)}</select></label>
      <button type="submit">絞り込む</button>
    </form>
    <div className="table-wrap"><table><thead><tr><th>取引日</th><th>伝票</th><th>借方科目</th><th>借方補助</th><th className="num">借方金額</th><th>貸方科目</th><th>貸方補助</th><th className="num">貸方金額</th><th>摘要</th><th>証憑</th><th>状態</th></tr></thead><tbody>
      {rows.map((r:any)=><tr key={`${r.voucher_no}-${r.entry_date}-${r.debit_account}-${r.credit_account}`}><td>{r.entry_date}</td><td>{r.voucher_no}</td><td>{r.debit_account}</td><td>{r.debit_sub ?? ''}</td><td className="num">{yen(r.debit_amount)}</td><td>{r.credit_account}</td><td>{r.credit_sub ?? ''}</td><td className="num">{yen(r.credit_amount)}</td><td>{r.description}</td><td>{r.receipt_count}</td><td>{r.status}</td></tr>)}
    </tbody></table></div>
  </>;
}

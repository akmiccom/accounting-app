import Link from "next/link";
import { sql } from "@/lib/db";
import { yen } from "@/lib/format";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ReconciliationPage({ searchParams }: Props) {
  const p = await searchParams;
  const type = p.type === "bank" ? "bank" : "card";
  const openOnly = p.all !== "1";

  const rows = type === "card" ? await sql`
    select "利用日"::text as tx_date, "利用先" as description, "利用金額" as amount,
           "照合状態" as status, "対応伝票番号" as voucher_no, "対応仕訳摘要" as journal_description
    from accounting.card_transaction_reconciliation_readable_v
    where (${openOnly} = false or "照合状態" not in ('direct','照合済み'))
    order by "利用日" desc limit 300
  ` : await sql`
    select "取引日"::text as tx_date, "摘要" as description, "金額" as amount,
           "実効照合状態" as status, "対応伝票番号" as voucher_no, "対応仕訳摘要" as journal_description
    from accounting.bank_transaction_reconciliation_readable_v
    where (${openOnly} = false or "実効照合状態" not in ('direct','照合済み'))
    order by "取引日" desc limit 300
  `;

  return <div className="content-page">
    <h1>照合一覧</h1><p className="lead">カード・銀行の対応状況を確認します。</p>
    <div className="tabs"><Link className={type==='card'?'active':''} href={`/reconciliation?type=card`}>カード</Link><Link className={type==='bank'?'active':''} href={`/reconciliation?type=bank`}>銀行</Link></div>
    <div className="toolbar"><Link href={`/reconciliation?type=${type}${openOnly?'&all=1':''}`}><button>{openOnly?'すべて表示':'未処理だけ表示'}</button></Link></div>
    <div className="table-wrap reconciliation-table"><table><thead><tr><th>日付</th><th>利用先 / 摘要</th><th className="num">金額</th><th>照合状態</th><th>伝票番号</th><th>対応仕訳摘要</th></tr></thead><tbody>
      {rows.length===0 ? <tr><td colSpan={6} className="empty">該当データはありません。</td></tr> : rows.map((r:any,i:number)=><tr key={`${r.tx_date}-${r.description}-${i}`}><td>{r.tx_date}</td><td>{r.description}</td><td className="num">{yen(r.amount)}</td><td><span className={`badge ${['direct','照合済み'].includes(r.status)?'':'warn'}`}>{r.status}</span></td><td>{r.voucher_no ?? ''}</td><td>{r.journal_description ?? ''}</td></tr>)}
    </tbody></table></div>

    <div className="reconciliation-cards">
      {rows.length===0 ? <div className="empty">該当データはありません。</div> : rows.map((r:any,i:number)=>(
        <article className="reconciliation-card" key={`mobile-${r.tx_date}-${r.description}-${i}`}>
          <div className="reconciliation-card-head">
            <div>
              <div className="reconciliation-card-date">{r.tx_date}</div>
              <div className="reconciliation-card-description">{r.description}</div>
            </div>
            <div className="reconciliation-card-amount">¥{yen(r.amount)}</div>
          </div>
          <dl className="reconciliation-card-meta">
            <dt>照合状態</dt>
            <dd><span className={`badge ${['direct','照合済み'].includes(r.status)?'':'warn'}`}>{r.status}</span></dd>
            <dt>伝票番号</dt>
            <dd>{r.voucher_no ?? '—'}</dd>
            <dt>対応仕訳</dt>
            <dd>{r.journal_description ?? '—'}</dd>
          </dl>
        </article>
      ))}
    </div>
  </div>;
}

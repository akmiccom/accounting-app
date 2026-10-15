import { sql } from "@/lib/db";
import { yen } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [summary] = await sql`
    with pl as (
      select
        coalesce(sum(case when "科目区分" = '収益' and "集計レベル" = '勘定科目' then "通常金額" else 0 end),0) as revenue,
        coalesce(sum(case when "科目区分" = '費用' and "集計レベル" = '勘定科目' then "通常金額" else 0 end),0) as expense
      from accounting.monthly_profit_loss_readable_v
      where "会計年度" = '2025年度'
    ), card as (
      select count(*)::int as n from accounting.card_transaction_reconciliation_readable_v
      where "照合状態" not in ('direct','照合済み')
    ), bank as (
      select count(*)::int as n from accounting.bank_transaction_reconciliation_readable_v
      where "実効照合状態" not in ('direct','照合済み')
    )
    select pl.revenue, pl.expense, (pl.revenue - pl.expense) as profit,
           card.n as card_open, bank.n as bank_open
    from pl, card, bank
  `;

  return (
    <>
      <h1>ダッシュボード</h1>
      <p className="lead">FY2025・確認用。編集機能はありません。</p>
      <div className="cards">
        <div className="card"><div className="label">収益</div><div className="value">¥{yen(summary.revenue)}</div></div>
        <div className="card"><div className="label">費用</div><div className="value">¥{yen(summary.expense)}</div></div>
        <div className="card"><div className="label">損益</div><div className="value">¥{yen(summary.profit)}</div></div>
        <div className="card"><div className="label">未処理照合</div><div className="value">カード {summary.card_open} / 銀行 {summary.bank_open}</div></div>
      </div>
      <div className="card">
        <strong>このMVPでできること</strong>
        <p className="lead" style={{marginTop:8, marginBottom:0}}>仕訳の検索、PL/BSの親子表示、カード・銀行照合状況の確認。</p>
      </div>
    </>
  );
}

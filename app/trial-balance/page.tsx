import Link from "next/link";
import { sql } from "@/lib/db";
import { yen } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type BsRow = {
  account_name: string;
  category: string;
  level: "勘定科目" | "補助科目";
  sub_name: string | null;
  opening: string | number | null;
  debit: string | number | null;
  credit: string | number | null;
  closing: string | number | null;
  asset_total: string | number | null;
  liability_total: string | number | null;
  equity_total: string | number | null;
  difference: string | number | null;
  period_start: string;
  period_end: string;
};

type PlRow = {
  account_name: string;
  category: string;
  level: "勘定科目" | "補助科目";
  sub_name: string | null;
  debit: string | number | null;
  credit: string | number | null;
  amount: string | number | null;
  revenue_total: string | number | null;
  expense_total: string | number | null;
  profit: string | number | null;
  period_start: string;
  period_end: string;
};

function n(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowClass(level: string) {
  return level === "勘定科目" ? "parent" : "child";
}

function AccountCell({
  level,
  accountName,
  subName,
}: {
  level: string;
  accountName: string;
  subName: string | null;
}) {
  return level === "勘定科目"
    ? accountName
    : subName || "補助科目なし";
}

export default async function TrialBalancePage({ searchParams }: Props) {
  const p = await searchParams;
  const type = p.type === "pl" ? "pl" : "bs";

  if (type === "pl") {
    const rows = (await sql`
      select
        "勘定科目名" as account_name,
        "科目区分" as category,
        "集計レベル" as level,
        "補助科目名" as sub_name,
        "借方合計" as debit,
        "貸方合計" as credit,
        "年間金額" as amount,
        "収益合計" as revenue_total,
        "費用合計" as expense_total,
        "当期純損益" as profit,
        "期首日"::text as period_start,
        "期末日"::text as period_end
      from accounting.annual_profit_loss_readable_v
      where "会計年度" = '2025年度'
      order by
        case "科目区分" when '収益' then 0 when '費用' then 1 else 2 end,
        "勘定科目名",
        case when "集計レベル" = '勘定科目' then 0 else 1 end,
        "補助科目名" nulls first
    `) as PlRow[];

    const revenueTotal = n(rows[0]?.revenue_total);
    const expenseTotal = n(rows[0]?.expense_total);
    const profit = n(rows[0]?.profit);
    const periodStart = rows[0]?.period_start ?? "";
    const periodEnd = rows[0]?.period_end ?? "";

    return (
      <div className="content-page">
        <div className="page-heading">
          <div>
            <h1>残高試算表</h1>
            <p className="lead">PL科目の借方・貸方と当期金額を、勘定科目／補助科目単位で確認します。</p>
          </div>
          <div className="period-chip">2025年度</div>
        </div>

        <div className="tabs compact-tabs">
          <Link href="/trial-balance?type=bs">BS</Link>
          <Link className="active" href="/trial-balance?type=pl">PL</Link>
        </div>

        <section className="summary-grid three">
          <div className="summary-card"><span>収益</span><strong>¥{yen(revenueTotal)}</strong></div>
          <div className="summary-card"><span>費用</span><strong>¥{yen(expenseTotal)}</strong></div>
          <div className={`summary-card ${profit < 0 ? "negative" : "positive"}`}>
            <span>当期純損益</span><strong>¥{yen(profit)}</strong>
          </div>
        </section>

        {periodStart && <p className="lead">{periodStart} ～ {periodEnd}</p>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>区分</th>
                <th>勘定科目 / 補助科目</th>
                <th className="num">借方合計</th>
                <th className="num">貸方合計</th>
                <th className="num">当期金額</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  className={rowClass(row.level)}
                  key={`${row.category}-${row.account_name}-${row.sub_name ?? "account"}-${index}`}
                >
                  <td>{row.category}</td>
                  <td><AccountCell level={row.level} accountName={row.account_name} subName={row.sub_name} /></td>
                  <td className="num">¥{yen(n(row.debit))}</td>
                  <td className="num">¥{yen(n(row.credit))}</td>
                  <td className="num">¥{yen(n(row.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const rows = (await sql`
    select
      "勘定科目名" as account_name,
      "科目区分" as category,
      "集計レベル" as level,
      "補助科目名" as sub_name,
      "期首残高" as opening,
      "借方増減" as debit,
      "貸方増減" as credit,
      "期末残高" as closing,
      "資産合計" as asset_total,
      "負債合計" as liability_total,
      "純資産合計" as equity_total,
      "貸借差額" as difference,
      "期首日"::text as period_start,
      "期末日"::text as period_end
    from accounting.annual_balance_sheet_readable_v
    where "会計年度" = '2025年度'
    order by
      case "科目区分" when '資産' then 0 when '負債' then 1 when '純資産' then 2 else 3 end,
      "勘定科目名",
      case when "集計レベル" = '勘定科目' then 0 else 1 end,
      "補助科目名" nulls first
  `) as BsRow[];

  const assetTotal = n(rows[0]?.asset_total);
  const liabilityTotal = n(rows[0]?.liability_total);
  const equityTotal = n(rows[0]?.equity_total);
  const difference = n(rows[0]?.difference);
  const periodStart = rows[0]?.period_start ?? "";
  const periodEnd = rows[0]?.period_end ?? "";

  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <h1>残高試算表</h1>
          <p className="lead">BS科目の期首残高・借方増減・貸方増減・期末残高を一覧で確認します。</p>
        </div>
        <div className="period-chip">2025年度</div>
      </div>

      <div className="tabs compact-tabs">
        <Link className="active" href="/trial-balance?type=bs">BS</Link>
        <Link href="/trial-balance?type=pl">PL</Link>
      </div>

      <section className="summary-grid three">
        <div className="summary-card"><span>資産</span><strong>¥{yen(assetTotal)}</strong></div>
        <div className="summary-card"><span>負債</span><strong>¥{yen(liabilityTotal)}</strong></div>
        <div className="summary-card"><span>純資産</span><strong>¥{yen(equityTotal)}</strong></div>
      </section>

      <section className="report-result">
        <div className={`report-result-row total ${Math.abs(difference) < 0.5 ? "positive" : "negative"}`}>
          <span>貸借差額</span>
          <strong>¥{yen(difference)}</strong>
        </div>
      </section>

      {periodStart && <p className="lead">{periodStart} ～ {periodEnd}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>区分</th>
              <th>勘定科目 / 補助科目</th>
              <th className="num">期首残高</th>
              <th className="num">借方増減</th>
              <th className="num">貸方増減</th>
              <th className="num">期末残高</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                className={rowClass(row.level)}
                key={`${row.category}-${row.account_name}-${row.sub_name ?? "account"}-${index}`}
              >
                <td>{row.category}</td>
                <td><AccountCell level={row.level} accountName={row.account_name} subName={row.sub_name} /></td>
                <td className="num">¥{yen(n(row.opening))}</td>
                <td className="num">¥{yen(n(row.debit))}</td>
                <td className="num">¥{yen(n(row.credit))}</td>
                <td className="num">¥{yen(n(row.closing))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

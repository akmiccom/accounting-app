import Link from "next/link";
import { sql } from "@/lib/db";
import { yen } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ReportRow = {
  account_name: string;
  category: string;
  level: "勘定科目" | "補助科目";
  sub_name: string | null;
  amount: string | number | null;
  adjusted: string | number | null;
  period_start: string;
  period_end: string;
};

type AccountGroup = {
  accountName: string;
  category: string;
  amount: number;
  adjusted: number | null;
  children: Array<{ name: string; amount: number; adjusted: number | null }>;
};

function n(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupRows(rows: ReportRow[]) {
  const map = new Map<string, AccountGroup>();

  for (const row of rows) {
    const key = `${row.category}::${row.account_name}`;
    const current = map.get(key) ?? {
      accountName: row.account_name,
      category: row.category,
      amount: 0,
      adjusted: null,
      children: [],
    };

    if (row.level === "勘定科目") {
      current.amount = n(row.amount);
      current.adjusted = row.adjusted == null ? null : n(row.adjusted);
    } else {
      current.children.push({
        name: row.sub_name || "補助科目なし",
        amount: n(row.amount),
        adjusted: row.adjusted == null ? null : n(row.adjusted),
      });
    }

    map.set(key, current);
  }

  for (const group of map.values()) {
    const childTotal = group.children.reduce((sum, child) => sum + child.amount, 0);
    const unassigned = group.amount - childTotal;

    if (Math.abs(unassigned) >= 0.5) {
      group.children.push({ name: "補助科目なし", amount: unassigned, adjusted: null });
    }
  }

  return [...map.values()].filter((group) => Math.abs(group.amount) >= 0.5);
}

function AccountList({ groups, valueLabel }: { groups: AccountGroup[]; valueLabel: string }) {
  if (groups.length === 0) return <div className="empty-block">表示する科目はありません。</div>;

  return (
    <div className="account-list">
      {groups.map((group) => {
        const hasChildren = group.children.length > 0;

        if (!hasChildren) {
          return (
            <div className="account-row" key={`${group.category}-${group.accountName}`}>
              <div className="account-name">{group.accountName}</div>
              <div className="account-value">¥{yen(group.amount)}</div>
            </div>
          );
        }

        return (
          <details className="account-group" key={`${group.category}-${group.accountName}`}>
            <summary>
              <span className="account-name">{group.accountName}</span>
              <span className="account-value">¥{yen(group.amount)}</span>
            </summary>
            <div className="subaccount-list" aria-label={`${group.accountName}の${valueLabel}内訳`}>
              {group.children
                .filter((child) => Math.abs(child.amount) >= 0.5)
                .map((child) => (
                  <div className="subaccount-row" key={`${group.accountName}-${child.name}`}>
                    <span>{child.name}</span>
                    <span>¥{yen(child.amount)}</span>
                  </div>
                ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function ReportSection({
  title,
  total,
  groups,
  valueLabel,
}: {
  title: string;
  total: number;
  groups: AccountGroup[];
  valueLabel: string;
}) {
  return (
    <section className="report-section">
      <div className="section-title-row">
        <h2>{title}</h2>
        <strong>¥{yen(total)}</strong>
      </div>
      <AccountList groups={groups} valueLabel={valueLabel} />
    </section>
  );
}

export default async function ReportsPage({ searchParams }: Props) {
  const p = await searchParams;
  const type = p.type === "bs" ? "bs" : "pl";
  const scope = p.scope === "monthly" ? "monthly" : "annual";
  const monthRaw = typeof p.month === "string" ? Number(p.month) : 11;
  const month = Number.isInteger(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : 11;

  const rows = (scope === "annual"
    ? type === "pl"
      ? await sql`
          select
            "勘定科目名" as account_name,
            "科目区分" as category,
            "集計レベル" as level,
            "補助科目名" as sub_name,
            "年間金額" as amount,
            null::numeric as adjusted,
            "期首日"::text as period_start,
            "期末日"::text as period_end
          from accounting.annual_profit_loss_readable_v
          where "会計年度" = '2025年度'
          order by
            case "科目区分" when '収益' then 0 when '費用' then 1 else 2 end,
            "勘定科目名",
            case when "集計レベル" = '勘定科目' then 0 else 1 end,
            "補助科目名" nulls first
        `
      : await sql`
          select
            "勘定科目名" as account_name,
            "科目区分" as category,
            "集計レベル" as level,
            "補助科目名" as sub_name,
            "期末残高" as amount,
            null::numeric as adjusted,
            "期首日"::text as period_start,
            "期末日"::text as period_end
          from accounting.annual_balance_sheet_readable_v
          where "会計年度" = '2025年度'
          order by
            case "科目区分" when '資産' then 0 when '負債' then 1 when '純資産' then 2 else 3 end,
            "勘定科目名",
            case when "集計レベル" = '勘定科目' then 0 else 1 end,
            "補助科目名" nulls first
        `
    : type === "pl"
      ? await sql`
          select
            "勘定科目名" as account_name,
            "科目区分" as category,
            "集計レベル" as level,
            "補助科目名" as sub_name,
            "通常金額" as amount,
            "決算整理金額" as adjusted,
            "対象月開始日"::text as period_start,
            "対象月終了日"::text as period_end
          from accounting.monthly_profit_loss_readable_v
          where "会計年度" = '2025年度' and "期内月番号" = ${month}
          order by
            case "科目区分" when '収益' then 0 when '費用' then 1 else 2 end,
            "勘定科目名",
            case when "集計レベル" = '勘定科目' then 0 else 1 end,
            "補助科目名" nulls first
        `
      : await sql`
          select
            "勘定科目名" as account_name,
            "科目区分" as category,
            "集計レベル" as level,
            "補助科目名" as sub_name,
            "通常残高" as amount,
            "決算整理後残高" as adjusted,
            "対象月開始日"::text as period_start,
            "対象月終了日"::text as period_end
          from accounting.monthly_balance_sheet_readable_v
          where "会計年度" = '2025年度' and "期内月番号" = ${month}
          order by
            case "科目区分" when '資産' then 0 when '負債' then 1 when '純資産' then 2 else 3 end,
            "勘定科目名",
            case when "集計レベル" = '勘定科目' then 0 else 1 end,
            "補助科目名" nulls first
        `) as ReportRow[];

  const groups = groupRows(rows);
  const periodStart = rows[0]?.period_start ?? "";
  const periodEnd = rows[0]?.period_end ?? "";
  const periodLabel =
    scope === "annual"
      ? "2025年度"
      : periodStart
        ? `${periodStart.slice(0, 7).replace("-", "年")}月`
        : `${month}月目`;

  const revenue = groups.filter((g) => g.category === "収益");
  const expenses = groups.filter((g) => g.category === "費用");
  const assets = groups.filter((g) => g.category === "資産");
  const liabilities = groups.filter((g) => g.category === "負債");
  const equity = groups.filter((g) => g.category === "純資産");

  const revenueTotal = revenue.reduce((sum, g) => sum + g.amount, 0);
  const expenseTotal = expenses.reduce((sum, g) => sum + g.amount, 0);
  const profit = revenueTotal - expenseTotal;
  const assetTotal = assets.reduce((sum, g) => sum + g.amount, 0);
  const liabilityTotal = liabilities.reduce((sum, g) => sum + g.amount, 0);
  const equityTotal = equity.reduce((sum, g) => sum + g.amount, 0);
  const liabilityEquityTotal = liabilityTotal + equityTotal;
  const balanceDifference = assetTotal - liabilityEquityTotal;

  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <h1>{type === "pl" ? "損益" : "貸借対照表"}</h1>
          <p className="lead">
            {type === "pl" ? "収益と費用を左右に並べて確認します。" : "資産と負債・純資産を左右に並べて確認します。"}
          </p>
        </div>
        <div className="period-chip">{periodLabel}</div>
      </div>

      <div className="tabs compact-tabs">
        <Link className={type === "pl" ? "active" : ""} href={`/reports?type=pl&scope=${scope}&month=${month}`}>PL</Link>
        <Link className={type === "bs" ? "active" : ""} href={`/reports?type=bs&scope=${scope}&month=${month}`}>BS</Link>
      </div>

      <form className="toolbar report-toolbar">
        <input type="hidden" name="type" value={type} />
        <label>
          表示範囲
          <select name="scope" defaultValue={scope}>
            <option value="annual">年度全体</option>
            <option value="monthly">月別</option>
          </select>
        </label>
        <label>
          対象月
          <select name="month" defaultValue={month}>
            {Array.from({ length: 12 }, (_, i) => (
              <option value={i + 1} key={i + 1}>{i + 1}月目</option>
            ))}
          </select>
        </label>
        <button>表示</button>
        {periodStart && <span className="period-note">{periodStart} ～ {periodEnd}</span>}
      </form>

      {type === "pl" ? (
        <>
          <section className="summary-grid three">
            <div className="summary-card">
              <span>収益</span>
              <strong>¥{yen(revenueTotal)}</strong>
            </div>
            <div className="summary-card">
              <span>費用</span>
              <strong>¥{yen(expenseTotal)}</strong>
            </div>
            <div className={`summary-card ${profit < 0 ? "negative" : "positive"}`}>
              <span>損益</span>
              <strong>¥{yen(profit)}</strong>
            </div>
          </section>

          <div className="report-columns">
            <div className="report-column">
              <ReportSection title="収益" total={revenueTotal} groups={revenue} valueLabel="収益" />
            </div>
            <div className="report-column">
              <ReportSection title="費用" total={expenseTotal} groups={expenses} valueLabel="費用" />
            </div>
          </div>

          <section className="report-result">
            <div className={`report-result-row total ${profit < 0 ? "negative" : "positive"}`}>
              <span>損益</span>
              <strong>¥{yen(profit)}</strong>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="summary-grid three">
            <div className="summary-card"><span>資産</span><strong>¥{yen(assetTotal)}</strong></div>
            <div className="summary-card"><span>負債</span><strong>¥{yen(liabilityTotal)}</strong></div>
            <div className="summary-card"><span>純資産</span><strong>¥{yen(equityTotal)}</strong></div>
          </section>

          <div className="report-columns">
            <div className="report-column">
              <ReportSection title="資産" total={assetTotal} groups={assets} valueLabel="残高" />
            </div>
            <div className="report-column">
              <ReportSection title="負債" total={liabilityTotal} groups={liabilities} valueLabel="残高" />
              <ReportSection title="純資産" total={equityTotal} groups={equity} valueLabel="残高" />
            </div>
          </div>

          <section className="report-result">
            <div className="report-result-row">
              <span>資産合計</span>
              <strong>¥{yen(assetTotal)}</strong>
            </div>
            <div className="report-result-row">
              <span>負債・純資産合計</span>
              <strong>¥{yen(liabilityEquityTotal)}</strong>
            </div>
            <div className={`report-result-row total ${Math.abs(balanceDifference) < 0.5 ? "positive" : "negative"}`}>
              <span>差額</span>
              <strong>¥{yen(balanceDifference)}</strong>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

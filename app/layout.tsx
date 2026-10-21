import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "akmic 会計",
  description: "akmic合同会社 会計確認用MVP",
};

const nav = [
  ["/", "ダッシュボード"],
  ["/journals", "仕訳帳"],
  ["/trial-balance", "残高試算表"],
  ["/reports", "PL / BS"],
  ["/reconciliation", "照合一覧"],
] as const;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">akmic 会計</div>
            <div className="caption">閲覧専用 MVP</div>
            <nav>
              {nav.map(([href, label]) => (
                <Link href={href} key={href}>{label}</Link>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}

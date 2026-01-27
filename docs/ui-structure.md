# 画面構成案（Next.js）

> 目的: MVPの画面と導線を明確にし、実装優先度を揃える。

## 画面一覧（MVP）

### 1. ログイン
- パス: `/login`
- 概要: 認証（JWT発行）
- 役割: 全ロール

### 2. ダッシュボード
- パス: `/`
- 概要: 当月の仕訳件数、未確定件数、主要KPI
- 役割: admin/accountant/viewer

### 3. 勘定科目マスタ
- 一覧: `/accounts`
- 作成/編集: `/accounts/new`, `/accounts/[id]`
- 概要: 科目コード・名称・区分・有効/無効
- 役割: admin

### 4. 仕訳入力
- 一覧: `/journals`
- 新規: `/journals/new`
- 詳細/編集: `/journals/[id]`
- 確定: 詳細画面から「確定」アクション
- 概要: ヘッダ + 明細（複数行）、借貸合計の即時検証
- 役割: accountant（閲覧はviewer以上）

### 5. 総勘定元帳
- パス: `/ledger`
- 概要: 科目選択 + 期間指定 + 仕訳一覧
- 役割: viewer以上

### 6. 試算表
- パス: `/trial-balance`
- 概要: 期首/当期/期末残高の一覧
- 役割: viewer以上

### 7. PL/BS
- 損益計算書: `/reports/pl`
- 貸借対照表: `/reports/bs`
- 概要: 期間指定の簡易集計
- 役割: viewer以上

### 8. CSV入出力
- パス: `/import-export`
- 概要: 仕訳CSVのインポート/エクスポート
- 役割: accountant以上

### 9. 監査ログ
- パス: `/audit-logs`
- 概要: 重要操作の履歴参照
- 役割: admin

---

## 画面遷移（簡易）

```
/login
  ↓
/dashboard
  ├── /accounts
  ├── /journals
  │     ├── /journals/new
  │     └── /journals/[id]
  ├── /ledger
  ├── /trial-balance
  ├── /reports/pl
  ├── /reports/bs
  ├── /import-export
  └── /audit-logs
```

---

## UIコンポーネント（共通）
- グローバルナビ（左サイド or 上部）
- 期間フィルタ（from/to）
- テーブル（仕訳/帳票）
- 仕訳明細入力テーブル（行追加/削除）
- エラートースト（借貸不一致など）

---

## MVPの実装優先度
1. 仕訳入力
2. 総勘定元帳
3. 試算表
4. 勘定科目マスタ
5. PL/BS
6. CSV入出力
7. 監査ログ


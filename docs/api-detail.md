# API詳細設計（FastAPI）

> 目的: MVPで必要なユースケースを満たすためのリクエスト/レスポンス、バリデーション、
> ステータス遷移、エラー設計を具体化する。

## 共通仕様

### 認証・認可
- 認証: JWT（Authorization: Bearer <token>）
- 権限: role = admin / accountant / viewer
- 監査ログ: 重要操作（作成/更新/確定/修正/インポート）で記録

### エラー応答（共通）
```json
{
  "error": {
    "code": "validation_error",
    "message": "借方合計と貸方合計が一致しません",
    "details": {
      "expected": 1000,
      "actual": 900
    }
  }
}
```

### 日付・金額
- 日付: `YYYY-MM-DD`
- 金額: 小数2桁（NUMERIC(14,2)）

## エンドポイント詳細

### 勘定科目

#### GET /api/accounts
- 概要: 勘定科目一覧
- クエリ: `is_active`（任意）
- 権限: viewer以上
- レスポンス: 200
```json
{
  "items": [
    {
      "id": "uuid",
      "code": "101",
      "name": "現金",
      "category": "asset",
      "is_active": true
    }
  ]
}
```

#### POST /api/accounts
- 概要: 勘定科目作成
- 権限: admin
- リクエスト
```json
{
  "code": "101",
  "name": "現金",
  "category": "asset"
}
```
- バリデーション
  - `code` 会社内で一意
  - `category` は asset/liability/equity/revenue/expense

#### PATCH /api/accounts/{id}
- 概要: 勘定科目更新
- 権限: admin
- リクエスト
```json
{
  "name": "現金・小口",
  "is_active": true
}
```

#### DELETE /api/accounts/{id}
- 概要: 勘定科目無効化（論理削除）
- 権限: admin
- 挙動: `is_active=false`

---

### 仕訳

#### POST /api/journals
- 概要: 仕訳作成（draft）
- 権限: accountant以上
- リクエスト
```json
{
  "entry_date": "2024-04-01",
  "voucher_no": "2024-0001",
  "description": "売上計上",
  "lines": [
    {"account_id": "uuid", "side": "debit", "amount": 1000, "memo": "売掛金"},
    {"account_id": "uuid", "side": "credit", "amount": 1000, "memo": "売上"}
  ]
}
```
- バリデーション
  - `lines` は2行以上
  - `amount` > 0
  - `side` は debit/credit
  - 合計値は**保存時にも検証**する（draftでも一致推奨）
- レスポンス: 201

#### GET /api/journals
- 概要: 仕訳一覧
- クエリ: `from`, `to`, `status`, `voucher_no`
- 権限: viewer以上

#### GET /api/journals/{id}
- 概要: 仕訳詳細
- 権限: viewer以上

#### PATCH /api/journals/{id}
- 概要: draftの修正
- 権限: accountant以上
- 制約: `status=draft` のみ更新可能

#### POST /api/journals/{id}/post
- 概要: 仕訳確定（posted）
- 権限: accountant以上
- バリデーション
  - 借方合計 = 貸方合計
  - `status=draft` のみ
- 挙動
  - totals再計算
  - `status=posted`
  - 監査ログ記録

#### POST /api/journals/{id}/reverse
- 概要: 修正仕訳（反対仕訳）作成
- 権限: accountant以上
- バリデーション
  - `status=posted` のみ
- 挙動
  - 反対仕訳を新規作成（reversed）
  - 監査ログ記録

---

### 総勘定元帳

#### GET /api/ledger
- 概要: 勘定科目別の仕訳一覧
- クエリ: `account_id`, `from`, `to`
- 権限: viewer以上
- レスポンス: 200
```json
{
  "account": {"id": "uuid", "code": "101", "name": "現金"},
  "items": [
    {
      "entry_date": "2024-04-01",
      "voucher_no": "2024-0001",
      "description": "売上計上",
      "side": "debit",
      "amount": 1000,
      "balance": 1000
    }
  ]
}
```

---

### 試算表

#### GET /api/trial-balance
- 概要: 期首/当期/期末残高
- クエリ: `fiscal_year_id`
- 権限: viewer以上
- レスポンス: 200
```json
{
  "items": [
    {
      "account_id": "uuid",
      "code": "101",
      "name": "現金",
      "opening": 0,
      "debit": 1000,
      "credit": 0,
      "closing": 1000
    }
  ]
}
```

---

### PL/BS

#### GET /api/pl
- 概要: 損益計算書（簡易）
- クエリ: `from`, `to`
- 権限: viewer以上

#### GET /api/bs
- 概要: 貸借対照表（簡易）
- クエリ: `as_of`
- 権限: viewer以上

---

### CSV

#### POST /api/journals/import
- 概要: 仕訳CSVインポート
- 権限: accountant以上
- 挙動:
  - ドラフト登録 → 一括検証 → 失敗行は返却

#### GET /api/journals/export
- 概要: 仕訳CSVエクスポート
- 権限: viewer以上
- クエリ: `from`, `to`

---

## ステータス遷移

- `draft` → `posted`（確定）
- `posted` → 直接更新禁止
- `posted` の修正は `reverse` で反対仕訳を作成

## 監査ログ
- 対象: accounts, journals
- 操作: create/update/post/reverse/import
- 記録: actor_id, before/after

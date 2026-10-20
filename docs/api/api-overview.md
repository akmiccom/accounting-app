# API概要

## 方針

APIは将来のWeb UI / Google Sheets連携等で必要になった段階で実装する。
現時点の正本ロジックはSupabase PostgreSQLの制約・trigger・viewとmigrationにある。

- 認証: JWT + RBACを想定
- 権限: admin / accountant / viewerを想定
- 仕訳: draft → posted → 必要に応じてreverse
- posted後は直接更新しない
- 照合状態はDBのreconciliation viewを利用する

## 想定エンドポイント

### 勘定科目

- GET /api/accounts
- POST /api/accounts
- PATCH /api/accounts/{id}
- DELETE /api/accounts/{id}

### 仕訳

- GET /api/journals
- POST /api/journals
- GET /api/journals/{id}
- PATCH /api/journals/{id}
- POST /api/journals/{id}/post
- POST /api/journals/{id}/reverse

### 帳票

- GET /api/ledger
- GET /api/trial-balance
- GET /api/reports/pl
- GET /api/reports/bs

### 照合

- GET /api/reconciliation/cards
- GET /api/reconciliation/banks
- GET /api/reconciliation/pending

### 取込

- POST /api/imports/mf
- POST /api/imports/bank
- POST /api/imports/card
- GET /api/imports

## バリデーション

- draft作成中の一時的な借貸不一致は許容する
- postedへ遷移する時点で借方合計 = 貸方合計を必須にする
- posted / reversedの直接更新は禁止する
- 勘定科目・補助科目の存在を確認する
- 外部データはsource ID / hashで重複取込を防止する
- 1対1で確定できない照合は無理に直接紐付けしない

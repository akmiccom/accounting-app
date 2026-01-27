# API概要

## 方針
- FastAPIでREST APIを提供
- 認証はJWT + RBACを想定
- 仕訳は draft → posted の遷移を明確化

## エンドポイント案

### 勘定科目
- GET /api/accounts
- POST /api/accounts
- PATCH /api/accounts/{id}
- DELETE /api/accounts/{id}

### 仕訳
- GET /api/journals
- POST /api/journals
- GET /api/journals/{id}
- POST /api/journals/{id}/post
- POST /api/journals/{id}/reverse

### 元帳・試算表
- GET /api/ledger?account_id=...&from=...&to=...
- GET /api/trial-balance?fiscal_year_id=...
- GET /api/pl?from=...&to=...
- GET /api/bs?as_of=...

### CSV
- POST /api/journals/import
- GET /api/journals/export?from=...&to=...

## バリデーション
- 仕訳作成/確定時に借方合計 = 貸方合計をチェック
- posted後の更新は禁止
- 勘定科目の存在確認

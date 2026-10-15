# 画面構成案

> 現時点ではGoogle Sheetsを主な確認・照合画面とし、Next.js UIは将来実装する。DBとStorageが正本であり、UIはそれらを操作・参照するためのフロントエンドとする。

## MVP画面候補

### 1. ダッシュボード `/`

- 当月仕訳件数
- draft / posted件数
- カード照合状態
- 銀行照合状態
- pending_journal / review / unmatched件数
- 証憑要確認件数

### 2. 仕訳 `/journals`

- 一覧
- 詳細
- draft作成・編集
- posted確定
- reverse / 調整
- 証憑リンク

### 3. 証憑 `/receipts`

- 日付・金額・取引先・receipt_code検索
- 要確認一覧
- Storage原本閲覧
- 関連仕訳表示

### 4. カード照合 `/reconciliation/cards`

- direct
- group
- review
- unmatched
- group照合の構成カード・仕訳確認

### 5. 銀行照合 `/reconciliation/banks`

- direct
- pending_journal
- review
- unmatched
- pending_journalの原因表示

### 6. 総勘定元帳 `/ledger`

- 科目選択
- 期間指定
- 補助科目
- 仕訳へのドリルダウン

### 7. 試算表 `/trial-balance`

- 会計年度選択
- 期首 / 当期 / 期末

### 8. PL / BS

- `/reports/pl`
- `/reports/bs`
- 月次 / 年次
- MF比較用表示

### 9. 取込履歴 `/imports`

- MF
- 銀行CSV
- カードCSV
- 原本ファイル名
- SHA-256
- row_count
- Storage保存状態

### 10. 監査ログ `/audit-logs`

- 重要操作の履歴参照

## 当面のGoogle Sheets画面

Next.js実装前はGoogle Sheetsを次の用途に限定する。

- 未照合・pending・review一覧
- 証憑検索・リンク
- 仕訳候補
- 月次集計
- 試算表
- PL / BS

Sheetsは正本ではない。

## UI共通ルール

- posted仕訳を直接編集させない
- 不明値をUI側で勝手に補完しない
- 1対1確定できない照合を強制的に結び付けない
- private Storageの恒久URLを保存しない
- signed URLは表示時に生成する
- エラー表示は借貸不一致・重複取込・照合曖昧性を区別する

## 実装優先度

1. Google Sheets確認・照合
2. 証憑検索
3. カード/銀行照合
4. 仕訳参照・draft入力
5. 総勘定元帳
6. 試算表
7. PL / BS
8. 取込履歴
9. 監査ログ
10. 必要に応じてNext.js UIへ置換

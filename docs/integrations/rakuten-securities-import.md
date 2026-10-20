# 楽天証券CSVの仕訳取込

対象CSV:
- 米国株式取引履歴: `tradehistory(US)_*.csv`
- 配当金・分配金・利金一覧: `dividendlist_*.csv`

## 仕訳方針

円決済の米国株買付:
- 借方: 投資有価証券 / 楽天証券
- 貸方: 預け金 / 楽天証券 預け金(円)
- 金額: CSVの「受渡金額［円］」
- 日付: 約定日

米国ETF配当:
- 借方: 預け金 / 楽天証券 外貨預け金
- 借方: 仮払金 / 楽天証券 米国源泉税
- 借方: 仮払金 / 楽天証券 国内源泉所得税
- 貸方: 受取配当金 / 楽天証券

税引前配当の円換算は「税引前USD × 申告レート」を円単位で四捨五入します。
外国税・国内税はCSVの円額をそのまま使い、税額控除の検討対象として仮払金で分離管理します。
CSVの「為替レート」はsource_dataに保存し、配当受取時には為替差損益を立てません。

初回本番取込時、存在しなければ次の補助科目を作成します。
- 仮払金 / 楽天証券 米国源泉税
- 仮払金 / 楽天証券 国内源泉所得税

## Preview

```powershell
npm run journal:preview:rakuten:csv -- `
  --trades "C:\path\tradehistory(US)_20261019.csv" `
  --dividends "C:\path\dividendlist_20261019.csv"
```

PreviewではDBを書き換えません。

## Import

```powershell
npm run journal:import:rakuten:csv -- `
  --trades "C:\path\tradehistory(US)_20261019.csv" `
  --dividends "C:\path\dividendlist_20261019.csv"
```

`source_system=rakuten_securities` とCSV行のSHA-256から作る `source_record_id` で二重取込を防止します。
閉鎖済み会計年度への投入はエラーにします。

# Agent Commerce — AI Agent Autonomous E-Commerce PoC

AIエージェントが自律的にECサイトで買い物をするPoC。
x402プロトコルを使い、エージェントが自分のウォレットから支払いを行う。

## Architecture

```
[User]  「コーヒー豆を補充して」
   ↓
[AI Agent]
   ├── GET /api/products/search?q=coffee  (無料)
   ├── 商品を比較・選定
   └── GET /api/purchase/coffee-001       (x402: USDC支払い)
   ↓
[EC Server]
   ├── x402 middleware → 402 Payment Required
   ├── Agent が USDC で自動支払い
   └── 注文確定 → Agent に結果返却
   ↓
[User]  「Ethiopian Yirgacheffe Coffee Beans を $0.001 で注文しました」
```

## Tech Stack

- **EC Server**: Express.js + @x402/express
- **Payment**: x402 protocol (USDC on Base Sepolia)
- **Agent Wallet**: MoonPay CLI (non-custodial)
- **Facilitator**: https://facilitator.x402.org

## Setup

```bash
npm install

# .env を設定
cp .env.example .env

# ECサーバー起動
npm run server

# エージェント実行
npm run agent
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/products | Free | 商品一覧 |
| GET | /api/products/search?q= | Free | 商品検索 |
| GET | /api/purchase/:id | x402 | 商品購入（支払い） |

# Agent Commerce -- AI Agent Autonomous E-Commerce PoC

AIエージェントが自律的にECサイトで買い物をするPoC。
x402プロトコルを使い、エージェントが自分のウォレットから支払いを行う。

## Architecture

```
[User]  「シャンプー買って」
   |
[AI Agent]
   |-- GET /api/products/search?q=シャンプー  (無料)
   |-- 商品を比較・選定
   +-- GET /api/purchase/shampoo-001          (x402: USDC支払い)
   |
[EC Server]
   |-- x402 middleware -> 402 Payment Required
   |-- Agent が USDC で自動支払い
   +-- 注文確定 -> Agent に結果返却
   |
[User]  「ボタニカル シャンプー 500ml を $0.001 で注文しました」
```

## Tech Stack

- **EC Server**: Express.js + @x402/express
- **Shopping Agent**: @x402/fetch + viem
- **Payment**: x402 protocol (USDC on Base Sepolia)
- **Facilitator**: https://x402.org/facilitator

## Setup

```bash
pnpm install
cp .env.example .env
```

`.env` に以下を設定:
- `PAY_TO_ADDRESS` - ECサーバーの売上受取アドレス
- `AGENT_PRIVATE_KEY` - エージェント(買い手)ウォレットの秘密鍵

エージェントのウォレットには Base Sepolia の USDC が必要:
https://faucet.circle.com/

## Usage

```bash
# ECサーバー起動
pnpm run server

# 別ターミナルでエージェント実行
pnpm run agent -- シャンプー
pnpm run agent -- 洗剤
pnpm run agent -- ティッシュ
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/products | Free | 商品一覧 |
| GET | /api/products/search?q= | Free | 商品検索 |
| GET | /api/purchase/:id | x402 | 商品購入（支払い） |

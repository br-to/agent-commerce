import { config } from "dotenv";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const products = JSON.parse(
  readFileSync(join(__dirname, "products.json"), "utf-8")
);

// ECサーバーのウォレットアドレス（売上受取先）
const payToAddress = process.env.PAY_TO_ADDRESS as `0x${string}`;
if (!payToAddress) {
  console.error("PAY_TO_ADDRESS is required");
  process.exit(1);
}

const facilitatorUrl =
  process.env.FACILITATOR_URL || "https://facilitator.x402.org";

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "eip155:84532",
  new ExactEvmScheme()
);

const app = express();
app.use(express.json());

// 商品一覧 — 無料（認証不要）
app.get("/api/products", (_req, res) => {
  res.json({
    products: products.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      category: p.category,
      stock: p.stock,
    })),
  });
});

// 商品検索 — 無料
app.get("/api/products/search", (req, res) => {
  const query = (req.query.q as string)?.toLowerCase() || "";
  const category = req.query.category as string;

  let results = products;
  if (query) {
    results = results.filter(
      (p: any) =>
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query)
    );
  }
  if (category) {
    results = results.filter((p: any) => p.category === category);
  }

  res.json({ results });
});

// 商品詳細 — x402で有料（購入 = 支払い）
// 支払いが完了すると注文が確定する
const purchaseRoutes: Record<string, any> = {};
for (const product of products) {
  const route = `GET /api/purchase/${product.id}`;
  purchaseRoutes[route] = {
    accepts: [
      {
        scheme: "exact" as const,
        price: product.price,
        network: "eip155:84532" as const,
        payTo: payToAddress,
      },
    ],
    description: `Purchase: ${product.name}`,
    mimeType: "application/json",
  };
}

app.use(paymentMiddleware(purchaseRoutes, resourceServer));

// 購入エンドポイント — x402支払い後にアクセス可能
app.get("/api/purchase/:productId", (req, res) => {
  const product = products.find((p: any) => p.id === req.params.productId);
  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  // 支払い済み → 注文確定
  const orderId = `ORD-${Date.now()}`;
  console.log(
    `Order ${orderId}: ${product.name} purchased for ${product.price}`
  );

  res.json({
    order: {
      orderId,
      product: product.name,
      price: product.price,
      status: "confirmed",
      message: `Thank you! Your order for ${product.name} has been confirmed.`,
    },
  });
});

const PORT = process.env.PORT || 4021;
app.listen(PORT, () => {
  console.log(`Agent Commerce Server running at http://localhost:${PORT}`);
  console.log(`${products.length} products available`);
  console.log(`Payments via x402 on Base Sepolia`);
  console.log(`Pay-to address: ${payToAddress}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET /api/products          — List all products (free)`);
  console.log(`  GET /api/products/search?q= — Search products (free)`);
  console.log(
    `  GET /api/purchase/:id      — Purchase product (x402 payment)`
  );
});

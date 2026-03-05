import { config } from "dotenv";
import express from "express";
import cors from "cors";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme as ServerEvmScheme } from "@x402/evm/exact/server";
import { ExactEvmScheme as ClientEvmScheme } from "@x402/evm/exact/client";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load both shops
const shopA = {
  name: "ドラッグストア A",
  products: JSON.parse(
    readFileSync(join(__dirname, "products.json"), "utf-8")
  ),
};
const shopB = {
  name: "ドラッグストア B",
  products: JSON.parse(
    readFileSync(join(__dirname, "products-b.json"), "utf-8")
  ),
};

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
  new ServerEvmScheme()
);

// Agent wallet setup
const agentPrivateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
let agentAccount: ReturnType<typeof privateKeyToAccount> | null = null;
let fetchWithPayment: typeof fetch | null = null;
let httpClient: x402HTTPClient | null = null;

if (agentPrivateKey) {
  agentAccount = privateKeyToAccount(agentPrivateKey);
  const client = new x402Client();
  client.register("eip155:*", new ClientEvmScheme(agentAccount));
  httpClient = new x402HTTPClient(client);
  fetchWithPayment = wrapFetchWithPayment(fetch, client);
  console.log(`Agent wallet: ${agentAccount.address}`);
}

const app = express();
app.use(express.json());
app.use(cors());

const BASESCAN_URL = "https://sepolia.basescan.org/tx";

// Static files (Chat UI)
app.use(express.static(join(__dirname, "..", "public")));

// Helper: parse price string to number
function parsePrice(price: string): number {
  return parseFloat(price.replace("$", ""));
}

// --- Product APIs (free) ---
app.get("/api/products", (_req, res) => {
  res.json({
    shopA: { name: shopA.name, products: shopA.products },
    shopB: { name: shopB.name, products: shopB.products },
  });
});

app.get("/api/products/search", (req, res) => {
  const query = (req.query.q as string)?.toLowerCase() || "";

  const searchIn = (products: any[]) =>
    products.filter(
      (p: any) =>
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query)
    );

  res.json({
    shopA: { name: shopA.name, results: searchIn(shopA.products) },
    shopB: { name: shopB.name, results: searchIn(shopB.products) },
  });
});

// --- Purchase endpoints (x402) ---
// Register routes for both shops
const allProducts = [...shopA.products, ...shopB.products];
const purchaseRoutes: Record<string, any> = {};

// Use unique route per shop+product
for (const product of shopA.products) {
  purchaseRoutes[`GET /api/purchase/a/${product.id}`] = {
    accepts: [
      {
        scheme: "exact" as const,
        price: product.price,
        network: "eip155:84532" as const,
        payTo: payToAddress,
      },
    ],
    description: `Purchase from Shop A: ${product.name}`,
    mimeType: "application/json",
  };
}

for (const product of shopB.products) {
  purchaseRoutes[`GET /api/purchase/b/${product.id}`] = {
    accepts: [
      {
        scheme: "exact" as const,
        price: product.price,
        network: "eip155:84532" as const,
        payTo: payToAddress,
      },
    ],
    description: `Purchase from Shop B: ${product.name}`,
    mimeType: "application/json",
  };
}

app.use(paymentMiddleware(purchaseRoutes, resourceServer));

app.get("/api/purchase/:shop/:productId", (req, res) => {
  const shop = req.params.shop === "a" ? shopA : shopB;
  const product = shop.products.find(
    (p: any) => p.id === req.params.productId
  );
  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  const orderId = `ORD-${Date.now()}`;
  console.log(
    `Order ${orderId}: ${product.name} from ${shop.name} for ${product.price}`
  );

  res.json({
    order: {
      orderId,
      product: product.name,
      shop: shop.name,
      price: product.price,
      status: "confirmed",
      message: `${shop.name} で ${product.name} を購入しました。`,
    },
  });
});

// --- Agent API (chat UI) ---
app.post("/api/agent/search", async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const q = query.toLowerCase();
  const searchIn = (products: any[]) =>
    products.filter(
      (p: any) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );

  const resultsA = searchIn(shopA.products);
  const resultsB = searchIn(shopB.products);

  // Build comparison: match by product ID
  const compared: any[] = [];
  const allIds = new Set([
    ...resultsA.map((p: any) => p.id),
    ...resultsB.map((p: any) => p.id),
  ]);

  for (const id of allIds) {
    const fromA = resultsA.find((p: any) => p.id === id);
    const fromB = resultsB.find((p: any) => p.id === id);

    const priceA = fromA ? parsePrice(fromA.price) : Infinity;
    const priceB = fromB ? parsePrice(fromB.price) : Infinity;

    const cheapest = priceA <= priceB ? "a" : "b";
    const cheapestProduct = cheapest === "a" ? fromA : fromB;
    const cheapestShop = cheapest === "a" ? shopA.name : shopB.name;
    const savings =
      fromA && fromB
        ? Math.abs(priceA - priceB).toFixed(4)
        : null;

    compared.push({
      id,
      name: (fromA || fromB).name,
      description: (fromA || fromB).description,
      category: (fromA || fromB).category,
      shopA: fromA ? { price: fromA.price, shop: "a" } : null,
      shopB: fromB ? { price: fromB.price, shop: "b" } : null,
      cheapest: {
        shop: cheapest,
        shopName: cheapestShop,
        price: cheapestProduct.price,
        savings,
      },
    });
  }

  const total = resultsA.length + resultsB.length;
  res.json({
    message:
      total > 0
        ? `「${query}」を2店舗で検索しました。最安値を比較します。`
        : `「${query}」に一致する商品が見つかりませんでした。`,
    compared,
  });
});

app.post("/api/agent/purchase", async (req, res) => {
  const { productId, shop } = req.body;

  if (!fetchWithPayment || !agentAccount || !httpClient) {
    return res.status(500).json({ error: "Agent wallet not configured" });
  }

  const shopData = shop === "a" ? shopA : shopB;
  const product = shopData.products.find((p: any) => p.id === productId);
  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  try {
    const PORT = process.env.PORT || 4021;
    const url = `http://localhost:${PORT}/api/purchase/${shop}/${productId}`;
    const response = await fetchWithPayment(url, { method: "GET" });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Purchase failed (${response.status}): ${text}`);
    }

    let payment: any = null;
    try {
      payment = httpClient.getPaymentSettleResponse((name: string) =>
        response.headers.get(name)
      );
    } catch {}

    const body = await response.json();

    res.json({
      success: true,
      order: body.order,
      payment: payment
        ? {
            txHash: payment.transaction,
            network: payment.network,
            payer: payment.payer,
            basescanUrl: `${BASESCAN_URL}/${payment.transaction}`,
          }
        : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4021;
app.listen(PORT, () => {
  console.log(`Agent Commerce Server running at http://localhost:${PORT}`);
  console.log(`Shop A: ${shopA.products.length} products`);
  console.log(`Shop B: ${shopB.products.length} products`);
  console.log(`Chat UI: http://localhost:${PORT}`);
});

import { config } from "dotenv";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { generatePrivateKey } from "viem/accounts";

config();

const EC_SERVER_URL = process.env.EC_SERVER_URL || "http://localhost:4021";
const BASESCAN_URL = "https://sepolia.basescan.org/tx";

// Agent wallet private key (shopper)
// If not set, generate a throwaway key for demo
let agentPrivateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
if (!agentPrivateKey) {
  agentPrivateKey = generatePrivateKey();
  console.log("[Agent] No AGENT_PRIVATE_KEY set, generated ephemeral key");
}

const agentAccount = privateKeyToAccount(agentPrivateKey);
console.log(`[Agent] Wallet: ${agentAccount.address}`);

// x402 client setup
const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(agentAccount));
const httpClient = new x402HTTPClient(client);
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// --- Shopping Agent Logic ---

interface Product {
  id: string;
  name: string;
  description: string;
  price: string;
  category: string;
  stock: number;
}

interface OrderResult {
  orderId: string;
  product: string;
  price: string;
  status: string;
  message: string;
}

interface PaymentInfo {
  success: boolean;
  transaction: string;
  network: string;
  payer: string;
}

interface PurchaseResult {
  order: OrderResult;
  payment: PaymentInfo | null;
}

async function searchProducts(query: string): Promise<Product[]> {
  const res = await fetch(
    `${EC_SERVER_URL}/api/products/search?q=${encodeURIComponent(query)}`
  );
  const data = await res.json();
  return data.results;
}

async function purchaseProduct(productId: string): Promise<PurchaseResult> {
  const url = `${EC_SERVER_URL}/api/purchase/${productId}`;
  console.log(`[Agent] Requesting purchase: ${url}`);

  // x402 handles 402 -> sign payment -> retry automatically
  const res = await fetchWithPayment(url, { method: "GET" });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Purchase failed (${res.status}): ${text}`);
  }

  // Extract on-chain payment info from response headers
  let payment: PaymentInfo | null = null;
  try {
    payment = httpClient.getPaymentSettleResponse((name: string) =>
      res.headers.get(name)
    );
  } catch {
    // Payment header not found (shouldn't happen on success)
  }

  const body = await res.json();
  return { order: body.order, payment };
}

// --- Main ---

async function main() {
  // pnpm run agent -- shampoo passes ["--", "shampoo"], skip "--"
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const userRequest = args[0] || "shampoo";
  console.log(`\n[User] "${userRequest}を買って"`);
  console.log("=".repeat(50));

  // Step 1: Search products
  console.log(`\n[Agent] Step 1: Searching for "${userRequest}"...`);
  const results = await searchProducts(userRequest);

  if (results.length === 0) {
    console.log(`[Agent] No products found for "${userRequest}"`);
    return;
  }

  console.log(`[Agent] Found ${results.length} product(s):`);
  for (const p of results) {
    console.log(`  - ${p.name} (${p.price}) [${p.id}]`);
  }

  // Step 2: Pick best match (first result for PoC)
  const chosen = results[0];
  console.log(`\n[Agent] Step 2: Selected "${chosen.name}" (${chosen.price})`);

  // Step 3: Purchase via x402
  console.log(`\n[Agent] Step 3: Purchasing via x402 payment...`);
  try {
    const { order, payment } = await purchaseProduct(chosen.id);

    console.log(`\n[Agent] Purchase complete!`);
    console.log(`  Order ID: ${order.orderId}`);
    console.log(`  Product:  ${order.product}`);
    console.log(`  Price:    ${order.price}`);
    console.log(`  Status:   ${order.status}`);

    if (payment?.transaction) {
      console.log(`\n[Payment] On-chain settlement:`);
      console.log(`  Tx Hash:  ${payment.transaction}`);
      console.log(`  Network:  ${payment.network}`);
      console.log(`  Payer:    ${payment.payer}`);
      console.log(`  BaseScan: ${BASESCAN_URL}/${payment.transaction}`);
    }
  } catch (err: any) {
    console.error(`\n[Agent] Purchase failed: ${err.message}`);

    if (err.message.includes("402")) {
      console.log(
        "\n[Hint] Agent wallet may not have enough USDC on Base Sepolia."
      );
      console.log(`  Agent address: ${agentAccount.address}`);
      console.log("  Get test USDC: https://faucet.circle.com/");
    }
  }
}

main().catch(console.error);

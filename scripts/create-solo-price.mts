/**
 * One-shot setup: create (or reuse) the live "Dopl Solo" product and its
 * $5.99/month flat price for the Free/Solo/Team taxonomy (F-044 deploy
 * checklist item 1). Idempotent — safe to re-run; it searches for an
 * existing active product/price before creating anything.
 *
 * Run: npx tsx scripts/create-solo-price.mts
 * Then set the printed price id as STRIPE_SOLO_PRICE_ID in .env.local
 * and Vercel.
 */
import "dotenv/config";
import { config } from "dotenv";
import Stripe from "stripe";

config({ path: ".env.local" });

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("STRIPE_SECRET_KEY missing (checked env + .env.local)");
const stripe = new Stripe(key);

const products = await stripe.products.search({ query: `name:"Dopl Solo"` });
let product = products.data.find((p) => p.active);
if (!product) {
  product = await stripe.products.create({
    name: "Dopl Solo",
    description: "Dopl Solo Pro — single-member workspace, $5.99/month flat.",
  });
  console.log("created product", product.id);
} else {
  console.log("reusing product", product.id);
}

const prices = await stripe.prices.list({
  product: product.id,
  active: true,
  limit: 10,
});
let price = prices.data.find(
  (p) =>
    p.unit_amount === 599 &&
    p.currency === "usd" &&
    p.recurring?.interval === "month" &&
    p.recurring?.usage_type === "licensed"
);
if (!price) {
  price = await stripe.prices.create({
    product: product.id,
    unit_amount: 599,
    currency: "usd",
    recurring: { interval: "month" },
    nickname: "Solo Pro monthly",
  });
  console.log("created price", price.id);
} else {
  console.log("reusing price", price.id);
}

console.log(`RESULT product=${product.id} price=${price.id}`);
console.log("Next: set STRIPE_SOLO_PRICE_ID in .env.local and Vercel.");

// api/create-checkout-session.ts
import Stripe from 'stripe';
import { parseJsonBody } from './utils.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

// Allowed price IDs from environment
function allowedPrices() {
  return {
    pro: process.env.STRIPE_PRICE_PRO,
    cloud: process.env.STRIPE_PRICE_CLOUD,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = await parseJsonBody(req);

    if (!body || !body.mode) {
      return res.status(400).json({ error: "Missing mode (pro or cloud)" });
    }

    const prices = allowedPrices();

    // Safety check
    if (!prices.pro || !prices.cloud) {
      return res.status(500).json({
        error: "Stripe price IDs missing in environment",
      });
    }

    let session;

    // MODE: PRO — one-time purchase
    if (body.mode === "pro") {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ['card'],
        line_items: [
          {
            price: prices.pro,
            quantity: 1,
          },
        ],
        success_url: `${process.env.APP_URL}/?status=success&plan=pro`,
        cancel_url: `${process.env.APP_URL}/?status=cancel`,
      });
    }

    // MODE: CLOUD — subscription plan
    else if (body.mode === "cloud") {
      session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ['card'],
        line_items: [
          {
            price: prices.cloud,
            quantity: 1,
          },
        ],
        success_url: `${process.env.APP_URL}/?status=success&plan=cloud`,
        cancel_url: `${process.env.APP_URL}/?status=cancel`,
      });
    }

    else {
      return res.status(400).json({ error: "Invalid mode" });
    }

    return res.status(200).json({
      url: session.url,
    });

  } catch (err) {
    console.error("CHECKOUT ERROR:", err);
    return res.status(500).json({
      error: "Server error during checkout",
      details: err.message,
    });
  }
}

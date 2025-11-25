import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { priceId } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: priceId.includes("recurring") ? "subscription" : "payment",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.VITE_APP_URL}/?success=true`,
      cancel_url: `${process.env.VITE_APP_URL}/?cancel=true`,
    });

    res.json({ url: session.url });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

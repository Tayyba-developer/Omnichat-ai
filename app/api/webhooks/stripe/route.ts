import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
/**
 * POST /api/webhooks/stripe
 * Handle Stripe webhook events (checkout.session.completed, payment_intent.succeeded)
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";

  if (!secret) {
    console.warn("STRIPE_WEBHOOK_SECRET not configured");
    return new NextResponse("Webhook secret not configured", { status: 500 });
  }

  // Verify signature and construct event at runtime
  try {
    // Initialize Stripe at runtime
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    const event = stripe.webhooks.constructEvent(body, signature, secret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orderId = session.metadata?.order_id;

      if (orderId) {
        // Update order status to paid
        const { error } = await supabaseAdmin
          .from("orders")
          .update({
            status: "paid",
            stripe_payment_intent_id: session.payment_intent,
          })
          .eq("id", orderId);

        if (error) {
          console.error("Failed to update order:", error);
          return new NextResponse("Order update failed", { status: 500 });
        }

        // Send a message to the conversation if associated
        const { data: order } = await supabaseAdmin
          .from("orders")
          .select("conversation_id, display_id, business_id")
          .eq("id", orderId)
          .maybeSingle();

        if (order?.conversation_id) {
          await supabaseAdmin.from("messages").insert({
            business_id: order.business_id ?? session.metadata?.business_id,
            conversation_id: order.conversation_id,
            sender_type: "system",
            direction: "outgoing",
            body: `Payment received! Order ${order.display_id} is confirmed.`,
          });
        }
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      console.log("Payment intent succeeded:", paymentIntent.id);

      // Additional processing if needed
    }

    return new NextResponse(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error("Webhook error:", err);
    return new NextResponse("Webhook error", { status: 400 });
  }
}

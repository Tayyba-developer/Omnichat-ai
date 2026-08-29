import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { resolveBusiness, UNAUTHORIZED } from "@/lib/supabase/auth";

export const runtime = "nodejs";

interface CreateOrderRequest {
  conversation_id?: string;
  customer_name: string;
  channel_type: "whatsapp" | "instagram" | "messenger" | "web";
  items: Array<{ product_id: string; quantity: number }>;
  create_payment_link?: boolean;
}

const CHANNELS = ["whatsapp", "instagram", "messenger", "web"] as const;

/**
 * POST /api/orders/create
 * Create an order for the signed-in user's business, optionally with a Stripe
 * Checkout link. Prices always come from the database, never from the caller.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveBusiness(request);
  if (!ctx) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  const { supabase, businessId } = ctx;

  try {
    const body = (await request.json().catch(() => null)) as CreateOrderRequest | null;

    if (!body?.customer_name || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: "bad_request", message: "customer_name and at least one item are required." },
        { status: 400 }
      );
    }

    const channelType = CHANNELS.includes(body.channel_type) ? body.channel_type : "web";

    // Fetch the real products. The .in() filter plus RLS means a caller can
    // only ever price products that belong to their own business.
    const { data: productData, error: prodError } = await supabase
      .from("products")
      .select("id, name, price_cents, currency")
      .eq("business_id", businessId)
      .in(
        "id",
        body.items.map((i) => i.product_id)
      );

    if (prodError) {
      console.error("order product lookup failed:", prodError);
      return NextResponse.json(
        { error: "lookup_failed", message: "Couldn't load those products." },
        { status: 500 }
      );
    }

    const products = productData ?? [];
    if (products.length === 0) {
      return NextResponse.json(
        { error: "no_products", message: "None of those products exist in your catalog." },
        { status: 400 }
      );
    }

    let totalCents = 0;
    const orderItems: Array<{
      product_id: string;
      name: string;
      quantity: number;
      price_cents: number;
    }> = [];

    for (const item of body.items) {
      const product = products.find((p: { id: string }) => p.id === item.product_id);
      if (!product) continue;

      const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
      totalCents += product.price_cents * quantity;
      orderItems.push({
        product_id: product.id,
        name: product.name,
        quantity,
        price_cents: product.price_cents,
      });
    }

    // Every line shares one currency — mixing them in a single Stripe session
    // is not possible, so reject it rather than silently charging in USD.
    const currencies = new Set(
      products.map((p: { currency: string | null }) => (p.currency || "USD").toUpperCase())
    );
    if (currencies.size > 1) {
      return NextResponse.json(
        {
          error: "mixed_currency",
          message: `This order mixes currencies (${[...currencies].join(", ")}). Split it into one order per currency.`,
        },
        { status: 400 }
      );
    }
    const currency = ([...currencies][0] as string) || "USD";

    const displayId = `ORD-${Date.now().toString(36).toUpperCase()}`;

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        conversation_id: body.conversation_id || null,
        display_id: displayId,
        customer_name: body.customer_name,
        channel_type: channelType,
        total_cents: totalCents,
        currency,
        status: "draft",
      })
      .select()
      .single();

    if (orderError || !order) {
      console.error("order insert failed:", orderError);
      return NextResponse.json(
        { error: "insert_failed", message: "Couldn't create the order." },
        { status: 500 }
      );
    }

    if (orderItems.length > 0) {
      const { error: itemsError } = await supabase
        .from("order_items")
        .insert(orderItems.map((item) => ({ ...item, order_id: order.id })));

      if (itemsError) console.error("order_items insert failed:", itemsError);
    }

    // ---- Optional Stripe Checkout link ----
    let paymentLink: string | null = null;

    if (body.create_payment_link && totalCents > 0) {
      const secretKey = process.env.STRIPE_SECRET_KEY;

      if (!secretKey) {
        return NextResponse.json({
          success: true,
          order: { id: order.id, display_id: displayId, total_cents: totalCents, currency },
          payment_link: null,
          warning: "Order created, but no payment link: STRIPE_SECRET_KEY isn't configured.",
        });
      }

      try {
        const stripe = new Stripe(secretKey);
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: orderItems.map((item) => ({
            price_data: {
              currency: currency.toLowerCase(),
              product_data: { name: item.name },
              unit_amount: item.price_cents,
            },
            quantity: item.quantity,
          })),
          success_url: `${appUrl}/orders/${order.id}?success=true`,
          cancel_url: `${appUrl}/orders/${order.id}?canceled=true`,
          metadata: { order_id: order.id, business_id: businessId },
        });

        paymentLink = session.url;

        await supabase
          .from("orders")
          .update({
            payment_link: paymentLink,
            stripe_payment_intent_id:
              typeof session.payment_intent === "string" ? session.payment_intent : null,
            status: "pending_payment",
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id)
          .eq("business_id", businessId);
      } catch (stripeError) {
        // The order itself is valid; only the link failed.
        console.error("Stripe checkout session failed:", stripeError);
      }
    }

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        display_id: displayId,
        total_cents: totalCents,
        currency,
        payment_link: paymentLink,
      },
    });
  } catch (error) {
    console.error("Order creation error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Couldn't create the order." },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

interface CreateOrderRequest {
  business_id: string;
  conversation_id?: string;
  customer_name: string;
  customer_email?: string;
  channel_type: "whatsapp" | "instagram" | "messenger" | "web";
  items: Array<{
    product_id: string;
    quantity: number;
  }>;
  create_payment_link?: boolean;
}

/**
 * POST /api/orders/create
 * Create an order and optionally generate a Stripe Checkout Session
 */
export async function POST(request: NextRequest) {
  try {
    // Initialize Stripe at runtime, not at build time
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    const body = (await request.json()) as CreateOrderRequest;

    if (!body.business_id || !body.customer_name || !body.items) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Fetch products to calculate total
    const { data: productData, error: prodError } = await supabaseAdmin
      .from("products")
      .select("id, name, price_cents")
      .in("id", body.items.map((i) => i.product_id));

    if (prodError || !productData) {
      return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
    }

    let totalCents = 0;
    const orderItemsData = [];

    for (const item of body.items) {
      const product = productData.find((p: { id: string }) => p.id === item.product_id);
      if (product) {
        const lineTotalCents = product.price_cents * item.quantity;
        totalCents += lineTotalCents;
        orderItemsData.push({
          product_id: item.product_id,
          name: product.name,
          quantity: item.quantity,
          price_cents: product.price_cents,
        });
      }
    }

    // Generate order ID
    const displayId = `ORD-${Date.now().toString().slice(-6)}`;

    // Create order
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        business_id: body.business_id,
        conversation_id: body.conversation_id || null,
        display_id: displayId,
        customer_name: body.customer_name,
        channel_type: body.channel_type,
        total_cents: totalCents,
        status: "draft",
      })
      .select();

    if (orderError || !order?.[0]) {
      return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }

    const orderId = order[0].id;

    // Create order items
    if (orderItemsData.length > 0) {
      const itemsWithOrderId = orderItemsData.map((item) => ({
        ...item,
        order_id: orderId,
      }));

      await supabaseAdmin.from("order_items").insert(itemsWithOrderId);
    }

    // Create Stripe Checkout Session if requested
    let paymentLink: string | null = null;

    if (body.create_payment_link && totalCents > 0) {
      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: body.items.map((item) => {
            const product = productData.find((p: { id: string }) => p.id === item.product_id);
            return {
              price_data: {
                currency: "usd",
                product_data: {
                  name: product?.name || "Item",
                },
                unit_amount: product?.price_cents || 0,
              },
              quantity: item.quantity,
            };
          }),
          mode: "payment",
          success_url: `${process.env.NEXT_PUBLIC_APP_URL}/orders/${orderId}?success=true`,
          cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/orders/${orderId}?canceled=true`,
          metadata: {
            order_id: orderId,
            business_id: body.business_id,
          },
        });

        paymentLink = session.url;

        // Update order with Stripe info
        await supabaseAdmin
          .from("orders")
          .update({
            payment_link: paymentLink,
            stripe_payment_intent_id: session.payment_intent,
            status: "pending_payment",
          })
          .eq("id", orderId);
      } catch (stripeError) {
        console.error("Stripe error:", stripeError);
        // Don't fail the order creation if Stripe fails
      }
    }

    return NextResponse.json({
      success: true,
      order: {
        id: orderId,
        display_id: displayId,
        total_cents: totalCents,
        payment_link: paymentLink,
      },
    });
  } catch (error) {
    console.error("Order creation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

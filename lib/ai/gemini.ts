import { supabaseAdmin } from "@/lib/supabase/server";

// The Gemini model to use. Override with GEMINI_MODEL in your env if your
// key can't access the default (e.g. some regions only expose newer models).
const GEMINI_MODEL = process.env.NEXT_PUBLIC_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";

interface MessageHistory {
  sender: "customer" | "bot" | "agent";
  text: string;
  timestamp?: string;
}

interface AIReply {
  text: string;
  toolsUsed: Array<{
    name: string;
    params: Record<string, unknown>;
  }>;
}

/**
 * Get AI reply for a customer message, grounded with business context.
 * Uses Google Gemini (free tier) with function calling for order creation
 * and price lookups.
 */
export async function getAIReply(
  businessId: string,
  customerMessage: string,
  history: MessageHistory[] = []
): Promise<AIReply> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  // Fetch business settings
  const { data: settings } = await supabaseAdmin
    .from("agent_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  // Fetch active products for context
  const { data: products } = await supabaseAdmin
    .from("products")
    .select("id, name, sku, price_cents, currency, description")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .limit(20);

  const productContext =
    products && products.length > 0
      ? products
          .map(
            (p: { name: string; price_cents: number; currency: string; description?: string }) =>
              `${p.name}: ${(p.price_cents / 100).toFixed(2)} ${p.currency}${p.description ? ` - ${p.description}` : ""}`
          )
          .join("\n")
      : "No products available";

  const systemPrompt = `You are a helpful e-commerce customer service AI assistant. 
Your business greeting is: "${settings?.greeting_message || "Hi! How can I help you today?"}"
Your tone should be: ${settings?.formality || "Neutral"}
${settings?.emoji_enabled ? "You may use emojis when appropriate." : "Do not use emojis."}

Available Products:
${productContext}

Guidelines:
- Be concise and natural in your responses
- When customers ask about products, reference the available catalog
- Help customers with questions, product recommendations, and ordering
- If the customer wants to place an order, use the create_order tool
- For pricing questions, use the get_product_price tool
- Maintain context from conversation history`;

  // Gemini requires alternating roles that start with "user". We map the
  // customer to "user" and the bot/agent to "model".
  const contents = [
    ...history.map((m) => ({
      role: m.sender === "customer" ? ("user" as const) : ("model" as const),
      parts: [{ text: m.text }],
    })),
    {
      role: "user" as const,
      parts: [{ text: customerMessage }],
    },
  ];

  const tools = [
    {
      functionDeclarations: [
        {
          name: "get_product_price",
          description: "Look up the price of a product by name or SKU",
          parameters: {
            type: "OBJECT",
            properties: {
              product_query: {
                type: "STRING",
                description: "Product name or SKU to look up",
              },
            },
            required: ["product_query"],
          },
        },
        {
          name: "create_order",
          description: "Create a new order with selected products",
          parameters: {
            type: "OBJECT",
            properties: {
              customer_name: {
                type: "STRING",
                description: "Name of the customer",
              },
              items: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    product_id: {
                      type: "STRING",
                      description: "UUID of the product",
                    },
                    quantity: {
                      type: "INTEGER",
                      description: "Quantity to order",
                    },
                  },
                  required: ["product_id", "quantity"],
                },
                description: "Items to include in the order",
              },
              channel: {
                type: "STRING",
                description: "Channel the order originated from",
                enum: ["whatsapp", "instagram", "messenger", "web"],
              },
            },
            required: ["customer_name", "items", "channel"],
          },
        },
      ],
    },
  ];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents,
          tools,
          generationConfig: {
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${error}`);
    }

    const data = (await response.json()) as {
      candidates: Array<{
        content: {
          parts: Array<{
            text?: string;
            functionCall?: {
              name?: string;
              args?: Record<string, unknown>;
            };
          }>;
        };
      }>;
    };

    const parts = data.candidates?.[0]?.content?.parts || [];

    let replyText = "";
    const toolsUsed: Array<{ name: string; params: Record<string, unknown> }> = [];

    for (const part of parts) {
      if (part.text) {
        replyText += part.text;
      } else if (part.functionCall) {
        toolsUsed.push({
          name: part.functionCall.name || "",
          params: part.functionCall.args || {},
        });
      }
    }

    return {
      text: replyText || "I'm here to help. How can I assist you?",
      toolsUsed,
    };
  } catch (error) {
    console.error("Gemini API error:", error);
    throw error;
  }
}

export async function processToolCall(
  businessId: string,
  toolName: string,
  params: Record<string, unknown>
): Promise<{
  success: boolean;
  result?: unknown;
  error?: string;
}> {
  try {
    if (toolName === "get_product_price") {
      const query = String(params.product_query || "");
      const { data: products } = await supabaseAdmin
        .from("products")
        .select("id, name, sku, price_cents, currency")
        .eq("business_id", businessId)
        .or(
          `name.ilike.%${query.replace(/[(),*"\\]/g, " ")}%,sku.eq.${query.replace(/[(),*"\\]/g, " ")}`
        )
        .limit(5);

      if (!products || products.length === 0) {
        return {
          success: true,
          result: "Product not found",
        };
      }

      const results = products.map((p: { name: string; price_cents: number; currency: string }) => ({
        name: p.name,
        price: `${(p.price_cents / 100).toFixed(2)} ${p.currency}`,
      }));

      return {
        success: true,
        result: results,
      };
    }

    if (toolName === "create_order") {
      const customerName = String(params.customer_name || "Guest");
      const items = (params.items as Array<{ product_id: string; quantity: number }>) || [];
      const channel = String(params.channel || "web");

      if (!items || items.length === 0) {
        return {
          success: false,
          error: "No items provided",
        };
      }

      // Calculate order total
      const { data: productData } = await supabaseAdmin
        .from("products")
        .select("id, name, price_cents")
        .in(
          "id",
          items.map((i) => i.product_id)
        );

      let total = 0;
      if (productData) {
        for (const item of items) {
          const prod = productData.find((p: { id: string }) => p.id === item.product_id);
          if (prod) {
            total += prod.price_cents * (item.quantity || 1);
          }
        }
      }

      // Generate display_id
      const displayId = `ORD-${Date.now().toString().slice(-6)}`;

      // Create order
      // .select() matters: without it Supabase returns data: null, the
      // order_items insert below never runs, and the caller gets an
      // undefined order id.
      const { data: order, error } = await supabaseAdmin
        .from("orders")
        .insert({
          business_id: businessId,
          display_id: displayId,
          customer_name: customerName,
          channel_type: channel as "whatsapp" | "instagram" | "messenger" | "web",
          total_cents: total,
          status: "draft",
        })
        .select("id");

      if (error) {
        return {
          success: false,
          error: error.message,
        };
      }

      // Create order items
      if (order && order.length > 0) {
        const orderId = order[0].id;
        const orderItems = items.map((item) => {
          const prod = productData?.find((p: { id: string }) => p.id === item.product_id);
          return {
            order_id: orderId,
            product_id: item.product_id || null,
            name: prod?.name ?? "Item",
            quantity: item.quantity || 1,
            price_cents: prod?.price_cents ?? 0,
          };
        });

        await supabaseAdmin.from("order_items").insert(orderItems);
      }

      return {
        success: true,
        result: {
          orderId: order?.[0]?.id,
          displayId,
          total: (total / 100).toFixed(2),
        },
      };
    }

    return {
      success: false,
      error: `Unknown tool: ${toolName}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Reliability-first AI reply with Gemini multi-model fallback + a direct
// Supabase catalog lookup. This guarantees that a product question like
// "do you have a blue ceramic mug?" ALWAYS gets a real, grounded answer even
// when every Gemini model is rate-limited/"busy" or no API key is configured.
// ============================================================================

interface CatalogMatch {
  id: string;
  name: string;
  sku: string;
  price_cents: number;
  currency: string;
  description?: string | null;
}

export interface CustomerReply {
  text: string;
  source: "gemini" | "catalog" | "error";
  model?: string;
  toolsUsed: Array<{ name: string; params: Record<string, unknown> }>;
  matchedProducts: CatalogMatch[];
}

const GEMINI_MODELS = Array.from(
  new Set(
    [
      process.env.NEXT_PUBLIC_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
    ].filter(Boolean) as string[]
  )
);

/**
 * Call a single Gemini model over the REST endpoint. Returns the generated
 * text, or null when the model is unavailable / rate-limited / returns empty.
 */
async function callGeminiModel(
  model: string,
  apiKey: string,
  systemPrompt: string,
  contents: Array<{ role: "user" | "model"; text: string }>
): Promise<string | null> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: contents.map((c) => ({ role: c.role, parts: [{ text: c.text }] })),
        generationConfig: { temperature: 0.6, maxOutputTokens: 800 },
      }),
    }
  );

  if (!res.ok) return null;

  const data: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } =
    await res.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || "")
    .filter(Boolean)
    .join("\n");

  return text && text.trim() ? text.trim() : null;
}

/**
 * Direct Supabase catalog lookup: tokenize the customer query and score every
 * active product by how many of its name/sku/description tokens match.
 */
async function searchCatalog(businessId: string, query: string): Promise<CatalogMatch[]> {
  if (!businessId) return [];

  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id, name, sku, price_cents, currency, description")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .limit(500);

  if (error || !data || data.length === 0) return [];

  const tokens = (query || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return [];

  return data
    .map((p: CatalogMatch) => {
      const haystack = `${p.name} ${p.sku} ${p.description ?? ""}`.toLowerCase();
      const matched = tokens.filter((t) => haystack.includes(t)).length;
      return { p, matched, score: matched / tokens.length };
    })
    .filter((r: { matched: number }) => r.matched > 0)
    .sort(
      (a: { score: number; matched: number }, b: { score: number; matched: number }) =>
        b.score - a.score || b.matched - a.matched
    )
    .slice(0, 3)
    .map((r: { p: CatalogMatch }) => r.p);
}


function formatCatalogAnswer(matches: CatalogMatch[]): string {
  if (matches.length === 0) {
    return "I couldn't find that item in our catalog right now. Could you describe it differently, or check back soon?";
  }

  const lines = matches.map((p) => {
    const price = `${(p.price_cents / 100).toFixed(2)} ${p.currency || "USD"}`;
    return `• ${p.name} — ${price}${p.description ? ` (${p.description})` : ""}`;
  });

  return `Here's what I found in our catalog:\n\n${lines.join("\n")}\n\nWould you like me to help you place an order?`;
}

/**
 * Generate a customer reply using the same brain the webhooks and the AI chat
 * widget rely on. Always returns a text reply (never throws), so "busy"
 * errors can't leak through to an end customer.
 */
export async function generateCustomerReply(
  businessId: string,
  customerMessage: string,
  history: MessageHistory[] = []
): Promise<CustomerReply> {
  // Build Gemini contents (alternating user/model, starting with user).
  const contents: Array<{ role: "user" | "model"; text: string }> = [];
  for (const m of history) {
    contents.push({
      role: m.sender === "customer" ? "user" : "model",
      text: m.text,
    });
  }
  contents.push({ role: "user", text: customerMessage });

  // Product context for the system prompt.
  const { data: contextProducts, error: contextError } = await supabaseAdmin
    .from("products")
    .select("name, price_cents, currency, description")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .limit(20);

  const productContext =
    !contextError && contextProducts && contextProducts.length > 0
      ? contextProducts
          .map(
            (p: { name: string; price_cents: number; currency: string; description?: string | null }) =>
              `${p.name}: ${(p.price_cents / 100).toFixed(2)} ${p.currency}${p.description ? ` - ${p.description}` : ""}`
          )
          .join("\n")
      : "No products available";

  const systemPrompt = `You are a helpful e-commerce customer service AI assistant.
Available Products:
${productContext}

Guidelines:
- Be concise and natural.
- When customers ask about products, reference the available catalog above.
- If you cannot find a product in the catalog, say you'll check again and offer to help further — never claim a product is unavailable without checking.
- Maintain context from conversation history.`;

  // 1) Try Gemini across multiple models (fall back when one is "busy").
  const apiKey = process.env.GEMINI_API_KEY;
  for (const model of GEMINI_MODELS) {
    if (!apiKey) break;
    try {
      const text = await callGeminiModel(model, apiKey, systemPrompt, contents);
      if (text) {
        return { text, source: "gemini", model, toolsUsed: [], matchedProducts: [] };
      }
    } catch {
      // Model down or rate-limited — try the next one.
    }
  }

  // 2) Direct Supabase catalog lookup so product questions NEVER hit a
  //    "busy" wall even when every Gemini model is unavailable.
  const matches = await searchCatalog(businessId, customerMessage);
  if (matches.length > 0) {
    return {
      text: formatCatalogAnswer(matches),
      source: "catalog",
      toolsUsed: [],
      matchedProducts: matches,
    };
  }

  // 3) Last-resort graceful message (never "busy"/error-ridden).
  return {
    text: "I'm having trouble reaching our AI right now. Please try again in a moment, or ask to speak with a human agent.",
    source: "error",
    toolsUsed: [],
    matchedProducts: [],
  };
}

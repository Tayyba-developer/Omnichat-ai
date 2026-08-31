import { supabaseAdmin, serviceRoleKeyProblem } from "@/lib/supabase/server";
import { createOrder, type ChannelType } from "@/lib/orders/create";

// ============================================================================
// One AI brain for every channel.
//
// There used to be two: getAIReply() declared tools but threw when the API key
// was missing (500ing the webhook and triggering Meta retries), and
// generateCustomerReply() had model fallback but no tools. Which one answered
// a WhatsApp customer depended on which of two near-identical routes Meta was
// pointed at. This is the merge: tools AND fallback AND never throwing.
// ============================================================================

const MAX_TOOL_ROUNDS = 3;
const CATALOG_CONTEXT_LIMIT = 20;

/** Models tried in order; the next one is used when a model is busy or down. */
export const GEMINI_MODELS = Array.from(
  new Set(
    [
      process.env.GEMINI_MODEL || process.env.NEXT_PUBLIC_GEMINI_MODEL,
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
    ].filter(Boolean) as string[]
  )
);

export interface MessageHistory {
  sender: "customer" | "bot" | "agent";
  text: string;
  timestamp?: string;
}

export interface ToolCall {
  name: string;
  params: Record<string, unknown>;
  result?: unknown;
  ok?: boolean;
}

export interface CatalogMatch {
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
  toolsUsed: ToolCall[];
  matchedProducts: CatalogMatch[];
  /**
   * Why the answer came from where it did — for operators, never shown to a
   * customer. Set whenever Gemini was skipped or the catalog was unreachable,
   * so "the bot isn't answering" resolves to one concrete missing setting
   * instead of a screenshot-reading session.
   */
  reason?: string;
}

export interface ReplyOptions {
  channelType?: ChannelType;
  conversationId?: string | null;
  customerName?: string;
  /** Set false to answer without offering to place orders. */
  allowTools?: boolean;
}

// ---------------------------------------------------------------------------
// Gemini wire types
// ---------------------------------------------------------------------------

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

// ---------------------------------------------------------------------------
// Tool declarations
// ---------------------------------------------------------------------------

const TOOL_DECLARATIONS = [
  {
    functionDeclarations: [
      {
        name: "search_products",
        description:
          "Search the catalog by name, SKU or description. Use this before answering any question about what is available, what something costs, or whether an item is in stock.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "What the customer is looking for" },
          },
          required: ["query"],
        },
      },
      {
        name: "create_order",
        description:
          "Place an order once the customer has clearly confirmed exactly what they want. Never call this speculatively — only after an explicit yes. Returns an order number and, when payments are configured, a checkout link to give the customer.",
        parameters: {
          type: "OBJECT",
          properties: {
            customer_name: { type: "STRING", description: "The customer's name" },
            items: {
              type: "ARRAY",
              description: "The products to order",
              items: {
                type: "OBJECT",
                properties: {
                  product_id: {
                    type: "STRING",
                    description: "The product's id, exactly as returned by search_products",
                  },
                  quantity: { type: "INTEGER", description: "How many" },
                },
                required: ["product_id", "quantity"],
              },
            },
          },
          required: ["customer_name", "items"],
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

/** Strip PostgREST filter metacharacters so a query can't inject clauses. */
function sanitizeFilter(term: string): string {
  return term.replace(/[(),*"\\]/g, " ").trim();
}

/**
 * Words that carry no product meaning. A customer writes a sentence, not a
 * search box query, and matching the whole sentence against a product name
 * matches nothing at all.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "it", "is", "are",
  "do", "does", "did", "you", "your", "have", "has", "had", "got", "any", "some",
  "i", "im", "we", "me", "my", "want", "need", "looking", "please", "hi", "hello",
  "hey", "can", "could", "would", "what", "whats", "how", "much", "many", "there",
  "available", "stock", "sell", "buy", "give", "show", "tell", "about", "with",
  "this", "that", "these", "those", "be", "am", "was", "were", "will", "just",
]);

/**
 * Pull the words worth searching on out of a sentence.
 *
 * "Espresso Cup Set, you have?" has to become ["espresso", "cup", "set"], or the
 * lookup asks the database for a product literally named "Espresso Cup Set, you
 * have?" and truthfully answers that no such thing exists.
 */
export function searchKeywords(message: string): string[] {
  const words = sanitizeFilter(message)
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  // Longest first: the distinctive noun beats the filler that survived.
  const unique = [...new Set(words)].sort((a, b) => b.length - a.length);
  return unique.slice(0, 5);
}

/**
 * Look up products, reporting *why* nothing came back.
 *
 * "No such product" and "the database rejected our key" produce the same empty
 * array, and telling a customer we can't find their mug when the real problem is
 * a missing environment variable sends everyone hunting in the wrong place.
 */
async function searchCatalog(
  businessId: string,
  query: string,
  limit = 5
): Promise<{ matches: CatalogMatch[]; error: string | null }> {
  const keyProblem = serviceRoleKeyProblem();
  if (keyProblem) return { matches: [], error: keyProblem };

  if (!businessId) return { matches: [], error: "No business id was supplied with the message." };

  const keywords = searchKeywords(query || "");
  const term = sanitizeFilter(query || "");
  // A message of nothing but stopwords ("do you have any?") still deserves the
  // literal attempt rather than an empty filter that matches everything.
  const needles = keywords.length > 0 ? keywords : term ? [term] : [];
  if (needles.length === 0) return { matches: [], error: null };

  const filter = needles
    .flatMap((n) => [`name.ilike.%${n}%`, `sku.ilike.%${n}%`, `description.ilike.%${n}%`])
    .join(",");

  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id, name, sku, price_cents, currency, description")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .or(filter)
    // Over-fetch: any single keyword matches, so the best row is rarely first.
    .limit(Math.max(limit * 4, 20));

  if (error) {
    console.error("searchCatalog failed:", error);
    return { matches: [], error: `Catalog lookup failed: ${error.message}` };
  }

  const ranked = ((data ?? []) as CatalogMatch[])
    .map((p) => {
      const name = p.name.toLowerCase();
      const haystack = `${name} ${p.sku ?? ""} ${p.description ?? ""}`.toLowerCase();
      // A name hit means far more than a passing mention in the description.
      const score = needles.reduce(
        (n, w) => n + (name.includes(w) ? 3 : haystack.includes(w) ? 1 : 0),
        0
      );
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.p);

  return { matches: ranked, error: null };
}

function formatPrice(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency || "USD"}`;
}

function formatCatalogAnswer(matches: CatalogMatch[]): string {
  if (matches.length === 0) {
    return "I couldn't find that in our catalog. Could you describe it a different way, or tell me roughly what you're after?";
  }
  const lines = matches.map(
    (p) =>
      `• ${p.name} — ${formatPrice(p.price_cents, p.currency)}${p.description ? ` (${p.description})` : ""}`
  );
  return `Here's what I found:\n\n${lines.join("\n")}\n\nWould you like me to put an order together?`;
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export async function processToolCall(
  businessId: string,
  toolName: string,
  params: Record<string, unknown>,
  options: ReplyOptions = {}
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    if (toolName === "search_products" || toolName === "get_product_price") {
      const query = String(params.query ?? params.product_query ?? "");
      const { matches, error: catalogError } = await searchCatalog(businessId, query);

      if (catalogError) {
        return { success: false, error: catalogError };
      }

      if (matches.length === 0) {
        return { success: true, result: { found: 0, products: [], note: "No match in the catalog." } };
      }

      return {
        success: true,
        result: {
          found: matches.length,
          products: matches.map((p) => ({
            product_id: p.id,
            name: p.name,
            sku: p.sku,
            price: formatPrice(p.price_cents, p.currency),
            price_cents: p.price_cents,
            currency: p.currency,
            description: p.description ?? undefined,
          })),
        },
      };
    }

    if (toolName === "create_order") {
      const items = Array.isArray(params.items)
        ? (params.items as Array<{ product_id: string; quantity: number }>)
        : [];

      const created = await createOrder(supabaseAdmin, {
        businessId,
        customerName: String(params.customer_name || options.customerName || "Guest"),
        channelType: options.channelType ?? "web",
        conversationId: options.conversationId ?? null,
        items,
        createPaymentLink: true,
      });

      if (!created.ok) {
        return { success: false, error: created.error };
      }

      return {
        success: true,
        result: {
          order_number: created.order.display_id,
          total: formatPrice(created.order.total_cents, created.order.currency),
          payment_link: created.order.payment_link,
          items: created.order.items.map((i) => `${i.quantity}x ${i.name}`),
          note: created.order.payment_link
            ? "Give the customer the payment link so they can complete checkout."
            : "No payment link is available; tell the customer someone will follow up to arrange payment.",
        },
      };
    }

    return { success: false, error: `Unknown tool: ${toolName}` };
  } catch (error) {
    console.error(`Tool ${toolName} threw:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "The tool failed.",
    };
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

async function buildSystemPrompt(businessId: string): Promise<string> {
  const [{ data: settings }, { data: products }] = await Promise.all([
    supabaseAdmin.from("agent_settings").select("*").eq("business_id", businessId).maybeSingle(),
    supabaseAdmin
      .from("products")
      .select("name, price_cents, currency, description")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .limit(CATALOG_CONTEXT_LIMIT),
  ]);

  const catalog =
    products && products.length > 0
      ? products
          .map(
            (p: { name: string; price_cents: number; currency: string; description?: string | null }) =>
              `${p.name}: ${formatPrice(p.price_cents, p.currency)}${p.description ? ` - ${p.description}` : ""}`
          )
          .join("\n")
      : "(catalog is empty)";

  const greeting = settings?.greeting_message || "Hi! How can I help you today?";
  const tone = settings?.formality || "Neutral";
  const emoji = settings?.emoji_enabled
    ? "You may use the occasional emoji."
    : "Do not use emojis.";

  return `You are a customer service assistant for an online shop, talking to a customer in a chat window.

Your opening line, if you need one: "${greeting}"
Tone: ${tone}. ${emoji}

A sample of the catalog (not the whole thing):
${catalog}

How to work:
- Use search_products whenever the customer asks about an item, a price, or availability. The sample above may be incomplete or stale — the tool is the source of truth.
- Quote only prices the tool returned. Never invent or estimate a price.
- Before ordering, confirm the exact item and quantity in your own words and wait for a clear yes.
- Only then call create_order, using the product_id values search_products gave you.
- After an order is placed, tell the customer the order number and give them the payment link verbatim if there is one.
- If a tool reports an error, say plainly what went wrong and offer to pass them to a human. Never pretend an order succeeded.
- Keep replies short and natural — this is a chat, not an email.`;
}

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

async function callGemini(
  model: string,
  apiKey: string,
  systemPrompt: string,
  contents: GeminiContent[],
  useTools: boolean
): Promise<GeminiPart[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Header, not ?key= — query strings end up in proxy and error logs.
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        ...(useTools ? { tools: TOOL_DECLARATIONS } : {}),
        generationConfig: { temperature: 0.6, maxOutputTokens: 800 },
      }),
    }
  );

  if (!res.ok) {
    // Throw rather than return null. Returning null made every model fail
    // identically and silently, so the customer got a catalog fallback and
    // nobody could see that Google had rejected the request, let alone why.
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(`HTTP ${res.status} — ${body?.error?.message ?? "no detail from Google"}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  };

  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!parts?.length) {
    throw new Error(
      `returned no content (finishReason: ${candidate?.finishReason ?? "none"})`
    );
  }
  return parts;
}

/**
 * Run one model through the full tool loop: ask, run any tools it calls, hand
 * the results back, and repeat until it produces prose (or we hit the cap).
 * Returns null so the caller can fall through to the next model.
 */
async function runToolLoop(
  model: string,
  apiKey: string,
  systemPrompt: string,
  contents: GeminiContent[],
  businessId: string,
  options: ReplyOptions,
  toolsUsed: ToolCall[]
): Promise<string | null> {
  const useTools = options.allowTools !== false;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // On the last round drop the tools, forcing a prose answer rather than
    // another call we have no budget to run.
    const parts = await callGemini(
      model,
      apiKey,
      systemPrompt,
      contents,
      useTools && round < MAX_TOOL_ROUNDS
    );
    const calls = parts.filter((p) => p.functionCall?.name);
    const text = parts
      .map((p) => p.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();

    if (calls.length === 0) {
      return text || null;
    }

    // Record the model's turn verbatim, then answer each call.
    contents.push({ role: "model", parts: calls });

    const responseParts: GeminiPart[] = [];
    for (const part of calls) {
      const name = part.functionCall!.name!;
      const args = part.functionCall!.args ?? {};
      const outcome = await processToolCall(businessId, name, args, options);

      toolsUsed.push({
        name,
        params: args,
        ok: outcome.success,
        result: outcome.success ? outcome.result : outcome.error,
      });

      responseParts.push({
        functionResponse: {
          name,
          response: outcome.success
            ? { result: outcome.result }
            : { error: outcome.error ?? "The tool failed." },
        },
      });
    }

    contents.push({ role: "user", parts: responseParts });
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Produce a reply for a customer message. Never throws: a missing API key, a
 * rate-limited model or a failing tool all degrade to something sensible
 * rather than 500ing the webhook and triggering provider retries.
 *
 * Order of attack: each Gemini model in turn (with tools), then a direct
 * catalog lookup, then a plain apology.
 */
export async function generateCustomerReply(
  businessId: string,
  customerMessage: string,
  history: MessageHistory[] = [],
  options: ReplyOptions = {}
): Promise<CustomerReply> {
  const toolsUsed: ToolCall[] = [];
  const apiKey = process.env.GEMINI_API_KEY;
  const reasons: string[] = [];

  if (!apiKey) {
    reasons.push(
      "GEMINI_API_KEY is not set, so no model was contacted. Add it in your hosting environment and redeploy."
    );
  }
  if (!businessId) {
    reasons.push("No business id reached the AI, so it had no catalog to answer from.");
  }

  if (apiKey && businessId) {
    let systemPrompt: string;
    try {
      systemPrompt = await buildSystemPrompt(businessId);
    } catch (error) {
      console.error("Failed to build system prompt:", error);
      systemPrompt = "You are a helpful customer service assistant for an online shop.";
    }

    for (const model of GEMINI_MODELS) {
      // Fresh contents per model: a half-finished tool exchange from a model
      // that died mid-loop would confuse the next one.
      const contents: GeminiContent[] = [
        ...history
          .filter((m) => m.text?.trim())
          .map((m) => ({
            role: m.sender === "customer" ? ("user" as const) : ("model" as const),
            parts: [{ text: m.text }],
          })),
        { role: "user" as const, parts: [{ text: customerMessage }] },
      ];

      try {
        const text = await runToolLoop(
          model,
          apiKey,
          systemPrompt,
          contents,
          businessId,
          options,
          toolsUsed
        );
        if (text) {
          return { text, source: "gemini", model, toolsUsed, matchedProducts: [] };
        }
      } catch (error) {
        console.warn(`Gemini ${model} failed, trying the next model:`, error);
        reasons.push(`${model}: ${error instanceof Error ? error.message : "failed"}`);
      }
    }
  }

  // Fallback: answer straight from the catalog so a product question still
  // gets a real answer when every model is unavailable.
  const { matches, error: catalogError } = await searchCatalog(businessId, customerMessage, 3);
  if (catalogError) reasons.push(catalogError);

  if (matches.length > 0) {
    return {
      text: formatCatalogAnswer(matches),
      source: "catalog",
      toolsUsed,
      matchedProducts: matches,
      reason: reasons.join(" · ") || undefined,
    };
  }

  // The catalog answered and simply held nothing matching. That is a normal
  // conversation, not a broken deployment, so say so plainly.
  if (!catalogError) {
    return {
      text: formatCatalogAnswer([]),
      source: "catalog",
      toolsUsed,
      matchedProducts: [],
      reason: reasons.join(" · ") || undefined,
    };
  }

  return {
    text: "I'm having trouble reaching our system right now. Please try again in a moment, or ask for a human and someone will pick this up.",
    source: "error",
    toolsUsed,
    matchedProducts: [],
    reason: reasons.join(" · ") || undefined,
  };
}

/** @deprecated Use generateCustomerReply — this exists so older imports keep working. */
export const getAIReply = generateCustomerReply;

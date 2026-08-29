import { NextRequest, NextResponse } from "next/server";
import { resolveBusiness, UNAUTHORIZED } from "@/lib/supabase/auth";

export const runtime = "nodejs";

interface CSVProduct {
  name: string;
  sku: string;
  price_cents: number;
  currency: string;
  description?: string;
}

/**
 * Split one CSV line, honouring quoted fields and "" escapes, so a comma
 * inside a description doesn't shift every remaining column.
 */
function splitCSVLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(field.trim());
      field = "";
    } else field += ch;
  }

  out.push(field.trim());
  return out;
}

/**
 * Parse a money string into integer cents.
 *
 * The value is always read as a major-unit amount ("12", "12.50", "$1,299.00"),
 * never guessed. A `price_cents` column, if present, is used verbatim instead —
 * that's the unambiguous way to give exact cents.
 */
function parseMoney(raw: string): number | null {
  const cleaned = (raw || "").replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function parseCSV(csv: string): { products: CSVProduct[]; skipped: number } {
  const lines = csv.replace(/\r\n?/g, "\n").trim().split("\n");
  if (lines.length < 2) return { products: [], skipped: 0 };

  const headers = splitCSVLine(lines[0]).map((h) => h.toLowerCase());
  const products: CSVProduct[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const values = splitCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    if (!row.name) {
      skipped++;
      continue;
    }

    // price_cents wins when supplied; otherwise read `price` as a normal
    // currency amount (12.50 -> 1250).
    let priceCents: number | null = null;
    if (row.price_cents) {
      const asInt = Number.parseInt(row.price_cents, 10);
      priceCents = Number.isFinite(asInt) && asInt >= 0 ? asInt : null;
    } else if (row.price) {
      priceCents = parseMoney(row.price);
    }

    if (priceCents === null) {
      skipped++;
      continue;
    }

    products.push({
      name: row.name,
      sku: row.sku || "",
      price_cents: priceCents,
      currency: (row.currency || "USD").toUpperCase(),
      description: row.description || undefined,
    });
  }

  return { products, skipped };
}

/**
 * POST /api/products/upload
 * Import a product CSV into the signed-in user's catalog.
 *
 * Columns: name (required), price or price_cents (required), sku, currency,
 * description. The business is taken from the caller's session — never from
 * the request body — so one tenant can't write into another's catalog.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveBusiness(request);
  if (!ctx) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "no_file", message: "Attach a CSV file to upload." },
        { status: 400 }
      );
    }

    const csv = await file.text();
    const { products, skipped } = parseCSV(csv);

    if (products.length === 0) {
      return NextResponse.json(
        {
          error: "no_valid_rows",
          message:
            "No usable rows found. Each row needs a name and a price (or price_cents).",
        },
        { status: 400 }
      );
    }

    const { data: inserted, error } = await ctx.supabase
      .from("products")
      .upsert(
        products.map((p) => ({
          business_id: ctx.businessId,
          name: p.name,
          sku: p.sku,
          description: p.description ?? null,
          price_cents: p.price_cents,
          currency: p.currency,
          source: "csv",
          is_active: true,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "business_id,sku", ignoreDuplicates: false }
      )
      .select();

    if (error) {
      console.error("CSV upload insert failed:", error);
      return NextResponse.json(
        { error: "insert_failed", message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      inserted: inserted?.length ?? 0,
      skipped,
      products: inserted,
    });
  } catch (error) {
    console.error("CSV upload error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Couldn't read that CSV file." },
      { status: 500 }
    );
  }
}

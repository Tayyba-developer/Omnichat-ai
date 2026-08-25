import { NextRequest, NextResponse } from "next/server";
import { resolveBusiness, UNAUTHORIZED } from "@/lib/supabase/auth";
import { parseCSV, toCents } from "@/lib/csv";

export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_ROWS = 5000;

interface ParsedProduct {
  name: string;
  sku: string;
  description: string | null;
  price_cents: number;
  currency: string;
}

/**
 * Read a catalog CSV.
 *
 * Expected header: name, sku, price (or price_cents), [currency], [description]
 * Column order doesn't matter; unknown columns are ignored.
 */
function readCatalog(csv: string): { products: ParsedProduct[]; skipped: number } {
  const rows = parseCSV(csv);
  if (rows.length < 2) return { products: [], skipped: 0 };

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const at = (name: string) => headers.indexOf(name);

  const nameIdx = at("name");
  const skuIdx = at("sku");
  const centsIdx = at("price_cents");
  const priceIdx = centsIdx !== -1 ? centsIdx : at("price");
  const currencyIdx = at("currency");
  const descIdx = at("description");

  if (nameIdx === -1) return { products: [], skipped: rows.length - 1 };

  const products: ParsedProduct[] = [];
  let skipped = 0;

  for (const row of rows.slice(1, MAX_ROWS + 1)) {
    const cell = (idx: number) => (idx === -1 ? "" : (row[idx] ?? "").trim());

    const name = cell(nameIdx);
    if (!name) {
      skipped++;
      continue;
    }

    products.push({
      name,
      sku: cell(skuIdx),
      description: cell(descIdx) || null,
      price_cents: toCents(cell(priceIdx), centsIdx !== -1),
      currency: (cell(currencyIdx) || "USD").toUpperCase().slice(0, 3),
    });
  }

  return { products, skipped };
}

/**
 * POST /api/products/upload
 * Import a catalog CSV into the signed-in agent's business.
 *
 * Re-importing is safe: a row whose SKU already exists updates that product
 * rather than creating a duplicate.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveBusiness(request);
  if (!ctx) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  const { supabase, businessId } = ctx;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "no_file", message: "Choose a CSV file to upload." },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "too_large", message: "That file is over 2 MB. Split it into smaller batches." },
        { status: 413 }
      );
    }

    const { products, skipped } = readCatalog(await file.text());

    if (products.length === 0) {
      return NextResponse.json(
        {
          error: "no_products",
          message:
            "No products found. The first row must be a header containing at least a 'name' column.",
        },
        { status: 400 }
      );
    }

    const rows = products.map((p) => ({
      business_id: businessId,
      name: p.name,
      sku: p.sku,
      description: p.description,
      price_cents: p.price_cents,
      currency: p.currency,
      source: "csv" as const,
      is_active: true,
      updated_at: new Date().toISOString(),
    }));

    // Rows without a SKU can't be matched to an existing product, so they are
    // always inserted; rows with one upsert against the unique (business, sku).
    const withSku = rows.filter((r) => r.sku !== "");
    const withoutSku = rows.filter((r) => r.sku === "");

    let imported = 0;

    if (withSku.length > 0) {
      const { data, error } = await supabase
        .from("products")
        .upsert(withSku, { onConflict: "business_id,sku" })
        .select("id");
      if (error) throw error;
      imported += data?.length ?? 0;
    }

    if (withoutSku.length > 0) {
      const { data, error } = await supabase.from("products").insert(withoutSku).select("id");
      if (error) throw error;
      imported += data?.length ?? 0;
    }

    return NextResponse.json({ success: true, imported, skipped });
  } catch (error) {
    console.error("CSV upload error:", error);
    return NextResponse.json(
      {
        error: "import_failed",
        message: error instanceof Error ? error.message : "Couldn't import that file.",
      },
      { status: 500 }
    );
  }
}

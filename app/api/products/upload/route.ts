import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

interface CSVProduct {
  name: string;
  sku: string;
  price_cents: number;
  currency?: string;
  description?: string;
}

function parseCSV(csv: string): CSVProduct[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) {
    return [];
  }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const products: CSVProduct[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values = line.split(",").map((v) => v.trim());
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    // Parse product - expect: name, sku, price (in cents or dollars), [currency], [description]
    if (!row.name || !row.sku) continue;

    let priceCents = 0;
    if (row.price) {
      const priceNum = parseFloat(row.price);
      // If price looks like cents (>100), use as-is; otherwise assume dollars and multiply by 100
      priceCents = priceNum > 100 ? Math.round(priceNum) : Math.round(priceNum * 100);
    }

    products.push({
      name: row.name,
      sku: row.sku,
      price_cents: priceCents,
      currency: row.currency || "USD",
      description: row.description || undefined,
    });
  }

  return products;
}

/**
 * POST /api/products/upload
 * Upload a CSV file and insert products
 * Expected format: name, sku, price, [currency], [description]
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const businessId = formData.get("business_id") as string;

    if (!file || !businessId) {
      return NextResponse.json(
        { error: "Missing file or business_id" },
        { status: 400 }
      );
    }

    const csv = await file.text();
    const products = parseCSV(csv);

    if (products.length === 0) {
      return NextResponse.json(
        { error: "No valid products found in CSV" },
        { status: 400 }
      );
    }

    // Insert products with business_id
    const { data: inserted, error } = await supabaseAdmin
      .from("products")
      .insert(
        products.map((p) => ({
          business_id: businessId,
          name: p.name,
          sku: p.sku,
          price_cents: p.price_cents,
          currency: p.currency || "USD",
          description: p.description,
          source: "csv",
          is_active: true,
        }))
      )
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      inserted: inserted?.length || 0,
      products: inserted,
    });
  } catch (error) {
    console.error("CSV upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

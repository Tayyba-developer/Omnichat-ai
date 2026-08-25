/**
 * store.routes.ts
 * ---------------------------------------------------------------------------
 * Store connection endpoints.
 *
 *   POST /api/store/connect   — Save a Shopify/WooCommerce store connection
 *   GET  /api/store/connections — List saved store connections
 */

import { Router, Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabase";

export const storeRouter = Router();

// ---- POST /api/store/connect ----
/**
 * Register / update a store connection.
 *
 * Body: { platform: "shopify" | "woocommerce" | "manual", shop?: string,
 *          access_token?: string, refresh_token?: string, customer_tag?: string }
 */
storeRouter.post(
  "/store/connect",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        platform,
        shop,
        access_token,
        refresh_token,
        customer_tag,
      } = req.body;

      if (!platform) {
        res.status(400).json({ error: "missing_platform" });
        return;
      }

      const validPlatforms = ["shopify", "woocommerce", "manual"];
      if (!validPlatforms.includes(platform)) {
        res.status(400).json({
          error: "invalid_platform",
          valid: validPlatforms,
        });
        return;
      }

      const connection = {
        platform,
        shop: shop || null,
        access_token: access_token || null,
        refresh_token: refresh_token || null,
        customer_tag: customer_tag || null,
        connected_at: new Date().toISOString(),
      };

      // Upsert: one connection per (platform, shop).
      const { data, error } = await supabaseAdmin
        .from("store_connections")
        .upsert(connection, {
          onConflict: "platform,shop",
          ignoreDuplicates: false,
        })
        .select()
        .single();

      if (error) throw error;

      res.status(200).json({
        success: true,
        store_connection: data,
        message: "Store connected successfully",
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---- GET /api/store/connections ----
storeRouter.get(
  "/store/connections",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("store_connections")
        .select("*")
        .order("connected_at", { ascending: false });

      if (error) {
        // Graceful degradation: if the table doesn't exist yet
        // (schema not applied), return an empty list instead of 500.
        const msg = error.message ?? "";
        if (
          error.code === "42P01" ||
          error.code === "PGRST205" ||
          /does not exist|schema cache/i.test(msg)
        ) {
          res.json({ connections: [], note: "table_not_ready" });
          return;
        }
        throw error;
      }

      res.json({ connections: data ?? [] });
    } catch (err) {
      next(err);
    }
  }
);

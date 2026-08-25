/**
 * config.ts
 * ---------------------------------------------------------------------------
 * Central configuration for the OmniChat AI backend.
 *
 * Safe defaults for every value so the server always boots — even when no
 * `.env` file is present.
 */

import path from "node:path";
import { config as loadEnv } from "dotenv";

// Load server/.env first, then fall back to the frontend .env.local
// (shared keys like SUPABASE_URL are often defined there).
const serverEnv = path.resolve(__dirname, "..", ".env");
const frontendEnv = path.resolve(__dirname, "..", "..", ".env.local");
loadEnv({ path: serverEnv, quiet: true });
loadEnv({ path: frontendEnv, quiet: true });

function toInt(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return Number.isNaN(n) || n <= 0 ? fallback : n;
}

export interface AppConfig {
  PORT: number;
  NODE_ENV: "development" | "production" | "test";
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  WHATSAPP_VERIFY_TOKEN: string;
  WHATSAPP_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  NEXT_PUBLIC_APP_URL: string;
  CORS_ORIGINS: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
}

export const config: AppConfig = {
  // Express server listens on port 5000 (frontend runs on 3000).
  PORT: toInt(process.env.PORT, 5000),
  NODE_ENV:
    (process.env.NODE_ENV as "development" | "production" | "test") ||
    "development",

  // Supabase connection — service role key bypasses RLS (backend only).
  SUPABASE_URL:
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  SUPABASE_ANON_KEY:
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",

  // Public-facing copies (kept for parity with the frontend config).
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "",

  // WhatsApp Cloud API.
  WHATSAPP_VERIFY_TOKEN:
    process.env.WHATSAPP_VERIFY_TOKEN || "test_verify_token",
  WHATSAPP_TOKEN:
    process.env.WHATSAPP_TOKEN ||
    process.env.WHATSAPP_ACCESS_TOKEN ||
    "",
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || "",

  // App + CORS.
  NEXT_PUBLIC_APP_URL:
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  CORS_ORIGINS:
    process.env.CORS_ORIGINS ||
    "http://localhost:3000,http://localhost:5000",

  // AI (optional — only used if webhook routes call Gemini).
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-1.5-flash",
};

// Export as `config` (canonical) and `env` (backward compat).
export const env = config;

// ---- Derived exports used across the codebase ----

/** Resolved Supabase URL (admin client + public client share the URL). */
export const supabaseUrl: string = config.SUPABASE_URL;

/** Anon key used to build a client that carries a user JWT (RLS applies). */
export const supabaseAnonKey: string = config.SUPABASE_ANON_KEY;

/** Origins allowed for CORS. */
export const corsOrigins: string[] = config.CORS_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

console.info(
  `[environment] configuration loaded - port ${config.PORT} (${config.NODE_ENV})`
);

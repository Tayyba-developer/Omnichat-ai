/**
 * supabase.ts
 * ---------------------------------------------------------------------------
 * Supabase clients used across the backend.
 *
 *  - `supabaseAdmin`: a client authenticated with the SERVICE_ROLE_KEY.
 *    It bypasses RLS and is used ONLY server-side for webhook ingestion,
 *    workers, and privileged operations. It is never exposed to the browser.
 *  - `createSupabaseClient(accessToken?)`: an anon/RLS client optionally
 *    scoped to a caller access token (forwarded as a Bearer JWT).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config, supabaseUrl, supabaseAnonKey } from "../config";

// Service-role client: full rights, no RLS, backend only.
// Falls back to the anon key when the service-role key is not configured
// (e.g. local development without a real Supabase project).
export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl,
  config.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
);

/** Build an anonymous/RLS client optionally scoped to a caller access token. */
export function createSupabaseClient(accessToken?: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : undefined,
    },
  });
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "./useSession";

/**
 * Resolves the business_id for the currently authenticated agent.
 * Returns null until Supabase Auth is signed in AND an `agents` row
 * exists for that user — every data hook in this app treats a null
 * business_id as "not ready yet" and shows an empty/onboarding state
 * instead of fetching.
 */
export function useCurrentBusinessId() {
  const { session, loading: sessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  return useQuery({
    queryKey: ["current-business-id", userId],
    queryFn: async () => {
      if (!userId) return null;
      // `.limit(1)` + `.maybeSingle()` guarantees the query returns at most one
      // row. Without it, `maybeSingle()` throws PostgREST error PGRST116 —
      // "JSON object requested, multiple (or no) rows returned" — whenever a
      // user has MULTIPLE `agents` rows for the same `user_id` (duplicate or
      // leftover onboarding rows), which previously made the dashboard treat
      // the business as unresolved. We pick the earliest (owner) row.
      const { data, error } = await supabase
        .from("agents")
        .select("business_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) {
        // PostgREST errors are plain objects (not `Error` instances), so
        // log the real `.message`.
        //   • PGRST116 = more than one agents row exists for this user →
        //     delete the duplicates in Supabase (`select * from agents where
        //     user_id = '<uid>'`).
        //   • permission/relation errors = run supabase/agents_read_fix.sql
        //     in the Supabase SQL editor. `limit(1)` already defends against
        //     the multi-row case, but we still surface which one occurred.
        const isDup =
          error.code === "PGRST116" ||
          /multiple \(or no\) rows/i.test(error.message ?? "");
        console.error(
          isDup
            ? "useCurrentBusinessId — multiple agents rows for this user (PGRST116): delete the duplicates in Supabase; `.limit(1)` now guards against it."
            : "useCurrentBusinessId — supabase error (see agents_read_fix.sql) — limited to 1 row, so this is a *permission/table* issue, not duplicates:",
          error.message ?? error,
        );
        return null;
      }
      return (data?.business_id as string | undefined) ?? null;
    },
    enabled: !sessionLoading,
    staleTime: 30_000,
  });
}

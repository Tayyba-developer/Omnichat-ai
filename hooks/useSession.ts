"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then((result: { data: { session: Session | null } }) => {
      if (!mounted) return;
      setSession(result.data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event: string, sessionState: Session | null) => {
      setSession(sessionState);
      setLoading(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}

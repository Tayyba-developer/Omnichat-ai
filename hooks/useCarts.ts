import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { useCurrentBusinessId } from "./useCurrentBusinessId";

export function useCarts() {
  const { data: businessId } = useCurrentBusinessId();
  return useQuery({
    queryKey: ["carts", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("carts")
        .select("*")
        .eq("business_id", businessId as string)
        .order("last_activity_at", { ascending: false });
      if (error) throw error;
      return data as Database["public"]["Tables"]["carts"]["Row"][];
    },
    enabled: Boolean(businessId),
  });
}

export function useSendCartReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase.from("carts").update({ reminder_sent_note: note }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["carts"] }),
  });
}

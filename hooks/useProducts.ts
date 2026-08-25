import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { useCurrentBusinessId } from "./useCurrentBusinessId";

export function useProducts() {
  const { data: businessId } = useCurrentBusinessId();
  return useQuery({
    queryKey: ["products", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("business_id", businessId as string)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Database["public"]["Tables"]["products"]["Row"][];
    },
    enabled: Boolean(businessId),
  });
}

export function useToggleProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("products")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });
}

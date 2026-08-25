import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { useCurrentBusinessId } from "./useCurrentBusinessId";

export function useOrders() {
  const { data: businessId } = useCurrentBusinessId();
  return useQuery({
    queryKey: ["orders", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(*)")
        .eq("business_id", businessId as string)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as (Database["public"]["Tables"]["orders"]["Row"] & {
        order_items: Database["public"]["Tables"]["order_items"]["Row"][];
      })[];
    },
    enabled: Boolean(businessId),
  });
}

function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "paid" | "fulfilled" | "cancelled";
    }) => {
      const { error } = await supabase
        .from("orders")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });
}

export function useFulfillOrder() {
  const m = useUpdateOrderStatus();
  return { ...m, fulfill: (id: string) => m.mutate({ id, status: "fulfilled" }) };
}

export function useCancelOrder() {
  const m = useUpdateOrderStatus();
  return { ...m, cancel: (id: string) => m.mutate({ id, status: "cancelled" }) };
}

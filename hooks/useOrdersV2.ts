import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentBusinessId } from "./useCurrentBusinessId";

export interface Order {
  id: string;
  business_id: string;
  conversation_id?: string;
  display_id: string;
  customer_name: string;
  channel_type: "whatsapp" | "instagram" | "messenger" | "web";
  status: "draft" | "pending_payment" | "paid" | "fulfilled" | "cancelled";
  total_cents: number;
  currency: string;
  payment_link?: string;
  stripe_payment_intent_id?: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id?: string;
  name: string;
  quantity: number;
  price_cents: number;
}

export function useOrders() {
  const { data: businessId } = useCurrentBusinessId();
  return useQuery({
    queryKey: ["orders", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("business_id", businessId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Order[];
    },
    enabled: Boolean(businessId),
  });
}

export function useOrderDetails(orderId: string | null) {
  return useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      if (!orderId) return null;

      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .maybeSingle();

      if (orderError || !order) return null;

      const { data: items } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", orderId);

      return {
        order,
        items: items || [],
      };
    },
    enabled: Boolean(orderId),
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      business_id: string;
      customer_name: string;
      channel_type: "whatsapp" | "instagram" | "messenger" | "web";
      items: Array<{ product_id: string; quantity: number }>;
      create_payment_link?: boolean;
    }) => {
      const response = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create order");
      }

      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useFulfillOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId }: { orderId: string }) => {
      const { error } = await supabase
        .from("orders")
        .update({ status: "fulfilled" })
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId }: { orderId: string }) => {
      const { error } = await supabase
        .from("orders")
        .update({ status: "cancelled" })
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

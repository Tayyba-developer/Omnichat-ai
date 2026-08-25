import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentBusinessId } from "./useCurrentBusinessId";

export interface Channel {
  id: string;
  business_id: string;
  channel_type: "whatsapp" | "instagram" | "messenger";
  name: string;
  status: "connected" | "disconnected" | "pending" | "live";
  provider: string;
  access_token?: string;
  webhook_secret?: string;
  phone_number_id?: string;
  page_id?: string;
  instagram_business_account_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function useChannels() {
  const { data: businessId } = useCurrentBusinessId();
  return useQuery({
    queryKey: ["channels", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channels")
        .select("*")
        .eq("business_id", businessId as string);
      if (error) throw error;
      return (data || []) as Channel[];
    },
    enabled: Boolean(businessId),
  });
}

export function useSaveChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (channel: Omit<Channel, "id" | "created_at" | "updated_at">) => {
      const { error } = await supabase.from("channels").upsert(channel as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channels"] }),
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { useCurrentBusinessId } from "./useCurrentBusinessId";

export function useAgentSettings() {
  const { data: businessId } = useCurrentBusinessId();
  return useQuery({
    queryKey: ["agent_settings", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_settings")
        .select("*")
        .eq("business_id", businessId as string)
        .maybeSingle();
      if (error) throw error;
      return data as Database["public"]["Tables"]["agent_settings"]["Row"] | null;
    },
    enabled: Boolean(businessId),
  });
}

export function useSaveAgentSettings() {
  const { data: businessId } = useCurrentBusinessId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      if (!businessId) throw new Error("No business_id yet");
      const { error } = await supabase
        .from("agent_settings")
        .upsert({ business_id: businessId, ...patch, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent_settings"] }),
  });
}

export function useTeamMembers() {
  const { data: businessId } = useCurrentBusinessId();
  return useQuery({
    queryKey: ["agents", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .eq("business_id", businessId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Database["public"]["Tables"]["agents"]["Row"][];
    },
    enabled: Boolean(businessId),
  });
}

export function useChannelConnections() {
  const { data: businessId } = useCurrentBusinessId();
  return useQuery({
    queryKey: ["channel_connections", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_connections")
        .select("*")
        .eq("business_id", businessId as string);
      if (error) throw error;
      return data as Database["public"]["Tables"]["channel_connections"]["Row"][];
    },
    enabled: Boolean(businessId),
  });
}

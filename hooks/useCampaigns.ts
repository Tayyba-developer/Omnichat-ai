import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { useCurrentBusinessId } from "./useCurrentBusinessId";

type Template = Database["public"]["Tables"]["message_templates"]["Row"];

export function useCampaigns() {
  const { data: businessId } = useCurrentBusinessId();
  return useQuery({
    queryKey: ["campaigns", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .eq("business_id", businessId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Database["public"]["Tables"]["campaigns"]["Row"][];
    },
    enabled: Boolean(businessId),
  });
}

export function useTemplates(channelType?: string) {
  const { data: businessId } = useCurrentBusinessId();

  return useQuery({
    queryKey: ["templates", businessId, channelType],
    queryFn: async () => {
      let query = supabase
        .from("message_templates")
        .select("*")
        .eq("business_id", businessId as string)
        .eq("is_active", true);

      if (channelType) {
        query = query.eq("channel_type", channelType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Template[];
    },
    enabled: Boolean(businessId),
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  const { data: businessId } = useCurrentBusinessId();

  return useMutation({
    mutationFn: async ({
      name,
      channelType,
      body,
      variables = [],
    }: {
      name: string;
      channelType: string;
      body: string;
      variables?: Array<{ name: string; required: boolean }>;
    }) => {
      const { data, error } = await supabase
        .from("message_templates")
        .insert({
          business_id: businessId as string,
          channel_type: channelType,
          name,
          body,
          variables,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["templates", businessId] });
    },
  });
}

export function useOptIns(channelType?: string) {
  const { data: businessId } = useCurrentBusinessId();

  return useQuery({
    queryKey: ["opt_ins", businessId, channelType],
    queryFn: async () => {
      let query = supabase
        .from("opt_ins")
        .select("*")
        .eq("business_id", businessId as string);

      if (channelType) {
        query = query.eq("channel_type", channelType);
      }

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: Boolean(businessId),
  });
}

export function useOptInCount(channelType: string) {
  const { data: businessId } = useCurrentBusinessId();

  return useQuery({
    queryKey: ["opt_in_count", businessId, channelType],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("opt_ins")
        .select("*", { count: "exact", head: true })
        .eq("business_id", businessId as string)
        .eq("channel_type", channelType)
        .eq("consent_status", "opted_in");

      if (error) throw error;
      return count || 0;
    },
    enabled: Boolean(businessId),
  });
}

export function useComplianceChecks() {
  const { data: businessId } = useCurrentBusinessId();
  return useQuery({
    queryKey: ["compliance_checks", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_checks")
        .select("*")
        .eq("business_id", businessId as string)
        .order("checked_at", { ascending: false });
      if (error) throw error;
      return data as Database["public"]["Tables"]["compliance_checks"]["Row"][];
    },
    enabled: Boolean(businessId),
  });
}

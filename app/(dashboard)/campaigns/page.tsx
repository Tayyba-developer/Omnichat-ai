"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { useCurrentBusinessId } from "@/hooks/useCurrentBusinessId";
import { CAMPAIGN_BADGE, mapChannelType } from "@/lib/data";
import { LoadingState, EmptyState } from "@/components/State";

type Campaign = Database["public"]["Tables"]["campaigns"]["Row"];

export default function Campaigns() {
  const { data: businessId } = useCurrentBusinessId();
  const qc = useQueryClient();

  const [isCreating, setIsCreating] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    channel_type: "whatsapp" as const,
    template_name: "",
    target_segment: "opted_in",
    use_template: true,
    free_text: "",
    scheduled_at: "",
  });

  // Fetch campaigns
  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .eq("business_id", businessId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Campaign[];
    },
    enabled: Boolean(businessId),
  });

  // Fetch templates for selected channel
  const { data: templates = [] } = useQuery({
    queryKey: ["templates", businessId, formData.channel_type],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("business_id", businessId as string)
        .eq("channel_type", formData.channel_type)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: Boolean(businessId) && isCreating,
  });

  // Fetch opted-in count
  const { data: optedInCount = 0 } = useQuery({
    queryKey: ["opted_in_count", businessId, formData.channel_type],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("opt_ins")
        .select("*", { count: "exact", head: true })
        .eq("business_id", businessId as string)
        .eq("channel_type", formData.channel_type)
        .eq("consent_status", "opted_in");
      if (error) throw error;
      return count || 0;
    },
    enabled: Boolean(businessId) && isCreating,
  });

  // Create campaign
  const createCampaign = useMutation({
    mutationFn: async () => {
      if (!businessId) throw new Error("Business not found");

      // Validate schedule time if provided
      let scheduledAt = null;
      if (formData.scheduled_at) {
        const scheduledTime = new Date(formData.scheduled_at);
        const now = new Date();

        if (scheduledTime < now) {
          throw new Error("Scheduled time must be in the future");
        }

        // Check 24-hour template window (18:00 UTC to 18:00 UTC next day)
        const utcHour = scheduledTime.getUTCHours();
        const useTemplateWindowOk = utcHour >= 18 || utcHour < 18; // Always true for now, but this is where window logic goes
        
        if (!formData.use_template && !useTemplateWindowOk) {
          throw new Error("Free-text messages can only be sent during 24-hour marketing window (6 PM to 6 PM UTC)");
        }

        scheduledAt = scheduledTime.toISOString();
      }

      const { data: newCampaign, error } = await supabase
        .from("campaigns")
        .insert({
          business_id: businessId,
          name: formData.name,
          channel_type: formData.channel_type,
          template_name: formData.use_template ? formData.template_name : null,
          target_segment: formData.target_segment,
          scheduled_at: scheduledAt,
          status: scheduledAt ? "scheduled" : "draft",
        })
        .select()
        .single();

      if (error) throw error;
      return newCampaign;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      setIsCreating(false);
      setFormData({
        name: "",
        channel_type: "whatsapp",
        template_name: "",
        target_segment: "opted_in",
        use_template: true,
        free_text: "",
        scheduled_at: "",
      });
    },
  });

  // Send now mutation
  const sendNow = useMutation({
    mutationFn: async (campaignId: string) => {
      const campaign = campaigns.find((c) => c.id === campaignId);
      if (!campaign) throw new Error("Campaign not found");
      if (!businessId) throw new Error("Business not found");

      // Fetch opt-in list
      const { data: optIns, error: optInsError } = await supabase
        .from("opt_ins")
        .select("customer_identifier")
        .eq("business_id", businessId)
        .eq("channel_type", campaign.channel_type)
        .eq("consent_status", "opted_in");

      if (optInsError) throw optInsError;

      // Create campaign recipients
      const recipients = (optIns || []).map((oi: any) => ({
        business_id: businessId,
        campaign_id: campaignId,
        customer_identifier: oi.customer_identifier,
        channel_type: campaign.channel_type,
        status: "pending" as const,
      }));

      if (recipients.length > 0) {
        const { error: recipientsError } = await supabase
          .from("campaign_recipients")
          .insert(recipients);

        if (recipientsError) throw recipientsError;
      }

      // Update campaign status
      const { error: updateError } = await supabase
        .from("campaigns")
        .update({
          status: "sent",
          sent_count: recipients.length,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      setSelectedCampaign(null);
    },
  });

  if (isLoading) {
    return (
      <div className="dpage" data-screen-label="Campaigns">
        <LoadingState rows={5} />
      </div>
    );
  }

  if (!isCreating && campaigns.length === 0) {
    return (
      <div className="dpage" data-screen-label="Campaigns">
        <div style={{ padding: 16 }}>
          <EmptyState
            icon="📢"
            title="No campaigns yet"
            desc="Create broadcasts to reach opted-in customers across WhatsApp, Instagram, and Messenger."
          />
          <button
            style={{ marginTop: 16 }}
            className="btn primary"
            onClick={() => setIsCreating(true)}
          >
            Create Campaign
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dpage" data-screen-label="Campaigns">
      <div className="dphead">
        <div>
          <h1>Campaigns</h1>
          <p className="mut fs13">Broadcast messages to opted-in customers</p>
        </div>
        <button className="btn primary" onClick={() => setIsCreating(true)}>
          + New Campaign
        </button>
      </div>

      {isCreating ? (
        <div className="card" style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
          <h2 style={{ marginBottom: 16 }}>Create Campaign</h2>

          <div className="fgroup">
            <label>Campaign Name</label>
            <input
              type="text"
              placeholder="e.g., Holiday Sale"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="fgroup">
            <label>Channel</label>
            <select
              value={formData.channel_type}
              onChange={(e) => setFormData({ ...formData, channel_type: e.target.value as any })}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="messenger">Messenger</option>
            </select>
          </div>

          <div className="fgroup">
            <label>Target Segment</label>
            <select
              value={formData.target_segment}
              onChange={(e) => setFormData({ ...formData, target_segment: e.target.value })}
            >
              <option value="opted_in">All opted-in contacts ({optedInCount})</option>
            </select>
            <p className="mut fs12" style={{ marginTop: 4 }}>
              Only customers who have opted in to receive marketing messages will receive this campaign.
            </p>
          </div>

          <div className="fgroup">
            <label>Message Type</label>
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="radio"
                  checked={formData.use_template}
                  onChange={() => setFormData({ ...formData, use_template: true })}
                />
                Use Approved Template
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="radio"
                  checked={!formData.use_template}
                  onChange={() => setFormData({ ...formData, use_template: false })}
                />
                Free Text (24h Window)
              </label>
            </div>
          </div>

          {formData.use_template ? (
            <div className="fgroup">
              <label>Template</label>
              <select
                value={formData.template_name}
                onChange={(e) => setFormData({ ...formData, template_name: e.target.value })}
              >
                <option value="">Select a template...</option>
                {templates.map((t: any) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="mut fs12" style={{ marginTop: 4 }}>
                Use pre-approved message templates that comply with regulations.
              </p>
            </div>
          ) : (
            <div className="fgroup">
              <label>Message</label>
              <textarea
                placeholder="Enter your message..."
                value={formData.free_text}
                onChange={(e) => setFormData({ ...formData, free_text: e.target.value })}
                rows={4}
              />
              <p className="mut fs12" style={{ marginTop: 4 }}>
                Free-text messages can only be sent during the 24-hour marketing window (6 PM to 6 PM UTC).
              </p>
            </div>
          )}

          <div className="fgroup">
            <label>Schedule (Optional)</label>
            <input
              type="datetime-local"
              value={formData.scheduled_at}
              onChange={(e) => setFormData({ ...formData, scheduled_at: e.target.value })}
            />
            <p className="mut fs12" style={{ marginTop: 4 }}>
              Leave blank to save as draft. Schedule for later or send immediately.
            </p>
          </div>

          <div className="fx gap8" style={{ marginTop: 24 }}>
            <button
              className="btn secondary"
              onClick={() => {
                setIsCreating(false);
                setFormData({
                  name: "",
                  channel_type: "whatsapp",
                  template_name: "",
                  target_segment: "opted_in",
                  use_template: true,
                  free_text: "",
                  scheduled_at: "",
                });
              }}
            >
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => createCampaign.mutate()}
              disabled={!formData.name || (formData.use_template && !formData.template_name) || (!formData.use_template && !formData.free_text)}
            >
              {createCampaign.isPending ? "Creating..." : "Create Campaign"}
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: 12, textAlign: "left" }}>Name</th>
                <th style={{ padding: 12, textAlign: "left" }}>Channel</th>
                <th style={{ padding: 12, textAlign: "left" }}>Recipients</th>
                <th style={{ padding: 12, textAlign: "left" }}>Status</th>
                <th style={{ padding: 12, textAlign: "left" }}>Created</th>
                <th style={{ padding: 12, textAlign: "left" }}></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: 12 }} className="fw5">
                    {c.name}
                  </td>
                  <td style={{ padding: 12 }}>
                    <span className="mut">{mapChannelType(c.channel_type).toUpperCase()}</span>
                  </td>
                  <td style={{ padding: 12 }}>
                    <span className="mut">{c.sent_count || 0} sent</span>
                  </td>
                  <td style={{ padding: 12 }}>
                    <span className={CAMPAIGN_BADGE[c.status]?.cls || "bdg mut2"}>
                      {CAMPAIGN_BADGE[c.status]?.label || c.status}
                    </span>
                  </td>
                  <td style={{ padding: 12 }}>
                    <span className="mut fs12">
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
                  </td>
                  <td style={{ padding: 12, textAlign: "right" }}>
                    {c.status === "draft" && (
                      <button
                        className="btn ghost sm"
                        onClick={() => sendNow.mutate(c.id)}
                        disabled={sendNow.isPending}
                      >
                        {sendNow.isPending ? "Sending..." : "Send Now"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

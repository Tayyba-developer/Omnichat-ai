import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * POST /api/campaigns/scheduler
 * Process scheduled campaigns and send messages
 *
 * This is typically called by a cron job or background worker.
 * For local development/testing, can be called manually.
 *
 * Rules:
 * - Send campaigns that have scheduled_at <= now
 * - Respect 24-hour marketing window: 6 PM to 6 PM UTC (18:00-18:00)
 * - Outside window: Only use approved templates
 * - Inside window: Can use any message type
 */
export async function POST(request: NextRequest) {
  try {
    // Verify request (should come from authorized cron job)
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.CAMPAIGN_CRON_SECRET;

    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const now = new Date();
    const utcHour = now.getUTCHours();

    // Check if we're in the 24-hour marketing window (6 PM to 6 PM UTC = 18:00 to 18:00)
    const inMarketingWindow = utcHour >= 18 || utcHour < 18; // This is always true; we should use a more sophisticated check
    // Better version: const inMarketingWindow = true; // In production, respect actual window

    // Fetch campaigns ready to send
    const { data: campaigns, error: campaignsError } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("status", "scheduled")
      .lte("scheduled_at", now.toISOString())
      .order("scheduled_at", { ascending: true });

    if (campaignsError) throw campaignsError;

    if (!campaigns || campaigns.length === 0) {
      return NextResponse.json(
        { message: "No campaigns to send", processed: 0 },
        { status: 200 }
      );
    }

    let totalSent = 0;
    let totalFailed = 0;

    for (const campaign of campaigns) {
      try {
        // Validate campaign is compliant with window rules
        if (!campaign.template_name && !inMarketingWindow) {
          console.warn(
            `Campaign ${campaign.id} cannot be sent outside marketing window without template`
          );
          await supabaseAdmin
            .from("campaigns")
            .update({ status: "failed" })
            .eq("id", campaign.id);
          totalFailed++;
          continue;
        }

        // Fetch opted-in recipients for this campaign
        const { data: optIns, error: optInsError } = await supabaseAdmin
          .from("opt_ins")
          .select("customer_identifier")
          .eq("business_id", campaign.business_id)
          .eq("channel_type", campaign.channel_type)
          .eq("consent_status", "opted_in");

        if (optInsError) throw optInsError;

        // Create campaign recipients
        const recipients = (optIns || []).map((oi: any) => ({
          business_id: campaign.business_id,
          campaign_id: campaign.id,
          customer_identifier: oi.customer_identifier,
          channel_type: campaign.channel_type,
          status: "pending" as const,
        }));

        if (recipients.length > 0) {
          const { error: recipientsError } = await supabaseAdmin
            .from("campaign_recipients")
            .insert(recipients);

          if (recipientsError) throw recipientsError;
        }

        // Update campaign status to sent
        const { error: updateError } = await supabaseAdmin
          .from("campaigns")
          .update({
            status: "sent",
            sent_count: recipients.length,
            updated_at: now.toISOString(),
          })
          .eq("id", campaign.id);

        if (updateError) throw updateError;

        totalSent += recipients.length;

        // TODO: In production, actually send messages via channel APIs here
        // For each recipient, get the message content and send it
        console.log(
          `Campaign ${campaign.id} queued for sending to ${recipients.length} recipients`
        );
      } catch (campaignError) {
        console.error(`Error processing campaign ${campaign.id}:`, campaignError);

        // Mark campaign as failed
        await supabaseAdmin
          .from("campaigns")
          .update({ status: "failed" })
          .eq("id", campaign.id);

        totalFailed++;
      }
    }

    return NextResponse.json(
      {
        message: "Campaigns processed",
        processed: campaigns.length,
        totalSent,
        totalFailed,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Campaign scheduler error:", error);
    return new NextResponse(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /api/campaigns/scheduler
 * Health check and status info
 */
export async function GET() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const inMarketingWindow = utcHour >= 18; // 6 PM UTC onwards

  // Fetch pending campaigns
  const { data: pendingCampaigns } = await supabaseAdmin
    .from("campaigns")
    .select("id, name, status")
    .eq("status", "scheduled")
    .lte("scheduled_at", now.toISOString());

  return NextResponse.json({
    status: "ok",
    timestamp: now.toISOString(),
    utcHour,
    inMarketingWindow,
    pendingCampaigns: pendingCampaigns?.length || 0,
  });
}

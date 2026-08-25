"use client";

import { CHANNELS, CAMPAIGN_BADGE, mapChannelType } from "@/lib/data";
import { useCampaigns, useComplianceChecks } from "@/hooks/useCampaigns";
import { useCurrentBusinessId } from "@/hooks/useCurrentBusinessId";
import { EmptyState, LoadingState, NotConnectedNotice } from "@/components/State";
import { useDashboardStore } from "@/store/useDashboardStore";

export default function Campaigns() {
  const { data: businessId, isLoading: bizLoading } = useCurrentBusinessId();
  const { data: camps, isLoading } = useCampaigns();
  const { data: checks, isLoading: checksLoading } = useComplianceChecks();
  const say = useDashboardStore((s) => s.say);

  const notConnected = !bizLoading && !businessId;
  const campaignList = camps || [];
  const checkList = checks || [];
  const failingCount = checkList.filter((c) => !c.passed).length;
  const canSend = checkList.length > 0 && failingCount === 0;

  return (
    <div className="pwrap">
      <div className="page" data-screen-label="Campaigns">
        <div className="phead">
          <div>
            <h1 className="h1">Campaigns</h1>
            <p className="sub">
              Cross-channel broadcasts — sends are blocked until every compliance check passes.
            </p>
          </div>
          <button
            className="btn-p"
            onClick={() =>
              canSend
                ? say("Wire this button to your campaign-creation flow")
                : say("Blocked by the compliance gate — resolve the failing check(s) below")
            }
          >
            New campaign
          </button>
        </div>

        {notConnected && <NotConnectedNotice />}

        <div className="card">
          <div className="cardh">
            Compliance gate
            {checkList.length > 0 && (
              <span className={failingCount ? "bdg warn" : "bdg ok"}>
                {failingCount ? `${failingCount} check failing` : "All checks passing"}
              </span>
            )}
          </div>
          {checksLoading ? (
            <LoadingState rows={2} />
          ) : checkList.length === 0 ? (
            <EmptyState
              title="No compliance checks configured"
              desc="Add rows to compliance_checks so campaign sends are gated correctly."
            />
          ) : (
            checkList.map((k) => (
              <div className="arow" key={k.id}>
                <div className={"ck " + (k.passed ? "ok" : "no")}>{k.passed ? "✓" : "✕"}</div>
                <div className="f1" style={{ minWidth: 0 }}>
                  <div className="fs13 fw6">{k.label}</div>
                  {k.description && <div className="mut fs12 mt2">{k.description}</div>}
                </div>
              </div>
            ))
          )}
        </div>

        {isLoading ? (
          <div className="mt16"><LoadingState rows={3} /></div>
        ) : campaignList.length === 0 ? (
          <div className="card mt16">
            <EmptyState
              icon="📣"
              title="No campaigns yet"
              desc="Scheduled and sent broadcasts across WhatsApp, Messenger, Instagram, and web will show up here."
            />
          </div>
        ) : (
          <div className="card mt16">
            <div className="trow cprow hd">
              <span>Campaign</span>
              <span>Channel</span>
              <span>Target segment</span>
              <span>Scheduled</span>
              <span>Status</span>
              <span>Sent / failed</span>
            </div>
            {campaignList.map((c) => {
              const channelKey = mapChannelType(c.channel_type);
              const ch = CHANNELS[channelKey];
              return (
                <div className="trow cprow" key={c.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="fw6 fs13 ell">{c.name}</div>
                    {c.template_name && <div className="mut fs11 mono">{c.template_name}</div>}
                  </div>
                  <div className="fx ac gap8">
                    <div className={ch.cls}>{ch.ab}</div>
                    <span className="fs12">{ch.label}</span>
                  </div>
                  <span className="mono fs11 mut ell">{c.target_segment}</span>
                  <span className="mut fs12">{c.scheduled_at ? new Date(c.scheduled_at).toLocaleString() : "—"}</span>
                  <span>
                    <span className={CAMPAIGN_BADGE[c.status].cls}>{CAMPAIGN_BADGE[c.status].label}</span>
                  </span>
                  <span className="fs12">
                    {c.sent_count || 0} / {c.failed_count || 0}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

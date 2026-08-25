"use client";

import { useState, useEffect } from "react";
import { PLANS } from "@/lib/data";
import { useDashboardStore } from "@/store/useDashboardStore";
import { useAgentSettings, useSaveAgentSettings, useTeamMembers } from "@/hooks/useSettings";
import { useCurrentBusinessId } from "@/hooks/useCurrentBusinessId";
import { EmptyState, LoadingState, NotConnectedNotice } from "@/components/State";
import type { Formality, SettingsTab } from "@/lib/types";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "team", label: "Team" },
  { id: "billing", label: "Plan & billing" },
];

export default function Settings() {
  const { data: businessId, isLoading: bizLoading } = useCurrentBusinessId();
  const stab = useDashboardStore((s) => s.stab);
  const setSettingsTab = useDashboardStore((s) => s.setSettingsTab);
  const say = useDashboardStore((s) => s.say);

  const { data: settings, isLoading: settingsLoading } = useAgentSettings();
  const saveSettings = useSaveAgentSettings();
  const { data: team, isLoading: teamLoading } = useTeamMembers();

  const [greet, setGreet] = useState("");
  const [formality, setFormality] = useState<Formality>("Neutral");
  const [emoji, setEmoji] = useState(false);
  const [cap, setCap] = useState("3");
  const [hist, setHist] = useState("20 messages / 24h");

  useEffect(() => {
    if (settings) {
      setGreet(settings.greeting_message);
      setFormality(settings.formality);
      setEmoji(settings.emoji_enabled);
      setCap(String(settings.clarification_cap));
      setHist(settings.history_window);
    }
  }, [settings]);

  const notConnected = !bizLoading && !businessId;

  const handleSave = () => {
    saveSettings.mutate(
      {
        greeting_message: greet,
        formality,
        emoji_enabled: emoji,
        clarification_cap: Number(cap),
        history_window: hist,
      },
      {
        onSuccess: () => say("Saved to agent_tone_config — the agent picks this up on its next reply"),
        onError: () => say("Couldn't save — check your Supabase connection"),
      }
    );
  };

  return (
    <div className="pwrap">
      <div className="page" data-screen-label="Settings">
        <div className="phead">
          <div>
            <h1 className="h1">Settings</h1>
            <p className="sub">Agent behavior, team access, and billing.</p>
          </div>
        </div>

        {notConnected && <NotConnectedNotice />}

        <div className="fx gap8" style={{ marginBottom: 16 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={"chip" + (stab === t.id ? " on" : "")}
              onClick={() => setSettingsTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {stab === "agent" &&
          (settingsLoading ? (
            <LoadingState rows={3} />
          ) : !settings && notConnected ? (
            <div className="card">
              <EmptyState
                title="No agent settings yet"
                desc="Insert a row into agent_settings for your business to configure tone, formality, and escalation rules here."
              />
            </div>
          ) : (
            <>
              <div className="card">
                <div className="cardh">
                  Tone &amp; branding
                  <span className="mono fs11 mut" style={{ fontWeight: 400 }}>
                    agent_tone_config
                  </span>
                </div>
                <div style={{ padding: "4px 16px 16px" }}>
                  <div className="flab" style={{ marginBottom: 6 }}>
                    Greeting message
                  </div>
                  <textarea
                    className="inp w100"
                    style={{ resize: "vertical", minHeight: 64, fontFamily: "inherit" }}
                    value={greet}
                    onChange={(e) => setGreet(e.target.value)}
                  />
                </div>
                <div className="frow">
                  <div>
                    <div className="flab">Formality</div>
                    <div className="fdesc">How the agent phrases replies across every channel.</div>
                  </div>
                  <select className="inp" value={formality} onChange={(e) => setFormality(e.target.value as Formality)}>
                    <option value="Casual">Casual</option>
                    <option value="Neutral">Neutral</option>
                    <option value="Formal">Formal</option>
                  </select>
                </div>
                <div className="frow">
                  <div>
                    <div className="flab">Emoji use</div>
                    <div className="fdesc">Allow the agent to use emoji in replies.</div>
                  </div>
                  <button className={"tgl" + (emoji ? " on" : "")} onClick={() => setEmoji((v) => !v)} aria-label="Toggle emoji" />
                </div>
              </div>

              <div className="card mt16">
                <div className="cardh">Escalation &amp; memory</div>
                <div className="frow" style={{ borderTop: "none" }}>
                  <div>
                    <div className="flab">Clarification attempts before escalation</div>
                    <div className="fdesc">
                      After this many unresolved clarifying questions, the bot hands off to a human.
                    </div>
                  </div>
                  <select className="inp" value={cap} onChange={(e) => setCap(e.target.value)}>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </select>
                </div>
                <div className="frow">
                  <div>
                    <div className="flab">Conversation history window</div>
                    <div className="fdesc">Context passed to Gemini on every call — whichever limit is shorter wins.</div>
                  </div>
                  <select className="inp" value={hist} onChange={(e) => setHist(e.target.value)}>
                    <option value="20 messages / 24h">20 messages / 24h</option>
                    <option value="10 messages / 12h">10 messages / 12h</option>
                    <option value="50 messages / 48h">50 messages / 48h</option>
                  </select>
                </div>
                <div className="frow">
                  <div>
                    <div className="flab">Payment confirmation</div>
                    <div className="fdesc">
                      The agent never generates a payment link without an explicit customer &ldquo;yes&rdquo;. This
                      rule is not configurable.
                    </div>
                  </div>
                  <span className="bdg ok">Always on</span>
                </div>
              </div>

              <div className="fx" style={{ justifyContent: "flex-end", marginTop: 14 }}>
                <button className="btn-p" onClick={handleSave} disabled={saveSettings.isPending}>
                  Save changes
                </button>
              </div>
            </>
          ))}

        {stab === "team" && (
          <>
            <div className="card">
              <div className="cardh">
                Agents
                <button className="btn sm" onClick={() => say("Wire this to a Supabase Auth invite flow")}>
                  Invite agent
                </button>
              </div>
              {teamLoading ? (
                <LoadingState rows={2} />
              ) : !team || team.length === 0 ? (
                <EmptyState title="No team members yet" desc="Agents you add to the agents table will appear here." />
              ) : (
                team.map((a) => {
                  const initials = a.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("");
                  return (
                    <div className="arow" key={a.id}>
                      <div className="avat">{initials}</div>
                      <div className="f1">
                        <div className="fw6 fs13">{a.name}</div>
                        <div className="mut fs12 mt2">{a.email}</div>
                      </div>
                      <span className={a.role === "owner" ? "bdg ok" : "bdg mut2"}>{a.role}</span>
                    </div>
                  );
                })
              )}
            </div>
            <p className="mut fs12" style={{ marginTop: 12 }}>
              Handed-off conversations can be assigned to any agent. Row-level security scopes all data to this
              business.
            </p>
          </>
        )}

        {stab === "billing" && (
          <>
            <div className="notice">
              Plans shown below are static — wire this tab to your Stripe subscription data when billing is ready.
            </div>
            <div className="fx gap12" style={{ alignItems: "stretch" }}>
              {PLANS.map((p) => (
                <div className={"plan" + (p.cur ? " cur" : "")} key={p.t}>
                  <div className="fx ac jb">
                    <span className="fw6 fs14">{p.t}</span>
                    {p.cur && <span className="bdg ok">Current plan</span>}
                  </div>
                  <div className="kv">
                    {p.p}
                    <span className="mut fs12" style={{ fontWeight: 400 }}>
                      {" "}
                      /mo
                    </span>
                  </div>
                  <div className="mut fs12" style={{ lineHeight: 1.5 }}>
                    {p.d}
                  </div>
                  <div className="f1" />
                  {!p.cur && (
                    <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => say("Wire this to your Stripe subscription flow")}>
                      Switch to {p.t}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

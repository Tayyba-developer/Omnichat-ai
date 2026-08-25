"use client";

import { useEffect, useState } from "react";
import { useDashboardStore, mapConvStatus } from "@/store/useDashboardStore";
import type { ConversationData, MessageData } from "@/store/useDashboardStore";
import { CONV_BADGE } from "@/lib/data";
import { EmptyState, LoadingState } from "@/components/State";

// The new conversations table has no business_id. It exposes:
//   id, wa_id, name, last_message, status ('open' | 'needs_human' | 'closed')
//
// UI status mapping (done via mapConvStatus in the store):
//   open        -> bot_active
//   needs_human -> handed_off
//   closed      -> closed

const FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "bot_active", label: "Bot" },
  { id: "handed_off", label: "Needs human" },
  { id: "closed", label: "Closed" },
];

// Get the UI-mapped status (open -> bot_active, needs_human -> handed_off, closed -> closed).
function getUiStatus(c: ConversationData) {
  return mapConvStatus(c.status);
}

export default function Inbox() {
  // ---- Data from the backend store ----
  const conversations = useDashboardStore((s) => s.conversations);
  const messages = useDashboardStore((s) => s.messages);
  const dashboardLoading = useDashboardStore((s) => s.dashboardLoading);
  const fetchConversations = useDashboardStore((s) => s.fetchConversations);
  const fetchConversationThread = useDashboardStore((s) => s.fetchConversationThread);

  // ---- UI selection state ----
  const sel = useDashboardStore((s) => s.sel);
  const convFilter = useDashboardStore((s) => s.convFilter);
  const setConvFilter = useDashboardStore((s) => s.setConvFilter);
  const selectConv = useDashboardStore((s) => s.selectConv);

  // ---- Debounced Inbox search (client-side) ----
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch conversations on mount.
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const list = conversations;

  // Selected conversation (default to the first one).
  const sc: ConversationData | null =
    (sel ? list.find((c) => c.id === sel) ?? list[0] : list[0]) ?? null;

  // Load the thread for the selected conversation whenever it changes.
  useEffect(() => {
    if (sc?.id) fetchConversationThread(sc.id);
  }, [sc?.id, fetchConversationThread]);

  if (dashboardLoading && list.length === 0) {
    return (
      <div className="ipage" data-screen-label="Inbox">
        <LoadingState rows={5} />
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="ipage" data-screen-label="Inbox" style={{ display: "block" }}>
        <EmptyState
          icon="💬"
          title="No conversations yet"
          desc="Send a WhatsApp message to test. Conversations will show up here as customers message in."
        />
      </div>
    );
  }

  // Client-side filter by status (mapped) AND debounced search text.
  const q = debouncedSearch.trim().toLowerCase();
  const shown = list.filter((c) => {
    const ui = mapConvStatus(c.status);
    const matchesFilter = convFilter === "all" || ui === convFilter;
    const matchesSearch =
      !q ||
      (c.name || "").toLowerCase().includes(q) ||
      (c.wa_id || "").toLowerCase().includes(q) ||
      (c.last_message || "").toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  // Per-filter counts (based on the full fetched list, not the search).
  const countFor = (id: string) =>
    id === "all"
      ? list.length
      : list.filter((c) => mapConvStatus(c.status) === id).length;
return (
    <div className="ipage" data-screen-label="Inbox">
      {/* ---- Left: conversation list ---- */}
      <div className="clist">
        <div className="clhead">
          <span className="fw6 fs15">Inbox</span>
          <span className="mut fs12">{list.length} conversations</span>
        </div>

        <div style={{ padding: "0 14px 8px" }}>
          <input
            className="inp"
            placeholder="Search conversations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="fx gap8 wrap" style={{ padding: "0 14px 10px" }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={"chip" + (convFilter === f.id ? " on" : "")}
              onClick={() => setConvFilter(f.id as never)}
            >
              {f.label} {countFor(f.id)}
            </button>
          ))}
        </div>

        <div className="f1" style={{ overflow: "auto", padding: "4px 8px 12px" }}>
          {shown.length === 0 ? (
            <EmptyState title="No matches" desc="No conversations match that search or filter." />
          ) : (
            shown.map((c) => {
              const ui = mapConvStatus(c.status);
              return (
                <button
                  key={c.id}
                  className={"convi" + (c.id === sc?.id ? " on" : "")}
                  onClick={() => selectConv(c.id)}
                >
                  <div className="ch wa">WA</div>
                  <div className="f1" style={{ minWidth: 0 }}>
                    <div className="fx ac jb gap8">
                      <span className="fw6 fs13 ell">{c.name || c.wa_id}</span>
                      <span className="mut fs11 noshrink">
                        {c.created_at
                          ? new Date(c.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </span>
                    </div>
                    <div className="mut fs12 ell mt2">{c.last_message || "—"}</div>
                  </div>
                  {ui === "handed_off" && <div className="adot warn noshrink" />}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ---- Right: thread + customer ---- */}
      {sc && (
        <>
          <div className="thr">
            <div className="thead2">
              <div style={{ minWidth: 0 }}>
                <div className="fx ac gap8">
                  <span className="fw6 fs14">{sc.name || sc.wa_id}</span>
                  <span className={CONV_BADGE[getUiStatus(sc)].cls}>
                    {CONV_BADGE[getUiStatus(sc)].label}
                  </span>
                  <span className="chip" style={{ padding: "4px 8px", borderRadius: "4px" }}>
                    WhatsApp
                  </span>
                </div>
                <div className="mut fs12 mt2 ell">{sc.wa_id || "—"}</div>
              </div>
            </div>

            <div className="mlist">
              {renderMessages(messages)}
            </div>
          </div>

          <div className="ctx">
            <div className="slab">Customer</div>
            <div className="card" style={{ padding: 14 }}>
              <div className="fw6 fs13">{sc.name || "—"}</div>
              <div className="mut fs12 mt2">{sc.wa_id || "—"}</div>
              <div className="frow2">
                <span className="mut fs12">Channel</span>
                <span className="fs12 fw6">WhatsApp</span>
              </div>
              <div className="frow2">
                <span className="mut fs12">Status</span>
                <span className="fs12 fw6">{CONV_BADGE[getUiStatus(sc)].label}</span>
              </div>
              <div className="frow2">
                <span className="mut fs12">Last message</span>
                <span className="fs12 ell" style={{ maxWidth: 140 }}>
                  {sc.last_message || "—"}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Render the message thread. inbound = left (customer), outbound = right (agent).
function renderMessages(msgs: MessageData[]) {
  if (!msgs || msgs.length === 0) {
    return <EmptyState title="No messages yet" desc="This conversation has no messages." />;
  }
  return msgs.map((m) => {
    const isInbound = m.direction === "inbound";
    return (
      <div className={"mrow " + (isInbound ? "l" : "r")} key={m.id}>
        <div className={"msg " + (isInbound ? "cust" : "agent")}>{m.text}</div>
        <div className="mmeta">
          {isInbound ? "Customer" : "Agent"} ·{" "}
          {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    );
  });
}
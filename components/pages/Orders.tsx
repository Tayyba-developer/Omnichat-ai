"use client";

import { CHANNELS, ORDER_BADGE, mapChannelType } from "@/lib/data";
import { useDashboardStore } from "@/store/useDashboardStore";
import type { OrderFilter } from "@/store/useDashboardStore";
import { useOrders, useFulfillOrder, useCancelOrder } from "@/hooks/useOrders";
import { useCurrentBusinessId } from "@/hooks/useCurrentBusinessId";
import { EmptyState, LoadingState, NotConnectedNotice } from "@/components/State";

const CHIPS: { id: OrderFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "pending_payment", label: "Pending payment" },
  { id: "paid", label: "Paid" },
  { id: "fulfilled", label: "Fulfilled" },
  { id: "cancelled", label: "Cancelled" },
];

export default function Orders() {
  const { data: businessId, isLoading: bizLoading } = useCurrentBusinessId();
  const { data: orders, isLoading } = useOrders();
  const { fulfill } = useFulfillOrder();
  const { cancel } = useCancelOrder();
  const ordFilter = useDashboardStore((s) => s.ordFilter);
  const setOrderFilter = useDashboardStore((s) => s.setOrderFilter);
  const expOrd = useDashboardStore((s) => s.expOrd);
  const toggleExpandOrder = useDashboardStore((s) => s.toggleExpandOrder);

  const notConnected = !bizLoading && !businessId;
  const list = orders || [];

  const counts: Record<string, number> = { all: list.length };
  list.forEach((o) => {
    counts[o.status] = (counts[o.status] || 0) + 1;
  });

  const filtered = list.filter((o) => ordFilter === "all" || o.status === ordFilter);

  return (
    <div className="pwrap">
      <div className="page" data-screen-label="Orders">
        <div className="phead">
          <div>
            <h1 className="h1">Orders</h1>
            <p className="sub">
              Created in chat by the agent — payment links move an order to paid via Stripe webhook.
            </p>
          </div>
        </div>

        {notConnected && <NotConnectedNotice />}

        <div className="fx gap8 wrap" style={{ marginBottom: 12 }}>
          {CHIPS.map((c) => (
            <button
              key={c.id}
              className={"chip" + (ordFilter === c.id ? " on" : "")}
              onClick={() => setOrderFilter(c.id)}
            >
              {c.label} {counts[c.id] || 0}
            </button>
          ))}
        </div>

        {isLoading ? (
          <LoadingState rows={5} />
        ) : list.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="🧾"
              title="No orders yet"
              desc="Orders your AI agent creates in chat will show up here, along with payment links and Stripe status."
            />
          </div>
        ) : (
          <div className="card">
            <div className="trow orow hd">
              <span>Order</span>
              <span>Customer</span>
              <span>Items</span>
              <span>Total</span>
              <span>Status</span>
              <span>Updated</span>
            </div>
            {filtered.map((o) => {
              const channelKey = mapChannelType(o.channel_type);
              const ch = CHANNELS[channelKey];
              const items = o.order_items || [];
              const count = items.reduce((a, i) => a + i.quantity, 0);
              const countLabel = count + (items.length > 1 || count > 1 ? " items" : " item");
              const exp = expOrd === o.id;
              const isDraft = o.status === "draft";
              const canFulfill = o.status === "paid";
              const canCancel = o.status === "pending_payment";

              return (
                <div key={o.id}>
                  <button className="orowbtn" onClick={() => toggleExpandOrder(o.id)}>
                    <div className="trow orow" style={{ borderTop: "none" }}>
                      <span className="mono fs12 fw6">{o.display_id}</span>
                      <div className="fx ac gap8" style={{ minWidth: 0 }}>
                        <div className={ch.cls}>{ch.ab}</div>
                        <span className="fs13 ell">{o.customer_name}</span>
                      </div>
                      <span className="mut fs13">{countLabel}</span>
                      <span className="fs13 fw6">${(o.total_cents / 100).toFixed(2)}</span>
                      <span>
                        <span className={ORDER_BADGE[o.status].cls}>{ORDER_BADGE[o.status].label}</span>
                      </span>
                      <span className="mut fs12">{new Date(o.updated_at).toLocaleDateString()}</span>
                    </div>
                  </button>
                  {exp && (
                    <div className="oexp">
                      {items.map((i) => (
                        <div className="fx jb fs13" style={{ padding: "6px 0", gap: 10 }} key={i.id}>
                          <span>
                            {i.quantity}× {i.name}
                          </span>
                          <span className="mut">${(i.price_cents / 100).toFixed(2)}</span>
                        </div>
                      ))}
                      {o.payment_link && (
                        <div className="fx ac jb fs12" style={{ padding: "6px 0", gap: 10 }}>
                          <span className="mut">Payment link</span>
                          <span className="mono">{o.payment_link}</span>
                        </div>
                      )}
                      {o.stripe_payment_intent_id && (
                        <div className="fx ac jb fs12" style={{ padding: "6px 0", gap: 10 }}>
                          <span className="mut">stripe_payment_intent_id</span>
                          <span className="mono">{o.stripe_payment_intent_id}</span>
                        </div>
                      )}
                      <div className="fx ac gap8" style={{ paddingTop: 8 }}>
                        {isDraft && (
                          <span className="mut fs12">
                            Awaiting explicit customer confirmation in chat — no payment link is generated before a
                            &ldquo;yes&rdquo;.
                          </span>
                        )}
                        {canFulfill && (
                          <button
                            className="btn sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              fulfill(o.id);
                            }}
                          >
                            Mark fulfilled
                          </button>
                        )}
                        {canCancel && (
                          <button
                            className="btn sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancel(o.id);
                            }}
                          >
                            Cancel order
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

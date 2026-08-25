import type { Plan } from "./types";

export const CHANNELS: Record<string, { cls: string; ab: string; label: string }> = {
  wa: { cls: "ch wa", ab: "WA", label: "WhatsApp" },
  ig: { cls: "ch ig", ab: "IG", label: "Instagram" },
  ms: { cls: "ch ms", ab: "MS", label: "Messenger" },
  web: { cls: "ch web", ab: "</>", label: "Web widget" },
};

/**
 * Map database channel_type to CHANNELS abbreviation
 */
export function mapChannelType(channelType: string): string {
  const mapping: Record<string, string> = {
    whatsapp: "wa",
    instagram: "ig",
    messenger: "ms",
    web: "web",
  };
  return mapping[channelType] || channelType;
}

export const NAV_ITEMS: { id: string; label: string; d: string }[] = [
  { id: "overview", label: "Overview", d: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" },
  { id: "inbox", label: "Inbox", d: "M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" },
  { id: "catalog", label: "Catalog", d: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7.01 7h.01" },
  { id: "orders", label: "Orders", d: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96 12 12.01l8.73-5.05 M12 22.08V12" },
  { id: "carts", label: "Carts", d: "M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M20 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" },
  { id: "campaigns", label: "Campaigns", d: "m3 11 18-5v12L3 14v-3z M11.6 16.8a3 3 0 1 1-5.8-1.6" },
  { id: "channels", label: "Channels", d: "M4.9 19.1C1 15.2 1 8.8 4.9 4.9 M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5 M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5 M19.1 4.9C23 8.8 23 15.2 19.1 19.1 M12 12h.01" },
  { id: "settings", label: "Settings", d: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6" },
];

export const THEME_ICON = {
  light: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  dark: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42",
};

export const ORDER_BADGE: Record<string, { cls: string; label: string }> = {
  draft: { cls: "bdg mut2", label: "Draft" },
  pending_payment: { cls: "bdg warn", label: "Pending payment" },
  paid: { cls: "bdg ok", label: "Paid" },
  fulfilled: { cls: "bdg inf", label: "Fulfilled" },
  cancelled: { cls: "bdg err", label: "Cancelled" },
};

export const CART_BADGE: Record<string, { cls: string; label: string }> = {
  active: { cls: "bdg ok", label: "active" },
  abandoned: { cls: "bdg warn", label: "abandoned" },
  converted: { cls: "bdg inf", label: "converted" },
};

export const CAMPAIGN_BADGE: Record<string, { cls: string; label: string }> = {
  draft: { cls: "bdg mut2", label: "draft" },
  scheduled: { cls: "bdg inf", label: "scheduled" },
  sent: { cls: "bdg ok", label: "sent" },
  failed: { cls: "bdg err", label: "failed" },
};

export const CONV_BADGE: Record<string, { cls: string; label: string }> = {
  bot_active: { cls: "bdg ok", label: "Bot active" },
  handed_off: { cls: "bdg warn", label: "Handed off" },
  closed: { cls: "bdg mut2", label: "Closed" },
};

// Billing/plan tiers are static product config, not customer data — fine to
// keep hardcoded until Stripe subscriptions are wired into the billing tab.
export const PLANS: Plan[] = [
  { t: "Starter", p: "$29", d: "1 channel · 500 conversations/mo · CSV catalog sync", cur: false },
  { t: "Growth", p: "$79", d: "3 channels · 3,000 conversations/mo · cart recovery automation", cur: true },
  { t: "Pro", p: "$199", d: "All channels · unlimited conversations · campaigns & priority support", cur: false },
];

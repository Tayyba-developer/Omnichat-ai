import { create } from "zustand";
import type { PageId, SettingsTab, ThemeOverride } from "@/lib/types";

export type ConvFilter = "all" | "bot_active" | "handed_off" | "closed";
export type OrderFilter = "all" | "draft" | "pending_payment" | "paid" | "fulfilled" | "cancelled";

// ---- Backend data types ----

export interface DashboardStats {
  open: number;
  waiting_for_human: number;
  pending_payment: number;
  pending_payment_total_cents: number;
  pending_orders: Array<{
    id: string;
    display_id: string | null;
    customer_name: string | null;
    total_cents: number | null;
    currency: string;
  }>;
  carts_at_risk: number;
  needs_attention: number;
  agent_activity: {
    open: number;
    waiting: number;
    resolved: number;
    total: number;
  };
  orders: {
    total: number;
    pending: number;
    paid: number;
    abandoned: number;
  };
  total_conversations: number;
}

export interface ConversationData {
  id: string;
  wa_id: string;
  name: string | null;
  last_message: string | null;
  status: string; // 'open' | 'needs_human' | 'closed'
  created_at: string;
  updated_at?: string | null;
}

// A message inside a conversation thread (from backend /api/dashboard/conversation/:id).
export interface MessageData {
  id: string;
  conversation_id: string;
  wa_id: string | null;
  direction: "inbound" | "outbound";
  text: string;
  timestamp: string;
  status: string;
}

export type ConvUiStatus = "bot_active" | "handed_off" | "closed";

// Map backend conversation.status to the UI filter/badge status.
//   open        -> bot_active (bot is handling)
//   needs_human -> handed_off (needs a human)
//   closed      -> closed
export function mapConvStatus(status: string): ConvUiStatus {
  if (status === "needs_human") return "handed_off";
  if (status === "closed") return "closed";
  return "bot_active"; // open + fallback
}

interface UIState {
  // --- Page / UI state (unchanged) ---
  page: PageId;
  themeOverride: ThemeOverride;
  sysDark: boolean;

  sel: string | null;
  convFilter: ConvFilter;
  draft: string;

  q: string;
  ordFilter: OrderFilter;
  expOrd: string | null;

  toast: string | null;

  widgetOpen: boolean;
  stab: SettingsTab;

  setPage: (p: PageId) => void;
  toggleTheme: () => void;
  setSysDark: (v: boolean) => void;

  selectConv: (id: string) => void;
  setConvFilter: (f: ConvFilter) => void;
  setDraft: (v: string) => void;

  setQuery: (v: string) => void;
  setOrderFilter: (f: OrderFilter) => void;
  toggleExpandOrder: (id: string) => void;

  toggleWidget: () => void;
  setSettingsTab: (t: SettingsTab) => void;
  say: (msg: string) => void;

  // --- Dashboard data (fetched from backend API on port 5000) ---
  stats: DashboardStats | null;
  conversations: ConversationData[];
  messages: MessageData[];
  dashboardLoading: boolean;
  dashboardError: string | null;
  searchQuery: string;

  fetchStats: () => Promise<void>;
  fetchConversations: (search?: string) => Promise<void>;
  fetchConversationThread: (id: string) => Promise<void>;
  refreshDashboard: () => Promise<void>;
  setSearchQuery: (q: string) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useDashboardStore = create<UIState>((set, get) => ({
  // --- Page / UI state (unchanged) ---
  page: "overview",
  themeOverride: null,
  sysDark: false,

  sel: null,
  convFilter: "all",
  draft: "",

  q: "",
  ordFilter: "all",
  expOrd: null,

  toast: null,

  widgetOpen: true,
  stab: "agent",

  say: (msg) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 3000);
  },

  setPage: (p) => set({ page: p }),
  toggleTheme: () =>
    set((s) => {
      const dark = s.themeOverride ? s.themeOverride === "dark" : s.sysDark;
      return { themeOverride: dark ? "light" : "dark" };
    }),
  setSysDark: (v) => set({ sysDark: v }),

  selectConv: (id) => set({ sel: id, draft: "" }),
  setConvFilter: (f) => set({ convFilter: f }),
  setDraft: (v) => set({ draft: v }),

  setQuery: (v) => set({ q: v }),
  setOrderFilter: (f) => set({ ordFilter: f }),
  toggleExpandOrder: (id) => set((s) => ({ expOrd: s.expOrd === id ? null : id })),

  toggleWidget: () => set((s) => ({ widgetOpen: !s.widgetOpen })),
  setSettingsTab: (t) => set({ stab: t }),

  // --- Dashboard data ---
  stats: null,
  conversations: [],
  messages: [],
  dashboardLoading: false,
  dashboardError: null,
  searchQuery: "",

  fetchStats: async () => {
    set({ dashboardLoading: true, dashboardError: null });
    try {
      const res = await fetch("/api/dashboard/stats");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DashboardStats;
      set({ stats: data });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load stats";
      console.error("[dashboard] fetchStats error:", msg);
      set({ dashboardError: msg });
    } finally {
      set({ dashboardLoading: false });
    }
  },

  fetchConversations: async (search?: string) => {
    try {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (search) params.set("search", search);

      const res = await fetch(`/api/dashboard/conversations?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { conversations: ConversationData[]; total: number };
      set({ conversations: data.conversations ?? [] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load conversations";
      console.error("[dashboard] fetchConversations error:", msg);
      set((s) => ({ dashboardError: msg }));
    }
  },

  refreshDashboard: async () => {
    set({ dashboardLoading: true, dashboardError: null });
    try {
      await Promise.all([
        get().fetchStats(),
        get().fetchConversations(get().searchQuery),
      ]);
    } finally {
      set({ dashboardLoading: false });
    }
  },

  fetchConversationThread: async (id: string) => {
    try {
      const res = await fetch(`/api/dashboard/conversation/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        conversation: ConversationData;
        messages: MessageData[];
      };
      set({ messages: data.messages ?? [] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load messages";
      console.error("[dashboard] fetchConversationThread error:", msg);
      set((s) => ({ dashboardError: msg }));
    }
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q });
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      get().fetchConversations(q);
    }, 300);
  },
}));

export const isDark = (s: Pick<UIState, "themeOverride" | "sysDark">) =>
  s.themeOverride ? s.themeOverride === "dark" : s.sysDark;

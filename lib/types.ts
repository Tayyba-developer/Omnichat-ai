export type ChannelId = "wa" | "ig" | "ms" | "web";

export type PageId =
  | "overview"
  | "inbox"
  | "catalog"
  | "orders"
  | "carts"
  | "campaigns"
  | "channels"
  | "settings";

export type MsgSender = "cust" | "bot" | "agent" | "tool" | "sys";

export interface Message {
  s: MsgSender;
  t: string;
  at: string;
}

export type ConvStatus = "bot_active" | "handed_off" | "closed";

export interface Conversation {
  id: string;
  name: string;
  ident: string;
  ch: ChannelId;
  chL: string;
  status: ConvStatus;
  time: string;
  last: string;
  optIn: boolean;
  agent: string | null;
  orderId: string | null;
  cartId: string | null;
  flow: string | null;
  msgs: Message[];
}

export interface OrderItem {
  n: string;
  q: number;
  p: string;
}

export type OrderStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "fulfilled"
  | "cancelled";

export interface Order {
  id: string;
  cust: string;
  ch: ChannelId;
  chL: string;
  status: OrderStatus;
  items: OrderItem[];
  total: string;
  upd: string;
  link: string | null;
  pi: string | null;
}

export type CartStatus = "active" | "abandoned" | "converted";

export interface Cart {
  id: string;
  cust: string;
  ch: ChannelId;
  items: string;
  val: string;
  last: string;
  status: CartStatus;
  within: boolean;
  sent: string | null;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  price: string;
  src: "csv" | "manual";
  tint: string;
  active: boolean;
  upd: string;
}

export type CampaignStatus = "draft" | "scheduled" | "sent" | "failed";

export interface Campaign {
  n: string;
  ch: ChannelId;
  seg: string;
  when: string;
  status: CampaignStatus;
  counts: string;
  tpl: string;
}

export interface ComplianceCheck {
  ok: boolean;
  t: string;
  d: string;
}

export interface Agent {
  n: string;
  e: string;
  r: "owner" | "agent";
}

export interface Plan {
  t: string;
  p: string;
  d: string;
  cur: boolean;
}

export type ThemeOverride = "light" | "dark" | null;
export type Formality = "Casual" | "Neutral" | "Formal";
export type SettingsTab = "agent" | "team" | "billing";

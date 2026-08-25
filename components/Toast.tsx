"use client";

import { useDashboardStore } from "@/store/useDashboardStore";

export default function Toast() {
  const toast = useDashboardStore((s) => s.toast);
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}

"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { useCurrentBusinessId } from "@/hooks/useCurrentBusinessId";
import { mapChannelType } from "@/lib/data";
import { LoadingState, EmptyState } from "@/components/State";

type OptIn = Database["public"]["Tables"]["opt_ins"]["Row"];

export default function OptInManagement() {
  const { data: businessId } = useCurrentBusinessId();
  const qc = useQueryClient();

  const [selectedChannel, setSelectedChannel] = useState<string>("whatsapp");
  const [searchTerm, setSearchTerm] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);

  // Fetch opt-ins
  const { data: optIns = [], isLoading } = useQuery({
    queryKey: ["opt_ins", businessId, selectedChannel],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opt_ins")
        .select("*")
        .eq("business_id", businessId as string)
        .eq("channel_type", selectedChannel)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as OptIn[];
    },
    enabled: Boolean(businessId),
  });

  // Filter by search
  const filtered = optIns.filter((oi) =>
    oi.customer_identifier.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Update opt-in status
  const updateOptIn = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "opted_in" | "opted_out";
    }) => {
      const { error } = await supabase
        .from("opt_ins")
        .update({ consent_status: status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opt_ins"] });
    },
  });

  // Bulk import opt-ins
  const bulkImport = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const lines = text.split("\n").filter((l) => l.trim());

      const optInsList = lines.map((line) => ({
        business_id: businessId,
        channel_type: selectedChannel,
        customer_identifier: line.trim(),
        consent_status: "opted_in" as const,
        source: "manual" as const,
      }));

      // Upsert to handle duplicates
      const { error } = await supabase
        .from("opt_ins")
        .upsert(optInsList, { onConflict: "business_id,channel_type,customer_identifier" });

      if (error) throw error;
      return optInsList.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opt_ins"] });
      setImportFile(null);
    },
  });

  if (isLoading) {
    return <LoadingState rows={5} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h3 style={{ marginBottom: 16 }}>Customer Opt-Ins</h3>
        <p className="mut">Manage customer consent for receiving marketing messages.</p>
      </div>

      <div className="card">
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 8 }}>Channel</label>
          <select
            value={selectedChannel}
            onChange={(e) => {
              setSelectedChannel(e.target.value);
              setSearchTerm("");
            }}
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="messenger">Messenger</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Search customer identifier..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ flex: 1 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="btn secondary sm">Import CSV</span>
            <input
              type="file"
              accept=".csv,.txt"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              style={{ display: "none" }}
            />
          </label>
          {importFile && (
            <button
              className="btn primary sm"
              onClick={() => importFile && bulkImport.mutate(importFile)}
              disabled={bulkImport.isPending}
            >
              {bulkImport.isPending ? "Importing..." : "Import"}
            </button>
          )}
        </div>

        {filtered.length === 0 && !searchTerm ? (
          <EmptyState
            icon="👥"
            title="No opted-in customers"
            desc={`No customers have opted in to receive ${mapChannelType(selectedChannel).toUpperCase()} messages yet.`}
          />
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <p className="mut">No results found</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: 12, textAlign: "left" }}>Customer ID</th>
                  <th style={{ padding: 12, textAlign: "left" }}>Status</th>
                  <th style={{ padding: 12, textAlign: "left" }}>Source</th>
                  <th style={{ padding: 12, textAlign: "left" }}>Opted In</th>
                  <th style={{ padding: 12, textAlign: "left" }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((oi) => (
                  <tr key={oi.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: 12 }}>
                      <code style={{ fontSize: 12 }}>{oi.customer_identifier}</code>
                    </td>
                    <td style={{ padding: 12 }}>
                      <span
                        className="bdg"
                        style={{
                          backgroundColor:
                            oi.consent_status === "opted_in" ? "#e8f5e9" : "#ffebee",
                          color:
                            oi.consent_status === "opted_in" ? "#2e7d32" : "#c62828",
                        }}
                      >
                        {oi.consent_status === "opted_in" ? "✓ Opted In" : "✗ Opted Out"}
                      </span>
                    </td>
                    <td style={{ padding: 12 }}>
                      <span className="mut fs12">{oi.source}</span>
                    </td>
                    <td style={{ padding: 12 }}>
                      <span className="mut fs12">
                        {new Date(oi.created_at).toLocaleDateString()}
                      </span>
                    </td>
                    <td style={{ padding: 12, textAlign: "right" }}>
                      {oi.consent_status === "opted_in" ? (
                        <button
                          className="btn ghost sm"
                          onClick={() =>
                            updateOptIn.mutate({
                              id: oi.id,
                              status: "opted_out",
                            })
                          }
                          disabled={updateOptIn.isPending}
                        >
                          Opt Out
                        </button>
                      ) : (
                        <button
                          className="btn ghost sm"
                          onClick={() =>
                            updateOptIn.mutate({
                              id: oi.id,
                              status: "opted_in",
                            })
                          }
                          disabled={updateOptIn.isPending}
                        >
                          Opt In
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
    </div>
  );
}

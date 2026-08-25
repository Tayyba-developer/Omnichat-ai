"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";

interface ConnectWhatsAppModalProps {
  businessId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function ConnectWhatsAppModal({ businessId, onClose, onSuccess }: ConnectWhatsAppModalProps) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"paste" | "verify" | "success">("paste");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!phoneNumberId.trim() || !accessToken.trim()) {
      setError("Please enter Phone Number ID and Access Token");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: err } = await supabase.from("channels").upsert({
        business_id: businessId,
        channel_type: "whatsapp",
        name: "WhatsApp",
        status: "connected",
        provider: "meta",
        access_token: accessToken,
        webhook_secret: webhookSecret || null,
        phone_number_id: phoneNumberId,
        metadata: {
          verify_token: verifyToken || "dev-webhook-secret",
        },
      });

      if (err) {
        setError(err.message);
        return;
      }

      qc.invalidateQueries({ queryKey: ["channel_connections"] });
      setStep("success");

      if (onSuccess) {
        setTimeout(onSuccess, 2000);
      } else {
        setTimeout(onClose, 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save channel");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: 480,
          maxHeight: "90vh",
          overflow: "auto",
          padding: 28,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {step === "paste" && (
          <>
            <h1 className="fs20 fw7" style={{ marginBottom: 4 }}>
              Connect WhatsApp
            </h1>
            <p className="mut fs12" style={{ marginBottom: 18 }}>
              Get your credentials from Meta Developers (WhatsApp Business API) and paste them below.
            </p>

            <div className="col gap12">
              <div>
                <div className="flab" style={{ marginBottom: 6 }}>
                  Phone Number ID
                </div>
                <input
                  className="inp w100"
                  placeholder="e.g., 1234567890123"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div>
                <div className="flab" style={{ marginBottom: 6 }}>
                  Access Token (Bearer)
                </div>
                <textarea
                  className="inp w100"
                  placeholder="Paste your access token here"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  disabled={loading}
                  style={{ minHeight: 80, fontFamily: "monospace", fontSize: 11 }}
                />
              </div>

              <div>
                <div className="flab" style={{ marginBottom: 6 }}>
                  Webhook Verify Token (optional)
                </div>
                <input
                  className="inp w100"
                  placeholder="Custom webhook verify token"
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div>
                <div className="flab" style={{ marginBottom: 6 }}>
                  App Secret (optional, for webhook signing)
                </div>
                <input
                  className="inp w100"
                  placeholder="App secret for X-Hub-Signature-256"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  disabled={loading}
                  type="password"
                />
              </div>

              <div className="mut fs11">
                <strong>Webhook URL:</strong>
                <div style={{ fontFamily: "monospace", marginTop: 4 }}>
                  https://yourapp.com/api/channels/whatsapp
                </div>
              </div>

              {error && <div className="mut fs12" style={{ color: "var(--err)" }}>{error}</div>}

              <div className="fx gap8 jb" style={{ marginTop: 12 }}>
                <button className="btn" onClick={onClose} disabled={loading}>
                  Cancel
                </button>
                <button className="btn-p" onClick={handleSave} disabled={loading}>
                  {loading ? "Saving…" : "Save & Connect"}
                </button>
              </div>
            </div>
          </>
        )}

        {step === "success" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2 className="fs16 fw7" style={{ marginBottom: 8 }}>
              Connected!
            </h2>
            <p className="mut fs12">
              WhatsApp is now connected. Messages will appear in your Inbox automatically.
            </p>
            <button className="btn-p w100" onClick={onClose} style={{ marginTop: 16 }}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

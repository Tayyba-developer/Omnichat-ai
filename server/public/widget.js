/**
 * widget.js — OmniChat embeddable chat widget (vanilla JS, zero deps).
 * ---------------------------------------------------------------------------
 * Use:
 *   <script src="YOUR_BACKEND/widget.js"></script>
 *   <script>OmniChatWidget.init({ apiUrl: "http://localhost:4000", widgetId: "biz_your_widget" })</script>
 *
 * Renders a floating green bubble bottom-right. Messages are sent to
 * `POST /api/widget/:widgetId/message` and replies stream back into the chat.
 */

(function () {
  "use strict";

  var DEFAULTS = {
    apiUrl: window.location.origin,
    widgetId: "",
    primaryColor: "#10b981", // emerald green
    welcome: "Hi! 👋 How can I help you today?",
    title: "Chat with us",
  };

  var state = { open: false, visitorId: "" };

  function init(options) {
    var cfg = Object.assign({}, DEFAULTS, options || {});
    if (!cfg.widgetId) {
      console.error("[OmniChatWidget] init() requires a widgetId");
      return;
    }
    state.visitorId = visitorId();
    render(cfg);
  }

  /** Stable per-browser visitor id (persisted in localStorage). */
  function visitorId() {
    try {
      var k = "_omnichat_visitor";
      var existing = window.localStorage.getItem(k);
      if (existing) return existing;
      var id = "visitor_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      window.localStorage.setItem(k, id);
      return id;
    } catch (e) {
      return "visitor_" + Math.random().toString(36).slice(2, 10);
    }
  }

  function sendMessage(cfg, text) {
    return fetch(cfg.apiUrl + "/api/widget/" + encodeURIComponent(cfg.widgetId) + "/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, visitorId: state.visitorId }),
    }).then(function (r) {
      if (!r.ok) throw new Error("widget request failed");
      return r.json();
    });
  }

  /** Tiny element builder. */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function render(cfg) {
    if (document.getElementById("__omnichat_widget_root__")) return;

    var host = document.createElement("div");
    host.id = "__omnichat_widget_root__";

    // --- Bubble ---
    var bubble = el("button", "oc-bubble", "");
    bubble.style.background = cfg.primaryColor;
    bubble.innerHTML =
      '<span class="oc-bubble-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>' +
      '<span class="oc-bubble-close" style="display:none">✕</span>';

    // --- Chat panel ---
    var panel = el("div", "oc-panel");
    panel.style.display = "none";

    var header = el("div", "oc-header", cfg.title);
    header.style.background = cfg.primaryColor;

    var body = el("div", "oc-body");
    var intro = el("div", "oc-msg oc-them", cfg.welcome);
    body.appendChild(intro);

    var footer = el("div", "oc-footer");
    var input = el("input", "oc-input", null);
    input.placeholder = "Type a message…";
    input.setAttribute("aria-label", "Message");
    var sendBtn = el("button", "oc-send", "Send");

    var hint = el("div", "oc-hint", "Powered by OmniChat");

    footer.appendChild(input);
    footer.appendChild(sendBtn);
    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    panel.appendChild(hint);
    host.appendChild(bubble);
    host.appendChild(panel);
    document.body.appendChild(host);
    injectStyles(cfg);

    function appendMsg(kind, text) {
      var m = el("div", "oc-msg " + (kind === "user" ? "oc-me" : "oc-them"), text);
      body.appendChild(m);
      body.scrollTop = body.scrollHeight;
      return m;
    }

    function doSend() {
      var text = input.value.trim();
      if (!text) return;
      input.value = "";
      appendMsg("user", text);
      var pending = appendMsg("bot", "…");
      sendMessage(cfg, text)
        .then(function (json) {
          pending.textContent = json.reply || "…";
          body.scrollTop = body.scrollHeight;
        })
        .catch(function () {
          pending.textContent = "Sorry, I had a hiccup. Please try again.";
        });
    }

    sendBtn.addEventListener("click", doSend);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") doSend();
    });

    bubble.addEventListener("click", function () {
      state.open = !state.open;
      panel.style.display = state.open ? "flex" : "none";
      var icon = bubble.querySelector(".oc-bubble-icon");
      var close = bubble.querySelector(".oc-bubble-close");
      if (icon) icon.style.display = state.open ? "none" : "";
      if (close) close.style.display = state.open ? "" : "none";
    });
  }

  function injectStyles(cfg) {
    if (document.getElementById("__omnichat_css")) return;
    var style = document.createElement("style");
    style.id = "__omnichat_css";
    style.textContent =
      "#__omnichat_widget_root__{position:fixed;bottom:20px;right:20px;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}" +
      ".oc-bubble{width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.25);color:#fff}" +
      ".oc-panel{position:absolute;bottom:70px;right:0;width:330px;max-height:460px;flex-direction:column;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.2);background:#fff;border:1px solid #e5e7eb}" +
      ".oc-header{padding:12px 16px;color:#fff;font-weight:600}" +
      ".oc-body{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:220px}" +
      ".oc-msg{max-width:78%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word}" +
      ".oc-them{background:#f3f4f6;align-self:flex-start;border-bottom-left-radius:4px}" +
      ".oc-me{background:" + cfg.primaryColor + ";color:#fff;align-self:flex-end;border-bottom-right-radius:4px}" +
      ".oc-footer{display:flex;gap:8px;padding:10px;border-top:1px solid #f3f4f6}" +
      ".oc-input{flex:1;border:1px solid #e5e7eb;border-radius:20px;padding:8px 12px;font-size:14px;outline:none}" +
      ".oc-send{border:none;border-radius:20px;padding:8px 16px;background:" + cfg.primaryColor + ";color:#fff;cursor:pointer;font-weight:600}" +
      ".oc-hint{padding:6px 12px;font-size:11px;color:#9ca3af;text-align:center}";
    document.head.appendChild(style);
  }

  window.OmniChatWidget = { init: init };
})();
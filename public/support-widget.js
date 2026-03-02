(function supportWidgetBootstrap() {
  if (window.ChatSupportWidget) return;

  function toBoolean(value, fallback) {
    if (value == null) return fallback;
    return value === "true" || value === "1";
  }

  function toNumber(value, fallback) {
    if (value == null || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function createWidget() {
    const script =
      document.currentScript ||
      document.querySelector("script[data-chat-widget]") ||
      document.querySelector("script[data-chat-url]");

    const dataset = script ? script.dataset : {};

    const settings = {
      chatUrl: dataset.chatUrl || dataset.chaturl || "/chat",
      title: dataset.title || "Canlı Destek",
      launcherLabel: dataset.launcherLabel || dataset.launcherlabel || "Canlı Destek",
      themeColor: dataset.themeColor || dataset.themecolor || "#2563eb",
      textColor: dataset.textColor || dataset.textcolor || "#ffffff",
      panelBackground: dataset.panelBackground || dataset.panelbackground || "#09090b",
      position: (dataset.position || "right").toLowerCase() === "left" ? "left" : "right",
      width: toNumber(dataset.width, 380),
      height: toNumber(dataset.height, 640),
      mobileBreakpoint: toNumber(dataset.mobileBreakpoint || dataset.mobilebreakpoint, 768),
      zIndex: toNumber(dataset.zIndex || dataset.zindex, 2147483000),
      openByDefault: toBoolean(dataset.openByDefault || dataset.openbydefault, false),
      hideLauncherText: toBoolean(dataset.hideLauncherText || dataset.hidelaunchertext, false)
    };

    const host = document.createElement("div");
    host.setAttribute("data-chat-support-widget", "true");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.pointerEvents = "none";
    host.style.zIndex = String(settings.zIndex);
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .widget {
        --theme-color: ${settings.themeColor};
        --text-color: ${settings.textColor};
        --panel-bg: ${settings.panelBackground};
        position: fixed;
        ${settings.position}: 16px;
        bottom: 16px;
        display: flex;
        flex-direction: column;
        align-items: ${settings.position === "left" ? "flex-start" : "flex-end"};
        gap: 12px;
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
        pointer-events: none;
      }
      .launcher {
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 52px;
        border: 0;
        border-radius: 999px;
        padding: 0 18px;
        background: var(--theme-color);
        color: var(--text-color);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        line-height: 1;
        transition: transform 120ms ease, opacity 120ms ease;
      }
      .launcher:hover {
        transform: translateY(-1px);
      }
      .launcher:active {
        transform: translateY(0);
      }
      .launcher-label.hidden {
        display: none;
      }
      .badge {
        min-width: 18px;
        height: 18px;
        border-radius: 999px;
        background: #ef4444;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0 5px;
      }
      .badge.visible {
        display: inline-flex;
      }
      .panel {
        pointer-events: auto;
        width: min(calc(100vw - 24px), ${settings.width}px);
        height: min(calc(100vh - 90px), ${settings.height}px);
        border-radius: 18px;
        overflow: hidden;
        background: var(--panel-bg);
        box-shadow: 0 22px 50px rgba(0, 0, 0, 0.42);
        border: 1px solid rgba(255, 255, 255, 0.08);
        transform: translateY(8px) scale(0.985);
        transform-origin: bottom ${settings.position === "left" ? "left" : "right"};
        opacity: 0;
        visibility: hidden;
        transition: transform 160ms ease, opacity 160ms ease, visibility 160ms ease;
        display: flex;
        flex-direction: column;
      }
      .widget.open .panel {
        transform: translateY(0) scale(1);
        opacity: 1;
        visibility: visible;
      }
      .header {
        min-height: 52px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px;
        color: #f4f4f5;
        background: linear-gradient(180deg, rgba(39, 39, 42, 0.9), rgba(24, 24, 27, 0.9));
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .title {
        font-size: 13px;
        font-weight: 600;
      }
      .close {
        border: 0;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        background: rgba(63, 63, 70, 0.65);
        color: #fafafa;
        cursor: pointer;
      }
      .frame {
        flex: 1;
        width: 100%;
        border: 0;
        background: #09090b;
      }
      @media (max-width: ${settings.mobileBreakpoint}px) {
        .widget {
          left: 0;
          right: 0;
          bottom: 0;
          align-items: stretch;
          padding: 0;
        }
        .launcher {
          align-self: ${settings.position === "left" ? "flex-start" : "flex-end"};
          margin: 0 16px 16px;
        }
        .panel {
          width: 100vw;
          height: 100dvh;
          max-height: 100dvh;
          border-radius: 0;
          border: 0;
          transform: translateY(100%);
        }
        .widget.open .panel {
          transform: translateY(0);
        }
      }
    `;

    const container = document.createElement("div");
    container.className = "widget";

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "launcher";
    launcher.setAttribute("aria-label", settings.launcherLabel);
    launcher.setAttribute("aria-expanded", "false");

    const launcherIcon = document.createElement("span");
    launcherIcon.textContent = "💬";

    const launcherLabel = document.createElement("span");
    launcherLabel.className = `launcher-label${settings.hideLauncherText ? " hidden" : ""}`;
    launcherLabel.textContent = settings.launcherLabel;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "0";

    launcher.appendChild(launcherIcon);
    launcher.appendChild(launcherLabel);
    launcher.appendChild(badge);

    const panel = document.createElement("section");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", settings.title);

    const header = document.createElement("div");
    header.className = "header";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = settings.title;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "close";
    closeButton.setAttribute("aria-label", "Kapat");
    closeButton.textContent = "✕";

    header.appendChild(title);
    header.appendChild(closeButton);

    const frame = document.createElement("iframe");
    frame.className = "frame";
    frame.src = settings.chatUrl;
    frame.title = settings.title;
    frame.allow = "clipboard-read; clipboard-write";
    frame.loading = "lazy";
    frame.referrerPolicy = "strict-origin-when-cross-origin";

    panel.appendChild(header);
    panel.appendChild(frame);
    container.appendChild(panel);
    container.appendChild(launcher);
    shadow.appendChild(style);
    shadow.appendChild(container);

    let isOpen = false;
    let unreadCount = 0;

    function setUnread(nextCount) {
      unreadCount = Math.max(0, Number(nextCount) || 0);
      badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      badge.classList.toggle("visible", unreadCount > 0);
    }

    function open() {
      isOpen = true;
      container.classList.add("open");
      launcher.setAttribute("aria-expanded", "true");
      setUnread(0);
    }

    function close() {
      isOpen = false;
      container.classList.remove("open");
      launcher.setAttribute("aria-expanded", "false");
    }

    function toggle() {
      if (isOpen) {
        close();
      } else {
        open();
      }
    }

    function destroy() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("message", onMessage);
      host.remove();
      delete window.ChatSupportWidget;
    }

    function onKeyDown(event) {
      if (event.key === "Escape" && isOpen) close();
    }

    function onMessage(event) {
      const payload = event.data;
      if (!payload || typeof payload !== "object") return;
      if (payload.type !== "chat-widget") return;

      if (payload.action === "open") open();
      if (payload.action === "close") close();
      if (payload.action === "toggle") toggle();
      if (!isOpen && payload.action === "unread") setUnread(payload.count);
    }

    launcher.addEventListener("click", toggle);
    closeButton.addEventListener("click", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("message", onMessage);

    if (settings.openByDefault) open();

    window.ChatSupportWidget = {
      open,
      close,
      toggle,
      destroy,
      setUnread
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createWidget, { once: true });
    return;
  }

  createWidget();
})();

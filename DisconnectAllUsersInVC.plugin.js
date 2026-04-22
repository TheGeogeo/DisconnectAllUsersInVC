/**
 * @name DisconnectAllUsersInVC
 * @author TheGeogeo
 * @version 1.2.0
 * @description Adds a skull button on voice channels to disconnect every user in that channel (admin required).
 * @website https://github.com/TheGeogeo/DisconnectAllUsersInVC
 * @source  https://github.com/TheGeogeo/DisconnectAllUsersInVC/blob/main/DisconnectAllUsersInVC.plugin.js
 */

// Remote raw URL of this plugin for update checks.
const UPDATE_URL = "https://raw.githubusercontent.com/TheGeogeo/DisconnectAllUsersInVC/main/DisconnectAllUsersInVC.plugin.js";

module.exports = class DisconnectAllUsersInVC {
  constructor(meta) {
    this.meta = meta;
    this.pluginId = "DisconnectAllUsersInVC";
    this.currentVersion = meta?.version || "0.0.0";
    this.cssId = "disconnect-all-users-in-vc-css";
    this.observer = null;
    this.scanFrame = null;
    this.inFlightChannels = new Set();

    // BetterDiscord helpers.
    this.Webpack = BdApi.Webpack;
    this.DOM = BdApi.DOM;
    this.UI = BdApi.UI;
    this.React = BdApi.React;

    // Discord stores/modules.
    this.UserStore = this.Webpack.getStore("UserStore");
    this.ChannelStore = this.Webpack.getStore("ChannelStore");
    this.GuildStore = this.Webpack.getStore("GuildStore");
    this.VoiceStateStore = this.Webpack.getStore("VoiceStateStore");
    this.PermissionStore = this.Webpack.getStore("PermissionStore");
    this.MemberActions = this.Webpack.getByKeys?.("setChannel", "setServerMute", "setServerDeaf")
      || this.Webpack.getModule(m =>
        typeof m?.setChannel === "function"
        && (typeof m?.setServerMute === "function" || typeof m?.setServerDeaf === "function")
      );

    // Internal API modules (with fallbacks).
    this.HTTP = this.Webpack.getByKeys?.("get", "post", "put", "patch")
      || this.Webpack.getModule(m =>
        typeof m?.get === "function"
        && typeof m?.post === "function"
        && typeof m?.put === "function"
        && typeof m?.patch === "function"
      );

    this.Endpoints = this.Webpack.getByKeys?.("GUILD_MEMBER", "GUILD_MEMBERS")
      || this.Webpack.getModule(m => typeof m?.GUILD_MEMBER === "function");

    this.PermissionFlags = this.Webpack.getModule(m =>
      (m?.ADMINISTRATOR != null && m?.MOVE_MEMBERS != null)
      || (m?.Permissions?.ADMINISTRATOR != null && m?.Permissions?.MOVE_MEMBERS != null)
    );
  }

  log(...a) { BdApi.Logger.log(this.pluginId, ...a); }
  error(...a) { BdApi.Logger.error(this.pluginId, ...a); }

  isVoiceChannel(channel) {
    if (!channel) return false;
    const isVoiceLike = channel.type === 2 || channel.type === 13;
    return isVoiceLike && !!this.getChannelGuildId(channel);
  }

  getCurrentUserId() {
    return this.UserStore?.getCurrentUser?.()?.id ?? null;
  }

  getChannelGuildId(channel) {
    return channel?.guild_id ?? channel?.guildId ?? null;
  }

  getGuildIdFromChannelId(channelId) {
    const channel = this.ChannelStore?.getChannel?.(channelId);
    return this.getChannelGuildId(channel);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  orderUsersForDisconnect(userIds) {
    const seen = new Set();
    const unique = [];

    for (const userId of Array.isArray(userIds) ? userIds : []) {
      const id = String(userId || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push(id);
    }

    const me = this.getCurrentUserId();
    if (!me) return unique;

    const ordered = unique.filter(id => id !== me);
    if (unique.includes(me)) ordered.push(me); // Always keep self last.
    return ordered;
  }

  getUserVoiceChannelId(guildId, userId) {
    const uid = String(userId);

    try {
      const state = this.VoiceStateStore?.getVoiceStateForUser?.(uid);
      const channelId = state?.channelId ?? state?.channel_id;
      if (channelId) return String(channelId);
    } catch {}

    try {
      const state = this.VoiceStateStore?.getVoiceStateForUser?.(guildId, uid);
      const channelId = state?.channelId ?? state?.channel_id;
      if (channelId) return String(channelId);
    } catch {}

    try {
      const guildStates = this.VoiceStateStore?.getVoiceStatesForGuild?.(guildId);
      const entries = this.flattenVoiceStates(guildStates);
      for (const entry of entries) {
        const stateUserId = String(entry?.userId ?? entry?.user_id ?? "");
        if (stateUserId !== uid) continue;
        const channelId = entry?.channelId ?? entry?.channel_id;
        if (channelId) return String(channelId);
      }
    } catch {}

    return null;
  }

  isUserInChannel(guildId, channelId, userId) {
    const nowChannelId = this.getUserVoiceChannelId(guildId, userId);
    return !!nowChannelId && String(nowChannelId) === String(channelId);
  }

  async waitForUserChannelChange(guildId, userId, targetChannelId, timeoutMs = 2500) {
    const target = String(targetChannelId || "");
    const started = Date.now();

    while ((Date.now() - started) < timeoutMs) {
      const nowChannelId = this.getUserVoiceChannelId(guildId, userId);
      if (!nowChannelId || String(nowChannelId) !== target) return true;
      await this.sleep(120);
    }

    return false;
  }

  getAdministratorFlag() {
    if (this.PermissionFlags?.ADMINISTRATOR != null) return this.PermissionFlags.ADMINISTRATOR;
    if (this.PermissionFlags?.Permissions?.ADMINISTRATOR != null) return this.PermissionFlags.Permissions.ADMINISTRATOR;
    return 8n;
  }

  hasAdminPermission(channel) {
    if (!channel) return false;
    const guildId = this.getChannelGuildId(channel);
    if (!guildId) return false;

    const userId = this.getCurrentUserId();
    if (!userId) return false;

    const guild = this.GuildStore?.getGuild?.(guildId);
    const ownerId = guild?.ownerId ?? guild?.owner_id;
    if (ownerId && ownerId === userId) return true;

    const adminFlag = this.getAdministratorFlag();

    // Preferred check.
    if (typeof this.PermissionStore?.can === "function") {
      try { return !!this.PermissionStore.can(adminFlag, channel); } catch {}
      try { return !!this.PermissionStore.can(Number(adminFlag), channel); } catch {}
    }

    // Fallback on raw bitfield if available.
    if (typeof this.PermissionStore?.getChannelPermissions === "function") {
      try {
        const perms = this.PermissionStore.getChannelPermissions(channel);
        if (typeof perms === "bigint") return (perms & 8n) === 8n;
        if (typeof perms === "number") return (perms & 8) === 8;
      } catch {}
    }

    return false;
  }

  flattenVoiceStates(payload, depth = 0) {
    if (!payload || depth > 4) return [];

    if (Array.isArray(payload)) {
      return payload.flatMap(item => this.flattenVoiceStates(item, depth + 1));
    }

    if (payload instanceof Map) {
      return Array.from(payload.values()).flatMap(item => this.flattenVoiceStates(item, depth + 1));
    }

    if (typeof payload === "object") {
      if (payload.userId || payload.user_id) return [payload];
      return Object.values(payload).flatMap(item => this.flattenVoiceStates(item, depth + 1));
    }

    return [];
  }

  getVoiceUserIdsInChannel(guildId, channelId) {
    const collected = [];
    const collect = (payload) => {
      const entries = this.flattenVoiceStates(payload);
      for (const entry of entries) collected.push(entry);
    };

    try { collect(this.VoiceStateStore?.getVoiceStatesForChannel?.(channelId)); } catch {}
    try { collect(this.VoiceStateStore?.getVoiceStatesForChannel?.(guildId, channelId)); } catch {}

    if (!collected.length) {
      try {
        const guildStates = this.VoiceStateStore?.getVoiceStatesForGuild?.(guildId);
        if (guildStates && typeof guildStates === "object" && guildStates[channelId]) {
          collect(guildStates[channelId]);
        } else {
          collect(guildStates);
        }
      } catch {}
    }

    const ids = new Set();
    for (const state of collected) {
      const stateChannelId = state?.channelId ?? state?.channel_id;
      if (stateChannelId && String(stateChannelId) !== String(channelId)) continue;

      const userId = state?.userId ?? state?.user_id;
      if (userId) ids.add(String(userId));
    }

    return Array.from(ids);
  }

  guildMemberEndpoint(guildId, userId) {
    const fn = this.Endpoints?.GUILD_MEMBER || this.Endpoints?.Endpoints?.GUILD_MEMBER;
    if (typeof fn === "function") return fn(guildId, userId);
    return `/guilds/${guildId}/members/${userId}`;
  }

  async patchGuildMember(url, body) {
    if (!this.HTTP?.patch) throw new Error("HTTP.patch module not found");

    const attempts = [
      () => this.HTTP.patch({ url, body, oldFormErrors: true }),
      () => this.HTTP.patch({ url, body }),
      () => this.HTTP.patch(url, { body }),
      () => this.HTTP.patch(url, body)
    ];

    let lastError = null;
    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error("Unable to patch guild member");
  }

  buildGuildMemberUrls(guildId, userId) {
    const urls = [];
    const endpoint = this.guildMemberEndpoint(guildId, userId);
    if (endpoint) urls.push(endpoint);
    urls.push(`/guilds/${guildId}/members/${userId}`);
    urls.push(`/api/v9/guilds/${guildId}/members/${userId}`);
    urls.push(`/api/v10/guilds/${guildId}/members/${userId}`);
    return Array.from(new Set(urls));
  }

  async disconnectUser(guildId, channelId, userId) {
    const targetChannelId = String(channelId || "");
    if (!targetChannelId) throw new Error("Missing target channel id");

    if (!this.isUserInChannel(guildId, targetChannelId, userId)) {
      return { status: "already_out" };
    }

    let lastError = null;

    const strategies = [
      {
        name: "memberActions:setChannel(guildId, userId, null)",
        run: async () => {
          if (typeof this.MemberActions?.setChannel !== "function") throw new Error("MemberActions.setChannel not found");
          await Promise.resolve(this.MemberActions.setChannel(guildId, userId, null));
        }
      },
      {
        name: "memberActions:setChannel(guildId, null, userId)",
        run: async () => {
          if (typeof this.MemberActions?.setChannel !== "function") throw new Error("MemberActions.setChannel not found");
          await Promise.resolve(this.MemberActions.setChannel(guildId, null, userId));
        }
      },
      {
        name: "http:channel_id",
        run: async () => {
          const urls = this.buildGuildMemberUrls(guildId, userId);
          let httpError = null;
          for (const url of urls) {
            try {
              await this.patchGuildMember(url, { channel_id: null });
              return;
            } catch (err) {
              httpError = err;
            }
          }
          throw httpError || new Error("HTTP channel_id strategy failed");
        }
      },
      {
        name: "http:channelId",
        run: async () => {
          const urls = this.buildGuildMemberUrls(guildId, userId);
          let httpError = null;
          for (const url of urls) {
            try {
              await this.patchGuildMember(url, { channelId: null });
              return;
            } catch (err) {
              httpError = err;
            }
          }
          throw httpError || new Error("HTTP channelId strategy failed");
        }
      }
    ];

    for (const strategy of strategies) {
      try {
        await strategy.run();
      } catch (err) {
        lastError = err;
        if (this.isPermissionError(err)) break;
        continue;
      }

      const changed = await this.waitForUserChannelChange(guildId, userId, targetChannelId, 2500);
      if (changed) return { status: "disconnected", strategy: strategy.name };

      lastError = new Error(`Strategy ${strategy.name} did not remove user ${userId} from channel ${targetChannelId}`);
    }

    // One last check in case the store updated just after timeout.
    if (!this.isUserInChannel(guildId, targetChannelId, userId)) {
      return { status: "disconnected", strategy: "late_state_update" };
    }

    throw lastError || new Error("All disconnect strategies failed");
  }

  isPermissionError(err) {
    return err?.status === 403 || err?.statusCode === 403 || err?.body?.code === 50013;
  }

  normalizeDisconnectMode(mode) {
    return String(mode || "").toLowerCase() === "hard" ? "hard" : "safe";
  }

  applyDisconnectOutcome(stats, userId, outcome) {
    if (outcome?.error) {
      stats.failed += 1;
      if (this.isPermissionError(outcome.error)) stats.permissionDenied = true;
      this.error(`Failed to disconnect user ${userId}:`, outcome.error);
      return;
    }

    if (outcome?.result?.status === "already_out") {
      stats.skipped += 1;
      return;
    }

    stats.success += 1;
  }

  async disconnectUserWithRetries(guildId, channelId, userId, maxRetries = 0) {
    const retries = Math.max(0, Number(maxRetries) || 0);
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const result = await this.disconnectUser(guildId, channelId, userId);
        if (result?.status === "already_out") {
          return { status: "already_out", attempts: attempt + 1 };
        }
        if (!this.isUserInChannel(guildId, channelId, userId)) {
          return { status: "disconnected", attempts: attempt + 1 };
        }

        lastError = new Error(`User ${userId} still connected after attempt ${attempt + 1}`);
      } catch (err) {
        lastError = err;
        if (this.isPermissionError(err)) break;
      }

      if (!this.isUserInChannel(guildId, channelId, userId)) {
        return { status: "disconnected", attempts: attempt + 1 };
      }

      if (attempt < retries) await this.sleep(160);
    }

    throw lastError || new Error(`Unable to disconnect user ${userId}`);
  }

  async executeDisconnectSafe(guildId, channelId, ordered, stats) {
    for (const userId of ordered) {
      try {
        const result = await this.disconnectUserWithRetries(guildId, channelId, userId, 0);
        this.applyDisconnectOutcome(stats, userId, { result });
      } catch (err) {
        this.applyDisconnectOutcome(stats, userId, { error: err });
      }

      // Keep safe mode strictly one by one.
      await this.sleep(140);
    }
  }

  async executeDisconnectHard(guildId, channelId, ordered, stats) {
    const me = this.getCurrentUserId();
    const selfLast = me && ordered[ordered.length - 1] === me ? me : null;
    const others = selfLast ? ordered.slice(0, -1) : ordered.slice();

    const runUser = async (userId) => {
      try {
        const result = await this.disconnectUserWithRetries(guildId, channelId, userId, 3);
        return { userId, result };
      } catch (error) {
        return { userId, error };
      }
    };

    // Fire everyone except self without waiting for the previous user.
    const outcomes = await Promise.all(others.map(runUser));
    for (const outcome of outcomes) {
      this.applyDisconnectOutcome(stats, outcome.userId, outcome);
    }

    // Always keep self disconnection for the end.
    if (selfLast) {
      const selfOutcome = await runUser(selfLast);
      this.applyDisconnectOutcome(stats, selfOutcome.userId, selfOutcome);
    }
  }

  showDisconnectSummaryToast(stats, mode) {
    const modeLabel = mode === "hard" ? "Hard" : "Safe";
    const { success, skipped, failed, permissionDenied } = stats;

    if (!failed) {
      if (skipped) {
        this.UI.showToast(`${modeLabel}: disconnected ${success}, skipped ${skipped}.`, { type: "success" });
      } else {
        this.UI.showToast(`${modeLabel}: disconnected ${success} user${success > 1 ? "s" : ""}.`, { type: "success" });
      }
      return;
    }

    if (permissionDenied) {
      this.UI.showToast(
        `${modeLabel}: disconnected ${success}, skipped ${skipped}, failed ${failed}. Check your admin/voice permissions.`,
        { type: "danger", timeout: 6000 }
      );
      return;
    }

    this.UI.showToast(
      `${modeLabel}: disconnected ${success}, skipped ${skipped}, failed ${failed}.`,
      { type: "warning", timeout: 5000 }
    );
  }

  async executeDisconnect(guildId, channelId, userIds, mode = "safe") {
    if (this.inFlightChannels.has(channelId)) {
      this.UI.showToast("A disconnect action is already running for this channel.", { type: "warning" });
      return;
    }

    this.inFlightChannels.add(channelId);
    this.refreshAllSlots();

    const ordered = this.orderUsersForDisconnect(userIds);
    const selectedMode = this.normalizeDisconnectMode(mode);

    const stats = {
      success: 0,
      skipped: 0,
      failed: 0,
      permissionDenied: false
    };

    try {
      if (selectedMode === "hard") {
        await this.executeDisconnectHard(guildId, channelId, ordered, stats);
      } else {
        await this.executeDisconnectSafe(guildId, channelId, ordered, stats);
      }
    } finally {
      this.inFlightChannels.delete(channelId);
      this.refreshAllSlots();
    }

    this.showDisconnectSummaryToast(stats, selectedMode);
  }

  promptModeAndDisconnect(guildId, channelId, ordered, text) {
    const run = (mode) => this.executeDisconnect(guildId, channelId, ordered, mode);

    if (typeof this.UI?.showConfirmationModal === "function" && this.React?.createElement) {
      const modeGroupName = `dauivc-mode-${guildId}-${channelId}-${Date.now()}`;
      let selectedMode = "safe";

      const optionStyle = {
        display: "grid",
        gap: "4px",
        border: "1px solid var(--background-modifier-accent, rgba(255,255,255,0.12))",
        borderRadius: "8px",
        padding: "10px"
      };

      const safeOption = this.React.createElement(
        "label",
        { style: optionStyle },
        this.React.createElement(
          "span",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          this.React.createElement("input", {
            type: "radio",
            name: modeGroupName,
            value: "safe",
            defaultChecked: true,
            onChange: () => { selectedMode = "safe"; }
          }),
          this.React.createElement("strong", null, "Safe")
        ),
        this.React.createElement(
          "span",
          { style: { fontSize: "12px", opacity: 0.85 } },
          "Disconnect one by one and wait for each result before moving on."
        )
      );

      const hardOption = this.React.createElement(
        "label",
        { style: optionStyle },
        this.React.createElement(
          "span",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          this.React.createElement("input", {
            type: "radio",
            name: modeGroupName,
            value: "hard",
            onChange: () => { selectedMode = "hard"; }
          }),
          this.React.createElement("strong", null, "Hard")
        ),
        this.React.createElement(
          "span",
          { style: { fontSize: "12px", opacity: 0.85 } },
          "Fire kicks without waiting for previous users. If still connected when response returns, retry up to 3 times."
        )
      );

      const content = this.React.createElement(
        "div",
        { style: { display: "grid", gap: "10px" } },
        this.React.createElement("div", null, text),
        this.React.createElement("div", { style: { fontSize: "12px", opacity: 0.9 } }, "Choose mode:"),
        safeOption,
        hardOption
      );

      this.UI.showConfirmationModal("Disconnect All Users", content, {
        danger: true,
        confirmText: "Disconnect",
        cancelText: "Cancel",
        onConfirm: () => run(selectedMode)
      });
      return;
    }

    if (!window.confirm(text)) return;
    const raw = window.prompt("Choose disconnect mode: safe or hard", "safe");
    if (raw == null) return;
    run(this.normalizeDisconnectMode(raw));
  }

  promptAndDisconnect(guildId, channelId) {
    const channel = this.ChannelStore?.getChannel?.(channelId);
    if (!channel || !this.isVoiceChannel(channel)) {
      this.UI.showToast("Voice channel not found.", { type: "danger" });
      return;
    }

    if (!this.hasAdminPermission(channel)) {
      this.UI.showToast("You must be admin on this server to use this button.", { type: "danger" });
      return;
    }

    const userIds = this.getVoiceUserIdsInChannel(guildId, channelId);
    if (!userIds.length) {
      this.UI.showToast("No users to disconnect in this voice channel.", { type: "info" });
      return;
    }

    // Keep self for the end so the action can finish cleanly.
    const ordered = this.orderUsersForDisconnect(userIds);

    const channelLabel = channel?.name ? `#${channel.name}` : `#${channelId}`;
    const text = `Disconnect ${ordered.length} user${ordered.length > 1 ? "s" : ""} from ${channelLabel}?`;
    this.promptModeAndDisconnect(guildId, channelId, ordered, text);
  }

  createDisconnectButton(guildId, channelId, channel) {
    const btn = document.createElement("button");
    const canUse = this.hasAdminPermission(channel);
    const isBusy = this.inFlightChannels.has(channelId);

    btn.className = "dauivc-button";
    btn.type = "button";
    btn.textContent = "💀";
    btn.dataset.guildId = guildId || "";
    btn.dataset.channelId = channelId;
    btn.disabled = isBusy || !canUse;

    if (isBusy) {
      btn.title = "Disconnect already running...";
    } else if (!canUse) {
      btn.title = "Admin permission required";
    } else {
      btn.title = "Disconnect all users in this voice channel";
    }
    btn.setAttribute("aria-label", btn.title);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.promptAndDisconnect(guildId, channelId);
    });

    return btn;
  }

  renderSlot(slot, guildId, channelId) {
    while (slot.firstChild) slot.removeChild(slot.firstChild);

    const channel = this.ChannelStore?.getChannel?.(channelId);
    if (!this.isVoiceChannel(channel)) return;

    const resolvedGuildId = guildId || this.getChannelGuildId(channel);
    if (!resolvedGuildId) return;

    slot.appendChild(this.createDisconnectButton(resolvedGuildId, channelId, channel));
  }

  injectSlotForAnchor(anchor) {
    if (!anchor || anchor.querySelector(".dauivc-slot")) return;

    const dataId = anchor.getAttribute("data-list-item-id") || "";
    if (!dataId.startsWith("channels___")) return;

    const ids = dataId.replace(/^channels___/, "").split("_");
    const channelId = ids.pop();
    if (!channelId) return;

    const channel = this.ChannelStore?.getChannel?.(channelId);
    if (!this.isVoiceChannel(channel)) return;

    let guildId = this.getChannelGuildId(channel);
    if (!guildId) {
      const href = anchor.getAttribute("href") || "";
      const m = href.match(/\/channels\/(\d+)\/(\d+)/);
      if (m) guildId = m[1];
    }
    if (!guildId) return;

    const slot = document.createElement("span");
    slot.className = "dauivc-slot";
    slot.dataset.guildId = guildId;
    slot.dataset.channelId = channelId;

    anchor.appendChild(slot);
    this.renderSlot(slot, guildId, channelId);
  }

  refreshAllSlots() {
    document.querySelectorAll(".dauivc-slot").forEach(slot => {
      const channelId = slot.dataset.channelId;
      const guildId = slot.dataset.guildId || this.getGuildIdFromChannelId(channelId);
      if (!channelId || !guildId) return;
      this.renderSlot(slot, guildId, channelId);
    });
  }

  startObserver() {
    const handle = () => {
      this.scanFrame = null;
      const anchors = document.querySelectorAll('a[data-list-item-id^="channels___"]');
      anchors.forEach(anchor => this.injectSlotForAnchor(anchor));
    };

    const schedule = () => {
      if (this.scanFrame != null) return;
      if (typeof requestAnimationFrame === "function") {
        this.scanFrame = requestAnimationFrame(handle);
      } else {
        this.scanFrame = setTimeout(handle, 16);
      }
    };

    this.observer = new MutationObserver(schedule);
    this.observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  }

  stopObserver() {
    this.observer?.disconnect();
    this.observer = null;
    if (this.scanFrame != null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.scanFrame);
      else clearTimeout(this.scanFrame);
      this.scanFrame = null;
    }
  }

  addStyles() {
    const css = `
      :root { --dauivc-size: 28px; }

      .dauivc-slot {
        display: inline-flex;
        margin-left: 10px;
        vertical-align: middle;
        flex-shrink: 0;
      }

      .dauivc-button {
        width: var(--dauivc-size);
        height: var(--dauivc-size);
        border: none;
        background: transparent;
        padding: 0;
        line-height: 1;
        font-size: 20px;
        cursor: pointer;
        opacity: .95;
        transition: transform .12s ease, opacity .12s ease, filter .12s ease;
      }

      .dauivc-button:hover {
        transform: scale(1.12);
        opacity: 1;
        filter: saturate(1.35);
      }

      .dauivc-button:focus {
        outline: 2px solid #ef4444;
        outline-offset: 2px;
        border-radius: 4px;
      }

      .dauivc-button:disabled {
        cursor: not-allowed;
        opacity: .45;
        transform: none;
        filter: grayscale(.35);
      }
    `;

    this.DOM.addStyle(this.cssId, css);
  }

  removeStyles() {
    this.DOM.removeStyle(this.cssId);
  }

  /**
   * Check for updates and show BD's update banner if a newer version is available.
   * Tries BetterDiscord's built-in PluginUpdater first, then ZeresPluginLibrary,
   * and finally falls back to a simple fetch+compare.
   */
  checkForUpdates() {
    const name = "DisconnectAllUsersInVC";
    const current = this.currentVersion;

    // 1) Prefer BetterDiscord's built-in PluginUpdater (if present).
    const BDUpdater = window.PluginUpdater || BdApi?.PluginUpdater;
    if (BDUpdater && typeof BDUpdater.checkForUpdate === "function") {
      try {
        BDUpdater.checkForUpdate(name, current, UPDATE_URL);
        return;
      } catch (e) {
        try { BdApi.Logger.warn(this.pluginId, "BD PluginUpdater failed:", e); } catch {}
      }
    }

    // 2) Fallback to ZeresPluginLibrary's PluginUpdater (if user has it).
    const ZLib = window.ZeresPluginLibrary || window.ZLibrary || globalThis?.ZeresPluginLibrary;
    if (ZLib?.PluginUpdater?.checkForUpdate) {
      try {
        ZLib.PluginUpdater.checkForUpdate(name, current, UPDATE_URL);
        return;
      } catch (e) {
        try { BdApi.Logger.warn(this.pluginId, "ZLib PluginUpdater failed:", e); } catch {}
      }
    }

    // 3) Last resort: manual compare using BdApi.Net.fetch.
    // Looks for a semantic version like "1.2.3" in the remote file.
    const doManualCheck = async () => {
      try {
        const res = await BdApi.Net.fetch(UPDATE_URL, { method: "GET" });
        if (!res || !res.text) return;
        const text = await res.text();
        const match = text.match(/@version\s+([0-9]+\.[0-9]+\.[0-9]+)/i) || text.match(/["']([0-9]+\.[0-9]+\.[0-9]+)["']/);
        if (!match) return;
        const remote = String(match[1]);
        const newer = (a, b) => {
          const pa = a.split(".").map(n => parseInt(n, 10) || 0);
          const pb = b.split(".").map(n => parseInt(n, 10) || 0);
          for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] > pa[i];
          return false;
        };
        if (newer(current, remote)) {
          BdApi.UI.showToast(`${name} update available: ${current} -> ${remote}`, { type: "info", timeout: 6000 });
        }
      } catch (e) {
        try { BdApi.Logger.warn(this.pluginId, "Manual update check failed:", e); } catch {}
      }
    };
    doManualCheck();
  }

  start() {
    this.addStyles();
    this.startObserver();
    this.log("Started");

    this.checkForUpdates();
  }

  stop() {
    this.stopObserver();
    this.removeStyles();
    document.querySelectorAll(".dauivc-slot").forEach(node => node.remove());
    this.log("Stopped");
  }

  getSettingsPanel() {
    const wrap = document.createElement("div");
    wrap.style.padding = "12px";
    wrap.style.lineHeight = "1.5";
    wrap.innerHTML = `
      <strong>DisconnectAllUsersInVC</strong><br>
      Adds a <code>💀</code> button next to guild voice channels.<br>
      Click it to disconnect everyone in that channel (admin required).
    `;
    return wrap;
  }
};

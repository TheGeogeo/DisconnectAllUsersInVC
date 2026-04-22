# DisconnectAllUsersInVC - BetterDiscord Plugin

> Adds a skull button next to voice channels to disconnect all users in that channel (admin required).

⚠️ **Disclaimer**: BetterDiscord modifies the official Discord client and may violate Discord's Terms of Service. Use at your own risk. This project is not affiliated with Discord.

---

## What it does

- Adds a `💀` button next to guild voice channels in the channel list.
- Prompts for confirmation before running any mass disconnect action.
- Disconnects users from the selected voice channel, including Stage voice channels.
- Keeps your own account for the end of the sequence so the action can complete cleanly.
- Prevents duplicate runs on the same channel while one operation is already in progress.
- Shows result toasts with success and failure counts.

---

## How it works (under the hood)

- Observes the channel list and injects a small slot next to each voice channel entry.
- Uses BetterDiscord Webpack modules/stores:
  - `VoiceStateStore` to detect users currently connected to a specific channel.
  - `ChannelStore` and `GuildStore` to resolve channel and guild metadata.
  - `PermissionStore` to check whether you can use the action.
- Uses multiple disconnect strategies for compatibility:
  - `MemberActions.setChannel(...)` with fallback signatures.
  - Internal `HTTP.patch` calls on guild member endpoints with `channel_id: null` (and fallback payload forms).
- Verifies that each user actually left the original channel before considering the attempt successful.

---

## Permissions

- The button is enabled only if you have **Administrator** on the guild (or you are guild owner).
- Discord may still reject some moves without required voice permissions (for example `Move Members`), in which case failures are reported.

---

## Installation

1. Download the plugin file: `DisconnectAllUsersInVC.plugin.js`.
2. Put it in your BetterDiscord plugins folder:
   - **Windows**: `%AppData%\\BetterDiscord\\plugins`
   - **macOS**: `~/Library/Application Support/BetterDiscord/plugins`
   - **Linux**: `~/.config/BetterDiscord/plugins`
3. In Discord: **Settings -> BetterDiscord -> Plugins**, enable **DisconnectAllUsersInVC**.

> Restart Discord if the plugin does not appear immediately.

---

## Usage

1. Open a server channel list and locate a voice channel.
2. Click the `💀` button next to that channel.
3. Confirm the action in the modal.
4. Wait for completion and read the toast summary.

---

## UI and customization

- The button size uses CSS variable `--dauivc-size` (default `28px`).

Example override in Custom CSS:

```css
:root { --dauivc-size: 32px; }
```

---

## Limitations and notes

- Works only in guild voice channels, not DMs/group calls.
- If Discord changes internal module names or signatures, this plugin may require updates.
- The operation is sequential by design to improve reliability and produce accurate per-user results.

---

## Troubleshooting

- **Button not visible**: reload the plugin and verify you are viewing a guild channel list.
- **Button disabled**: check that your account has Administrator in that server.
- **Partial failures**: check role hierarchy and voice permissions (`Move Members` in particular).

---

## Security and privacy

- No analytics and no third-party network calls.
- Uses Discord client internals to execute member channel moves.
- Does not inspect messages or exfiltrate account data.

---

## Contributing

Issues and PRs are welcome. Please include reproduction steps, OS, Discord build, BetterDiscord version, and plugin version.


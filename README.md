# DisconnectAllUsersInVC - BetterDiscord Plugin

> Adds a `💀` button next to guild voice channels to disconnect everyone in that channel.

⚠️ **Disclaimer**: BetterDiscord modifies the official Discord client and may violate Discord's Terms of Service. Use at your own risk. This project is not affiliated with Discord.

- Repository: `https://github.com/TheGeogeo/DisconnectAllUsersInVC`
- Source file: `https://github.com/TheGeogeo/DisconnectAllUsersInVC/blob/main/DisconnectAllUsersInVC.plugin.js`

---

## Features

- Adds a `💀` button next to voice channels in the guild channel list.
- Confirmation modal before mass disconnect.
- Two disconnect modes:
  - **Safe**: disconnect users one by one (waits for each result).
  - **Hard**: fast mode, does not wait between users and retries up to 3 times when needed.
- Supports voice and stage voice channels.
- Prevents duplicate actions on the same channel while a run is already in progress.
- Clear toast summary (`disconnected`, `skipped`, `failed`).
- Built-in update check against GitHub raw plugin URL.

---

## Settings

Open **Settings -> BetterDiscord -> Plugins -> DisconnectAllUsersInVC -> Settings**.

- **Kick yourself** (`boolean`)
  - If disabled, your account is never included in the mass disconnect.
- **Kick yourself in last position** (`boolean`)
  - If enabled, your account is always processed after all others.
  - If disabled, your account keeps its natural voice-state order position.
- **Default disconnect settings** (`Safe` / `Hard`)
  - Preselected mode in the confirmation modal.

---

## Permissions

- Button usage is restricted to users with **Administrator** (or guild owner).
- Discord can still reject moves based on role hierarchy or voice permissions (notably `Move Members`).

---

## Installation

1. Download `DisconnectAllUsersInVC.plugin.js`.
2. Place it in your BetterDiscord plugins folder:
   - **Windows**: `%AppData%\\BetterDiscord\\plugins`
   - **macOS**: `~/Library/Application Support/BetterDiscord/plugins`
   - **Linux**: `~/.config/BetterDiscord/plugins`
3. Enable it in **Settings -> BetterDiscord -> Plugins**.

> Restart Discord if the plugin does not appear right away.

---

## Usage

1. Open a guild channel list.
2. Click the `💀` button on a voice channel.
3. Choose **Safe** or **Hard** in the confirmation modal.
4. Confirm and wait for the result toast.

---

## How it works (technical)

- Injects UI slots next to voice-channel anchors via `MutationObserver`.
- Reads stores/modules with BetterDiscord Webpack:
  - `VoiceStateStore`, `ChannelStore`, `GuildStore`, `PermissionStore`.
- Executes disconnect through multiple strategies for compatibility:
  - `MemberActions.setChannel(...)` fallbacks.
  - Internal `HTTP.patch` on guild member endpoint (`channel_id: null` / `channelId: null`).
- Verifies effective channel change and applies retries when configured (Hard mode).

---

## Customization

Button size is controlled by CSS variable `--dauivc-size` (default `28px`).

```css
:root { --dauivc-size: 32px; }
```

---

## Troubleshooting

- **Button not visible**: reload plugin and ensure you are in a guild channel list.
- **Button disabled**: confirm your account has Administrator.
- **Partial failures**: check role hierarchy and voice permissions (`Move Members`).
- **Unexpected self behavior**: verify `Kick yourself` and `Kick yourself in last position` in settings.

---

## Security & Privacy

- No analytics.
- No third-party network API calls for disconnect actions.
- Does not inspect messages or exfiltrate account data.

---

## Contributing

Issues and PRs are welcome. Please include:

- Reproduction steps
- OS
- Discord build
- BetterDiscord version
- Plugin version


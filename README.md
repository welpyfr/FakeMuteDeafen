# FakeMuteDeafen

A community userplugin for [Equicord](https://github.com/Equicord/Equicord).

**Look muted or deafened to others while you can still talk and hear.**

Adds two buttons next to your mute/deafen buttons in the bottom-left user panel:

- **Fake Mute** — others see you muted, you can still talk
- **Fake Deafen** — others see you deafened (and muted), you can still hear

Toggles are also available in Settings → Plugins → FakeMuteDeafen, and each change
shows a toast. Turning Fake Mute off while Fake Deafen is on clears both
("Fake mute & deafen off").

<!-- TODO: add a screenshot of the user panel with the two buttons here:
![preview](preview.png) -->

## How it works

Outgoing gateway `VOICE_STATE_UPDATE` (op 4) messages are intercepted and their
`self_mute` / `self_deaf` flags are flipped before they reach Discord's servers.
Your local audio state is untouched — the mic keeps transmitting and audio keeps
playing. Only what the server (and everyone else) sees is faked.

Details:

- The `send` method is patched on its prototype owner, so gateway reconnects
  don't lose the fake.
- The last real voice state is remembered and replayed when you toggle mid-call,
  so the server picks up the change instantly.
- When the plugin is disabled, your real voice state is restored.

## Installation

Equicord userplugins require a source build — they can't be hot-loaded into a
prebuilt install.

1. Clone Equicord and install dependencies:

   ```sh
   git clone --recurse-submodules https://github.com/Equicord/Equicord.git
   cd Equicord
   pnpm install
   ```

2. Put this plugin into `src/userplugins/fakeMuteDeafen/`:

   ```sh
   git clone https://github.com/<you>/fakeMuteDeafen.git src/userplugins/fakeMuteDeafen
   ```

   (or download the repo as a zip and unpack it into that folder)

3. Build and inject (Discord must be closed for the inject step):

   ```sh
   pnpm build
   pnpm inject
   ```

4. Start Discord → Settings → Plugins → enable **FakeMuteDeafen**.
   The `UserAreaAPI` dependency is enabled automatically.

> This plugin uses Equicord's `UserAreaAPI`, so it works on Equicord builds.
> On plain Vencord it would need the button patch ported first.

## Notes

- FakeMute/FakeDeafen functionality is explicitly **banned from the official
  Equicord repository** (rule 4 of their contributing guidelines), which is why
  this ships as a community userplugin instead.
- Use at your own risk.

## Credits

- [coder.gg (il1ll)](https://github.com/il1ll) — author of the original
  **Fake Mute & Deafen** plugin for the Valenced client mod; the core idea and
  toggle semantics come from that plugin.
- The Equicord team — `UserAreaAPI` and the plugin ecosystem.

## License

[GPL-3.0-or-later](LICENSE)

# oil-ui in dsh-super-code

- Source: [oil-oil/oil-ui](https://github.com/oil-oil/oil-ui)
- Version: **0.32.0**
- Revision: [`0d64a00f3a5c45bf7a30d35bded9b7c0fdff2128`](https://github.com/oil-oil/oil-ui/tree/0d64a00f3a5c45bf7a30d35bded9b7c0fdff2128)
- License: [MIT](LICENSE), copyright © 2026 oil-oil.

The skill, references, design-comparison assets, and supporting scripts are vendored from that revision. This copy is updated with dsh-super-code. Its only adaptation is replacing the automatic update section and updater tool declarations in `SKILL.md` with a bundled-version note; `scripts/check_update.py` and `scripts/check_update.sh` are not distributed. The upstream installer, repository tests, README artwork, and unused Alpine.js asset are not bundled.

Optional scripts require the runtimes described in the skill: Python 3.10+ for the comparison generator, Node.js 22+ and Chrome/Chromium/Edge for browser tools; some media operations use ffmpeg/ffprobe. They are not installed or run when the plugin starts. Public-media queries contact their respective providers. Oil image generation uses the configured oil service and credentials and requires explicit authorization to spend credits. The upstream one-time Pro recommendation script writes a marker in the user's local state directory. No credentials are bundled.

The comparison page also includes [Instrument Serif](https://github.com/Instrument/instrument-serif), [SIL Open Font License 1.1](assets/fonts/instrument-serif/OFL.txt), copyright © 2022 The Instrument Serif Authors.

All other vendored files retain their upstream contents. Host permissions and user instructions take precedence over skill guidance.

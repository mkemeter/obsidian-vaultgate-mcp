# Third-Party Notices

VaultGate (`obsidian-vaultgate-mcp`) is licensed under the
[GNU General Public License v3.0 or later](LICENSE).

This document lists third-party components that are distributed as part of the
VaultGate tray app DMG and are subject to their own licenses.

---

## Bundled Embedding Model

| Component | License | Source |
|-----------|---------|--------|
| **bge-small-en-v1.5** — BAAI General Embedding, small English variant | [MIT License](https://huggingface.co/BAAI/bge-small-en-v1.5) | BAAI (Beijing Academy of Artificial Intelligence) / [Hugging Face](https://huggingface.co/Xenova/bge-small-en-v1.5) |

The model files (ONNX format) are pre-bundled in the tray DMG at
`Contents/Resources/assets/models/Xenova/bge-small-en-v1.5/`.
They are used entirely on-device — no vault content or queries leave the
local machine.

---

## Runtime Dependencies (selected)

| Component | License | Notes |
|-----------|---------|-------|
| **Electron** | [MIT License](https://github.com/electron/electron/blob/main/LICENSE) | Application shell |
| **onnxruntime-node** | [MIT License](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) | ONNX model inference |
| **@xenova/transformers** | [Apache-2.0](https://github.com/xenova/transformers.js/blob/main/LICENSE) | Tokenisation + model loading |

All licenses above are compatible with GPL-3.0-or-later under the terms of
the Free Software Foundation's license compatibility matrix.

Full dependency license trees can be reproduced by running
`npx license-checker --production` in the `server/` and `tray/` directories.

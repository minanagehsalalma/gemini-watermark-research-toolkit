# Public Landscape Snapshot

Last updated: April 12, 2026.

This note summarizes the public Gemini watermark-removal landscape that was reviewed while packaging this repository. The goal is not to rank every tool, but to show how this repo is positioned relative to what is already available.

## Public tools observed

### GitHub repositories

- [GargantuaX/gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover)
- [allenk/GeminiWatermarkTool](https://github.com/allenk/GeminiWatermarkTool)
- [dearabhin/gemini-watermark-remover](https://github.com/dearabhin/gemini-watermark-remover)
- [dinoBOLT/Gemini-Watermark-Remover](https://github.com/dinoBOLT/Gemini-Watermark-Remover)

### Extensions and web tools

- [SparkleErase AI](https://chromewebstore.google.com/detail/sparkleerase-ai-remove-ge/goinnhjbphpdckbaolkefcckoonamjjl)
- [Gemini Watermark Remover for Firefox](https://addons.mozilla.org/en-US/firefox/addon/gemini-watermark-remover-pro/)
- [Pilio Gemini Watermark Remover](https://pilio.ai/gemini-watermark-remover)
- [Gemini Watermark Cleaner](https://geminiwatermarkcleaner.com/)

## What the public landscape looks like

The current ecosystem is dominated by:

- one-click browser extensions
- small GitHub projects that focus on visible watermark reversal
- web tools that emphasize convenience over methodology

Many public tools present themselves primarily as end-user removers. Some explicitly describe reverse alpha blending or local processing, while others emphasize convenience and batch cleanup. The overall landscape is active enough that a new repo should not position itself as "the only way" to handle this problem.

## How this repository is positioned

This repository is intentionally framed as a research toolkit rather than only a remover:

- detector, remover, and browser userscript are kept together in one codebase
- methodology and heuristic tradeoffs are documented in plain technical language
- debug overlays and confidence outputs are treated as first-class artifacts
- evaluation notes are surfaced in the README instead of hidden behind marketing language
- scope is stated narrowly: visible Gemini sparkle removal in PNG-oriented workflows

## Practical difference from common alternatives

Compared with public one-click tools, this repo optimizes for:

- inspectability
- reproducibility
- local execution
- method transparency
- easier debugging of failure cases

Compared with isolated scripts, this repo also emphasizes the browser workflow through a userscript path that can be run under Tampermonkey-class managers.

## Important scope boundary

This project does not claim to remove or defeat invisible provenance systems. The focus here is the visible sparkle watermark that appears in the rendered image corner.

## Research note

This snapshot was assembled with Perplexity-assisted background research and should be treated as a dated landscape note rather than a permanent market map. Public tools, extensions, and repos in this space are changing quickly.

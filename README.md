# Gemini Watermark Research Toolkit

Research-oriented Node.js tooling for detecting and removing Gemini's bottom-right sparkle watermark in PNG images.

Applied image-analysis tooling for a narrow, explicit target:

- detect the visible Gemini sparkle watermark in PNG exports
- inspect localization with a debug overlay
- remove the visible mark with deterministic local cleanup

## Visual proof

<table>
  <tr>
    <td align="center" width="50%">
      <strong>Detector overlay</strong><br />
      <img src="docs/assets/detect-gemini-watermark-showcase.png" alt="Detector debug overlay example" />
    </td>
    <td align="center" width="50%">
      <strong>Removal results</strong><br />
      <img src="docs/assets/watermark-removal-results.png" alt="Before and after watermark removal results" />
    </td>
  </tr>
</table>

The detector localizes the sparkle cluster first. The remover then applies template-guided subtraction and residual cleanup in the matched region.

## Evaluation snapshot

Current numbers are from the private local fixture set used during development. Those fixtures are not bundled in the public repo, so the metrics below should be read as a transparent development snapshot rather than a public benchmark pack.

- Detector localization: `9/9` images matched the expected watermark bounds on the private development set.
- Detector showcase sample: `testimage.png` localized a `48px` sparkle cluster at `[1296, 687] -> [1343, 734]` with `0.999` confidence.
- Weak-case remover match: a difficult `48px` default-placement image still locked at `67.2%` NCC after the fallback placement rule was added.
- Large watermark case: the ShareFile-style sample locked a `96px` template at `x:3404, y:992` with `94.4%` NCC.
- Post-clean verification: rerunning on the cleaned ShareFile sample produced no confident watermark rematch (`68.6%` max NCC, below threshold).
- Browser workflow: the userscript download and clipboard paths are covered by a Playwright harness that exercises Gemini-style controls, processes a real `2048x2048` opt-in fixture, and verifies that no pixels outside the accepted watermark region changed.
- Reconstruction quality: the scaled-template path ranks adaptive alpha, global/local directional, multiscale, and texture-patch candidates, then rejects clipping and watermark-shaped artifacts before confidence blending.

## Why this repo exists

This repository packages a practical watermark-analysis workflow into reproducible local tooling:

- `detect-gemini-watermark.js` estimates watermark position from image structure.
- `remove-gemini-watermark.js` applies template-guided subtraction plus residual cleanup.
- `remove-gemini-watermark.userscript.js` ports the same removal logic into the browser for Gemini image flows.

The project is framed as applied research rather than a polished consumer app. The emphasis is on method clarity, observable outputs, and iteration on difficult edge cases.

## Research framing

- Scope: PNG images that contain Gemini's visible bottom-right sparkle mark.
- Method: structural matching, fixed alpha templates, heuristic fallback for default placement, and localized residual healing.
- Goal: make the pipeline understandable and editable, not hide it behind opaque binaries.
- Non-goal: universal watermark removal across arbitrary products, formats, or invisible forensic schemes.

## Quickstart

Requirements:

- Node.js 24+

Install:

```powershell
npm install
```

Detect a watermark candidate:

```powershell
node detect-gemini-watermark.js .\path\to\image.png
```

Emit machine-readable output:

```powershell
node detect-gemini-watermark.js .\path\to\image.png --json
```

Write a debug overlay:

```powershell
node detect-gemini-watermark.js .\path\to\image.png --debug .\overlay.png
```

Remove the watermark:

```powershell
node remove-gemini-watermark.js .\input.png .\outputs\cleaned.png
```

Run the public synthetic regression suite:

```powershell
npm test
```

The suite covers fixed-placement removal, clean-image rejection, scaled detector-guided matching, repeat-clean no-op behavior, and PNG stream errors without bundling private image fixtures.

Run the same regression suite against a local real image:

```powershell
$env:GEMINI_REAL_FIXTURE='C:\path\to\Gemini_Generated_Image.png'
npm test
```

## Browser workflow

The repository also includes a browser-side implementation: [`remove-gemini-watermark.userscript.js`](remove-gemini-watermark.userscript.js).

It is designed for userscript managers such as [Tampermonkey](https://www.tampermonkey.net/) or compatible alternatives.

Key behavior:

- intercepts visible Gemini download controls as well as matching image fetch requests
- intercepts Gemini's **Copy image** control and replaces its native `ClipboardItem` image payload with the locally cleaned PNG
- upgrades matching image URLs to full-resolution fetches where possible
- runs the same local cleanup logic in-browser without uploading images elsewhere
- swaps cleaned blob URLs into generated-image elements
- provides a compact status panel that starts minimized in the top-right, with clean-latest, local-file, rescan, and auto-clean controls when expanded
- constructs the panel without HTML injection sinks so it works under Gemini's enforced Trusted Types policy
- deduplicates visible page images by full-resolution URL and ignores hidden historical Gemini DOM nodes
- discovers generated images from `currentSrc`, `src`, and `srcset` without depending on a specific Gemini container element
- processes Gemini `blob:` display images directly from the decoded DOM element, avoiding CSP-blocked blob fetches while preserving natural resolution
- recognizes 1024px page previews produced by downscaling Gemini's 2048px watermark, using a placement-constrained 96-to-48px template so nearby image highlights do not win the match
- captures nested Download controls through the composed click path, even when Gemini prevents the native event first
- preserves full download resolution: a 1024px `blob:` preview is left to Gemini's native `=s0` request, then full-size Blob or ArrayBuffer transfers into Gemini's opaque download sandbox are captured and cleaned before its `blob:null` download is created
- installs transfer hooks at `document-start` for Worker, MessagePort, BroadcastChannel, and window messaging, while retaining fetch and programmatic-anchor fallbacks
- forwards the cleaned full-resolution Blob through Gemini's original transfer channel, allowing its native download lifecycle and progress indicator to complete normally
- forwards clipboard cleanup through Gemini's original `navigator.clipboard.write()` lifecycle, so copying still completes without starting a download
- probes the known 1024px and 2048px watermark geometry before broad corner search, avoiding the expensive full-image detector for trusted placement matches
- calibrates template opacity and half-pixel alignment before scoring global/local directional, multiscale, and bounded texture-patch reconstructions
- uses confidence-weighted mask edges and explicit clipping, boundary, texture, and watermark-correlation penalties to reject visible artifacts
- runs adaptive ROI reconstruction in a Worker through a narrowly scoped Trusted Types policy, with a deterministic main-thread fallback when page CSP forbids Worker creation
- leaves the full-size waiting state after six seconds with a visible fallback when Gemini does not expose a cleanable download artifact
- ends stalled image requests after 30 seconds with a visible error instead of leaving the panel busy indefinitely
- reports accepted match size, position, confidence, cleaned/unchanged totals, and failures
- exposes `cleanLatest()`, `cleanBlob()`, `rescan()`, `setAutoClean()`, and `stats()` through `window.geminiWatermarkRemover`

The userscript loads its pinned inpainting dependencies through `@require`, so the userscript manager must allow those metadata dependencies when installing or updating the script.

Run the browser UI and real-download regression:

```powershell
$env:GEMINI_REAL_FIXTURE='C:\path\to\Gemini_Generated_Image.png'
npm run test:browser
```

The browser suite also verifies Worker execution, clipboard parity, and correct cleanup through the CSP-blocked Worker fallback. This makes the repo useful in two modes:

- offline/local CLI experimentation on PNGs
- live browser cleanup through a userscript workflow

## Detector showcase

Example JSON output from the showcased detector run:

```json
{
  "image": "testimage.png",
  "answer": "The watermark is the white sparkle glyph in the bottom-right corner.",
  "watermark": {
    "kind": "sparkle-cluster",
    "clusterBounds": {
      "x0": 1296,
      "y0": 687,
      "x1": 1343,
      "y1": 734
    }
  },
  "confidence": 0.999
}
```

## Landscape and positioning

Public Gemini watermark removers already exist across several formats:

- GitHub projects such as [GargantuaX/gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover), [allenk/GeminiWatermarkTool](https://github.com/allenk/GeminiWatermarkTool), [dearabhin/gemini-watermark-remover](https://github.com/dearabhin/gemini-watermark-remover), and [dinoBOLT/Gemini-Watermark-Remover](https://github.com/dinoBOLT/Gemini-Watermark-Remover)
- browser extensions and web tools such as [SparkleErase AI](https://chromewebstore.google.com/detail/sparkleerase-ai-remove-ge/goinnhjbphpdckbaolkefcckoonamjjl), [Gemini Watermark Remover for Firefox](https://addons.mozilla.org/en-US/firefox/addon/gemini-watermark-remover-pro/), [Pilio](https://pilio.ai/gemini-watermark-remover), and [Gemini Watermark Cleaner](https://geminiwatermarkcleaner.com/)

This repo is positioned differently:

- it keeps the detector, remover, and userscript in one inspectable codebase
- it documents the actual matching and cleanup methodology instead of only exposing a one-click UI
- it ships debug-oriented artifacts such as detector overlays and confidence outputs
- it is explicit about scope: visible Gemini sparkle removal, not a generalized claim about invisible provenance marks such as SynthID
- it is structured as a research toolkit first, with reproducibility and failure-case notes alongside the code

For a source-backed landscape snapshot, see [docs/landscape.md](docs/landscape.md).

## Repository contents

- `detect-gemini-watermark.js`: CLI detector for bottom-right sparkle localization.
- `remove-gemini-watermark.js`: CLI remover with residual cleanup support.
- `remove-gemini-watermark.userscript.js`: in-browser Gemini userscript variant.
- `scripts/create-github-comparison.ps1`: rebuilds the comparison sheet when local fixture images are available.
- `docs/assets/detect-gemini-watermark-showcase.png`: example detector debug overlay.
- `docs/landscape.md`: public-tool landscape snapshot and positioning notes.
- `docs/methodology.md`: pipeline and heuristic notes.
- `docs/research-direction.md`: current research direction and next-step questions.
- `docs/assets/watermark-removal-results.png`: GitHub-friendly before/after comparison asset.

## Reproducibility note

The evaluation fixture images used during development are not bundled in this public snapshot. That keeps the repo lighter and avoids redistributing generated/source images that may not be appropriate to publish verbatim.

If you want to rebuild the comparison asset locally, restore your private PNG fixtures under `TestSet/` and run:

```powershell
.\scripts\create-github-comparison.ps1
```

## Limitations

- The current tooling is PNG-focused.
- Detection assumes the visible Gemini sparkle appears in the bottom-right region.
- Removal quality depends on local image texture and contrast near the watermark.
- Invisible watermarking or provenance systems are outside the scope of this repo.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidance on bug reports, fixture handling, and research-style pull requests.

## Security

See [SECURITY.md](SECURITY.md). This is research code and should be treated accordingly.

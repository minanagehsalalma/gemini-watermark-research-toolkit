# Methodology

This repository uses a visible-watermark removal pipeline built around deterministic image operations.

## System split

The repository contains two related but distinct pipelines:

- `detect-gemini-watermark.js` is a localization tool. It tries to answer where the visible sparkle cluster is and emits bounds, confidence, and optional debug overlays.
- `remove-gemini-watermark.js` is a reconstruction tool. It assumes the visible watermark belongs to a narrow Gemini sparkle family and applies a fixed-template subtraction plus cleanup stage.

They share the same problem domain, but they do not use the same internal representation. The detector is geometry-oriented; the remover is alpha-template-oriented.

## Detector pipeline

1. Restrict search to the bottom-right portion of the image.
2. Convert the candidate region into grayscale and saturation-derived local statistics.
3. Build sparkle candidates from bright, low-saturation structures that resemble the expected four-point astroid-like glyph.
4. Cluster nearby sparkle responses into a single watermark hypothesis.
5. Emit a confidence score and optional overlay that exposes the search window and accepted cluster bounds.

The detector is designed for explainability: it highlights what region was searched and what exact box was accepted, instead of returning a hidden model score with no geometric trace.

## Remover detection stage

The remover first solves a narrower detection problem than the standalone detector.

1. Restrict matching to the lower-right search region.
2. Convert the raster into grayscale for correlation scoring.
3. Load a fixed alpha template for the expected Gemini sparkle sizes: `48px` and `96px`.
4. Run a coarse-to-fine normalized cross-correlation pass:
   - a coarse stride reduces search cost over the candidate region
   - a local fine pass refines the best coarse location to pixel precision
5. Probe the known default positions first, then a constrained near-corner `96px` region.
6. When the near-corner probe is viable, compare intermediate scales (`56px` through `88px`) only in a local neighborhood around that candidate.
7. Suppress already accepted boxes so multi-mark cases do not repeatedly select the same region.

The code keeps separate thresholds for primary acceptance and weaker fallback acceptance:

- strong matches are accepted directly
- fixed-placement probes use the same per-size default-placement confidence gates as the broader search
- a weaker `48px` match can still be accepted if it lands close to Gemini's default bottom-right placement margin
- near-corner `96px` matches require at least `0.52` NCC
- scaled matches require at least `0.57` NCC and must beat a viable `96px` candidate by `0.10`
- detector-guided scaled matches require both reliable sparkle geometry and at least `0.57` refined NCC
- secondary matches are only accepted relative to the first accepted match, using a ratio gate instead of a fully independent threshold

That asymmetry is deliberate. The false-positive risk is much higher for weak standalone matches than for a secondary mark that agrees with an already-accepted primary hypothesis.

## Correlation model

The remover uses normalized cross-correlation over grayscale image data against precomputed watermark alpha maps.

At a high level:

- the watermark template is converted into a zero-mean vector
- each candidate image patch is converted into a zero-mean vector
- the score is the covariance between patch and template normalized by both vector norms

This gives scale-normalized structural similarity rather than raw brightness matching, which matters because the visible sparkle may sit on backgrounds with very different absolute luminance.

Template statistics are precomputed and cached so repeated scans do not rebuild the same zero-mean vectors and norms on every pass.

The fine pass remains inside the caller's requested search bounds. This matters for fixed-placement probes: a score calculated at a nearby pixel must not be reported as evidence for the exact expected coordinate.

## Public regression fixtures

`npm test` builds deterministic rasters in memory rather than publishing the private development images. The synthetic cases exercise exact `48px` removal, repeat-clean no-op behavior, clean gradient rejection, a scaled `64px` detector-guided match, and adaptive reconstruction against known originals containing gradients, straight and curved edges, crossing edges, periodic texture, half-pixel template shifts, and dark-background oversubtraction. Setting `GEMINI_REAL_FIXTURE` adds a real-image regression that checks the accepted `96px` location, requires substantial changes inside the watermark ROI, rejects any changes outside it, limits newly near-black pixels and edge roughness, and verifies that a second pass is a no-op.

`npm run test:browser` exercises the minimized top-right panel at desktop and mobile widths under enforced Trusted Types and `connect-src` policies. The harness converts the displayed image to a Gemini-origin `blob:` URL, excludes blob connections from CSP, includes duplicate and hidden history nodes, and uses a nested download control whose native handler has already prevented the click. It verifies direct DOM-image processing with no blob fetch, one unique scan result, and a completed state. With `GEMINI_REAL_FIXTURE` set, it also downsizes the real 2048px image to a 1024px page preview, verifies that the placement-constrained 48px match changes pixels only around the watermark, and clicks Download from that preview. The simulated native handler deliberately bypasses `fetch` with XHR and sends the full-resolution image Blob through `MessagePort`, matching the pre-sandbox boundary used before Gemini creates its opaque `blob:null` download. The userscript captures that transfer, cleans it, and forwards the replacement Blob through the original port so Gemini's native completion path still runs. The regression requires exactly one `=s0` request, Worker-backed adaptive reconstruction, a cleaning duration below three seconds, a cleaned 2048x2048 PNG, and pixel changes confined to the accepted watermark region. Separate regressions verify deterministic cleanup when CSP forbids the Worker policy and that an unobserved native path leaves the busy state after six seconds.

The clipboard regression clicks a Gemini-shaped `copy-button`, lets the page construct and write its native `ClipboardItem`, reads the image back through Chromium's Clipboard API, and applies the same resolution, watermark-region, and near-black-artifact assertions used for downloads. The userscript only arms this interceptor after a composed click path identifies **Copy image**, then supplies a promised cleaned Blob to Gemini's original clipboard write so browser activation and page completion behavior remain owned by the native flow.

## Removal pipeline

1. Load the fixed alpha template for the matched watermark size.
2. Interpret the visible watermark as a white additive layer with known per-pixel alpha.
3. For each covered pixel, solve the inverse blend approximately as:
   - `observed = alpha * white + (1 - alpha) * background`
   - `background ~= (observed - alpha * 255) / (1 - alpha)`
4. Clamp channel values into valid byte range after inversion.
5. Snapshot the watermark ROI before subtraction so candidate reconstruction can compare the observed pixels, nominal subtraction, and surrounding context.
6. Search half-pixel template offsets and robustly calibrate the effective opacity scale against a structural guide.
7. Build global-direction, locally varying tiled-direction, multiscale, calibrated-alpha, and, for textured regions, bounded exemplar-patch candidates.
8. Score candidates using re-composition error, mask-boundary continuity, clipping rate, texture consistency, and residual correlation with the watermark alpha map.
9. Reject candidates with strong clipping or watermark-shaped correlation, then confidence-blend the selected reconstruction with the nominal subtraction across the soft alpha mask.
10. Run a localized residual-healing step for bright corner artifacts, especially on `96px` cases, and return the cleaned raster without changing unrelated regions.

The CLI and userscript consume the same pure ROI implementation from `lib/adaptive-reconstruction.js`; `npm run sync:reconstruction` updates the generated userscript copy and `npm run check` fails if they diverge. In the browser, the ROI calculation runs in a Worker when Trusted Types permits the scoped Worker URL policy. A synchronous deterministic fallback retains functionality under stricter CSP.

The subtraction stage is intentionally local and deterministic. It does not inpaint the full corner patch unless the residual stage decides that the subtraction left a recognizable bright artifact.

## Residual healing

Residual healing is a targeted post-process, not a general inpainting pass.

The current implementation:

1. Opens a limited window around the expected high-risk corner region after subtraction.
2. Fits low-order local color planes to surrounding pixels.
3. Builds a mask for suspicious bright / low-saturation remnants.
4. Dilates that mask modestly to avoid hard edge transitions.
5. Replaces masked pixels with plane-predicted values and smooths the boundary region.

This is a pragmatic compromise. Simple subtraction often leaves a pale star-shaped remnant on low-texture backgrounds, while unconstrained fast-marching fill can smear a nearby edge across the sparkle. The adaptive stage measures endpoint agreement, lets direction vary by tile when local evidence is stronger, restores low-frequency structure at a second scale, and activates bounded patch synthesis only when measured texture justifies its cost. The real-fixture regression enforces that reconstruction does not modify unrelated image regions, create a large near-black silhouette, or break continuity of the dominant foreground edge.

## Why deterministic heuristics

- Easier to inspect than model-based removal.
- Faster to debug when one fixture fails.
- Portable between Node and browser userscript contexts.
- Suitable for research iteration on a narrow watermark family.

## Known failure surfaces

- Low-texture regions can expose subtraction artifacts.
- Cropped or resized screenshots may shift the expected template scale.
- Re-encoded or partially blurred watermarks can lower cross-correlation enough to fall below threshold.
- Non-PNG inputs are not a first-class target in the current code.
- The fallback default-placement heuristic can be wrong if an unrelated bright structure happens to sit near the expected Gemini margin.
- Overly aggressive cleanup can erase legitimate bright details near the watermark.

## Research posture

The pipeline intentionally favors inspectable heuristics over generalized claims. Each new heuristic should be justifiable against a specific failure case rather than added as blind complexity.

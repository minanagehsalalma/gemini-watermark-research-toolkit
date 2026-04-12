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
5. Suppress already accepted boxes so multi-mark cases do not repeatedly select the same region.

The code keeps separate thresholds for primary acceptance and weaker fallback acceptance:

- strong matches are accepted directly
- a weaker `48px` match can still be accepted if it lands close to Gemini's default bottom-right placement margin
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

## Removal pipeline

1. Load the fixed alpha template for the matched watermark size.
2. Interpret the visible watermark as a white additive layer with known per-pixel alpha.
3. For each covered pixel, solve the inverse blend approximately as:
   - `observed = alpha * white + (1 - alpha) * background`
   - `background ~= (observed - alpha * 255) / (1 - alpha)`
4. Clamp channel values into valid byte range after inversion.
5. Run a localized residual-healing step for bright corner artifacts, especially on `96px` cases.
6. Return the cleaned raster without changing unrelated regions.

The subtraction stage is intentionally local and deterministic. It does not inpaint the full corner patch unless the residual stage decides that the subtraction left a recognizable bright artifact.

## Residual healing

Residual healing is a targeted post-process, not a general inpainting pass.

The current implementation:

1. Opens a limited window around the expected high-risk corner region after subtraction.
2. Fits low-order local color planes to surrounding pixels.
3. Builds a mask for suspicious bright / low-saturation remnants.
4. Dilates that mask modestly to avoid hard edge transitions.
5. Replaces masked pixels with plane-predicted values and smooths the boundary region.

This is a pragmatic compromise. Simple subtraction often leaves a pale star-shaped remnant on low-texture backgrounds, but full-image inpainting would be harder to trust and harder to port into the userscript.

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

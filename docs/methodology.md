# Methodology

This repository uses a visible-watermark removal pipeline built around deterministic image operations.

## Detection pipeline

1. Restrict search to the bottom-right portion of the image.
2. Convert image data into grayscale and local contrast statistics.
3. Compare candidate regions against fixed sparkle templates.
4. Score matches with normalized structural correlation.
5. Accept strong matches directly and allow a weaker 48px match only when it lands at Gemini's default placement margin.

## Removal pipeline

1. Load the fixed alpha template for the matched watermark size.
2. Apply per-pixel subtraction to estimate the underlying image.
3. Run a localized residual-healing step for bright corner artifacts, especially on 96px cases.
4. Return the cleaned raster without changing unrelated regions.

## Why deterministic heuristics

- Easier to inspect than model-based removal.
- Faster to debug when one fixture fails.
- Portable between Node and browser userscript contexts.
- Suitable for research iteration on a narrow watermark family.

## Known failure surfaces

- Low-texture regions can expose subtraction artifacts.
- Cropped or resized screenshots may shift the expected template scale.
- Non-PNG inputs are not a first-class target in the current code.
- Overly aggressive cleanup can erase legitimate bright details near the watermark.

## Research posture

The pipeline intentionally favors inspectable heuristics over generalized claims. Each new heuristic should be justifiable against a specific failure case rather than added as blind complexity.

# Contributing

This repository is maintained as a research-oriented codebase. Contributions should improve clarity, reproducibility, or removal quality.

## Good contributions

- Detector improvements with a clear explanation of what failure mode they address.
- Removal-quality fixes with before/after evidence.
- Methodology notes that explain tradeoffs instead of only changing constants.
- Safer public packaging that avoids leaking private fixture images or local machine details.

## Fixtures and evidence

- Do not commit private or sensitive fixture images by default.
- Keep local evaluation images under `TestSet/` on your machine if you need them for experiments.
- When reporting a bug, include:
  - input dimensions
  - detector confidence
  - whether the watermark is the 48px or 96px variant
  - a cropped before/after region when possible

## Pull request style

- Prefer small, well-scoped changes.
- Update `README.md` or `docs/` when behavior or assumptions change.
- Explain the heuristic change in plain language.
- Avoid cosmetic churn unrelated to the research question being addressed.

# Research Direction

## Current focus

The current codebase is strongest on visible Gemini sparkle removal when the watermark appears in its expected bottom-right placement.

## Open questions

- Can the detector become more robust to rescaled or recompressed PNG exports without widening false positives?
- Can residual cleanup be made less heuristic-heavy while keeping browser portability?
- What compact benchmark format should replace private fixture folders for public repo work?
- Is there a small synthetic fixture generator worth building for regression coverage without redistributing source images?

## Next high-value improvements

1. Restore a sanitized benchmark set or synthetic fixture generator.
2. Reintroduce automated regression tests around detector confidence and removal quality.
3. Add command examples with expected console output to tighten reproducibility.
4. Separate detector scoring from remover orchestration to make experiments easier to compare.

## Publication stance

This repository should read as a narrowly scoped research artifact:

- explicit assumptions
- visible methodology
- clear limitations
- reproducible commands
- no vague claims about universal watermark removal

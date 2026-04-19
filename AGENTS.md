# Watterrr Agent Notes

## Purpose

- This repo is a local detector/remover toolkit for Gemini watermark research.
- The critical files are `detect-gemini-watermark.js`, `remove-gemini-watermark.js`, and `remove-gemini-watermark.userscript.js`.

## Required Workflow

- On Windows, run `windows-command-preflight` before git-heavy or search-heavy work.
- Prefer `rg` for searches.
- Use PowerShell-native commands only. Do not use Bash heredoc syntax in this repo.
- Before editing, inspect both remover files and the detector so logic stays aligned.

## Watermark Matching Rules

- Do not trust a clipped right-edge `56px-72px` detector-guided fallback by default. In this repo that case has produced false positives on already-clean outputs.
- Prefer exact/default-placement matches first.
- Keep the CLI and userscript matching policy in sync. If one gets a fallback or threshold change, port it to the other in the same pass.
- When changing fallback order or thresholds, test both the normal exact match path and the detector-guided path.

## Verification Rules

- Never claim the watermark is removed from logs alone.
- For userscript performance issues, verify the script does not start page-wide DOM scanning, eager image cleanup, or expensive template initialization during normal Gemini page load.
- Keep cleanup lazy by default: downloads/manual `cleanBlob()` may run the remover, but normal chat/image-generation UI must stay untouched unless the user explicitly opts into `rescan()`.
- For Gemini samples, verify all of these before closing:
  1. Run the CLI on the original image.
  2. Inspect a direct bottom-right crop of the output.
  3. Run the CLI again on the cleaned output and confirm it is a no-op.
  4. Verify the userscript path with `window.geminiWatermarkRemover.cleanBlob()` on the same image.
- If the detector still overfires on a clean image, say that explicitly and verify the remover ignores that false positive.

## Repo Hygiene

- `outputs/` is scratch space and is gitignored. Keep only useful local artifacts.
- Local sample fixtures such as `Gemini_Generated_Image_*.png` are intentionally untracked.
- Remove temporary probes, debug crops, and ad hoc test pages before finishing.

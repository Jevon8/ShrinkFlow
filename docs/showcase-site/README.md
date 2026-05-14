# ShrinkFlow Showcase Site

This directory contains the static portfolio showcase page for ShrinkFlow v1.2.0.

## What is this?

A single-file HTML page that presents ShrinkFlow as a product case study. It covers the problem, solution, decision engine, architecture, and roadmap. Designed for GitHub project pages, interview portfolios, and external presentation.

## How to open

Double-click `index.html` to open it directly in your browser. No build step, no server, no dependencies.

## Language

The page defaults to Chinese (zh-CN). A language toggle button in the top-right corner switches between Chinese and English. The selected language is saved in localStorage (`shrinkflow-showcase-lang`).

## How to replace screenshots

The "Product Screenshots" section supports real images with automatic CSS fallback.

1. Take screenshots of the ShrinkFlow app at 1280x800 or 1440x900 resolution, PNG format.
2. Save them into `assets/screenshots/` with these filenames:

```
01-import.png
02-smart-plan.png
03-plan-active.png
04-confirm-filter.png
05-progress.png
06-history.png
07-settings.png
08-release-folder.png
```

3. Refresh the page. Screenshots auto-display when files are present. When files are missing, CSS placeholders are shown instead — no broken image icons.

No HTML editing is needed. The `<img>` tags already point to these paths.

## Screenshot quality check (v1.2.0)

Current screenshot status for portfolio use:

| File | Status | Notes |
|------|--------|-------|
| 01-import.png | Usable | — |
| 02-smart-plan.png | Usable | — |
| 03-plan-active.png | Re-capture | If it has red annotation marks, re-capture without annotations |
| 04-confirm-filter.png | Usable | — |
| 05-progress.png | Usable | — |
| 06-history.png | Usable | — |
| 07-settings.png | Usable | — |
| 08-release-folder.png | Re-capture | Release-final folder should show v1.2.0 filenames |

Portfolio screenshots should avoid version number inconsistencies.

## How to export as PDF

1. Open `index.html` in your browser.
2. Press `Ctrl+P` (or `Cmd+P` on macOS).
3. Select "Save as PDF" as the destination.
4. The page includes `@media print` styles for clean PDF output.

## Important notes

- This is a portfolio showcase page, not part of the application code.
- Do not mix this with the product source code or build process.
- No `npm run build` or `npm run dist` is needed for this page.
- The page is fully offline — no external CDN, no external fonts, no external images.
- No "AI-powered" or "machine learning model" language is used.

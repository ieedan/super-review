---
"@super-review/desktop": minor
---

Render image diffs side by side, and add a Code/Image toggle for SVGs.

Image files (`png`, `jpg`, `gif`, `webp`, `avif`, `bmp`, `ico`, `svg`) now show their old and new versions side by side — like GitHub — instead of the "Binary file — diff not shown" placeholder. Raster images show only this side-by-side view; SVGs, being text, default to their source diff and gain a Markdown-preview-style "Image"/"Code" toggle so you can flip between the rendered image and the source. Image bytes up to 10 MB are embedded; larger files fall back to an "unavailable" note. Captured sessions freeze the image data so their image diffs render offline.

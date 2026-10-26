Vigil — favicon/device asset package

Exact source: original.png (unchanged bytes)
Technique: direct high-quality Lanczos resize; no AI generation, redrawing, retouching, cropping or added effects.
Input dimensions: 1254x1254 after optional square padding.

Files:
  favicon.ico                    -> browser icon (16/32/48 embedded)
  favicon-16x16.png             -> browser tab (small)
  favicon-32x32.png             -> browser tab / shortcut
  favicon-48x48.png             -> high-density browser icon
  apple-touch-icon.png          -> iOS/iPadOS (180x180)
  mstile-150x150.png            -> legacy Microsoft tile
  android-chrome-192x192.png    -> Android/PWA (192x192)
  android-chrome-512x512.png    -> Android/PWA (512x512)
  icon-192.png, icon-256.png, icon-512.png -> generic icons
  site.webmanifest              -> sample manifest (update names/colors as needed)

Static HTML integration (copy assets into your public root):
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">

Next.js App Router: place favicon.ico in app/ (or use explicit metadata icons),
and keep touch/PWA PNGs and site.webmanifest in public/.
For app routes using metadata.icons, point icon to /favicon.ico and apple to /apple-touch-icon.png.
Do not create a second conflicting icon.png/favicon in app/.

Caveats:
- This is a faithful raster resampling workflow, not an SVG/vectorization process.
- Small favicons may be less readable if the original has wide margins or fine details.
- For Apple touch/PWA home-screen icons, an opaque original/logo background works best.
- PWA maskable icons are NOT claimed/generated: they require a distinct safe-zone composition.

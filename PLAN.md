# Karate Belt Simulator — Plan

A frontend-only single-page app that lets someone preview a customized karate belt
on a white dogi in 3D, then share that exact customization as a link.

## Scope decisions

| Topic | Decision |
|---|---|
| Body | Placeholder mannequin for now; real dogi model later |
| Logos | Fictional/generic brand labels only — no real trademarks |
| User uploads | None. The brand label is a built-in generic design |
| Text | Kanji/katakana only (no romaji yet). User picks which tail each text goes on |
| Text length | Unclamped for now; text expands along the tail. Revisit later |
| Platform | Desktop Chrome first, but layout and performance must work on mobile |
| Color accuracy | Approximate; no calibration or disclaimer |
| Sharing | Config encoded in the URL query string; copy/paste the link. No social previews |
| Screenshot | "Download PNG" button |
| Store integration | Out of scope |
| Backend | None. Static hosting only |

## Tech stack

- **Vite + React + TypeScript**: app shell and build
- **three.js** via **@react-three/fiber** and **@react-three/drei**: rendering, `OrbitControls`, `RoundedBox`, `Environment`/`Lightformer`, `ContactShadows`, later `Decal`
- **Zustand**: single config store; the URL is derived from it
- **Vitest**: unit tests (URL encoding, layout math)
- Plain CSS for the control panel for now. Can move to Tailwind if the UI grows
- Later: **wanakana** (romaji → kana input helper, optional), **gltf-transform** for asset compression
- Hosting: any static host (Cloudflare Pages / Netlify / GitHub Pages)

## Architecture

### Units and coordinates
- Meters everywhere; +Y is up; the mannequin faces **+Z** (toward the default camera).
- The waist (belt center line) is at `y = 1.0`.

### Config model (`src/config/schema.ts`)
The single source of truth. Everything visual is derived from it.

```
BeltConfig
  color      preset id            (later: base + optional stripe / tips / two-tone)
  size       belt size preset     (0–8 → length in cm)
  width      4 | 5                (cm)
  waist      waist preset         (cm; drives mannequin + how long the tails hang)
  -- phase 2 --
  stitching  derived from width (10 rows @ 4cm, 12 @ 5cm; later: preset per brand)
  texts      [left, right]  each { text, color, weight 1–5, charWidth full|half }  (brush font)
  logo       boolean,  logoTail 'l'|'r'
  chest      { show, text, size (mm) }  (black brush-font vertical kanji on the wearer's left chest)
  hem        { show, text, label }  (black brush-font vertical column on the front edge where the jacket closes, just above the hem)
```

### URL format (`src/config/url.ts`)
- Query string, e.g. `?v=1&c=black&s=3&w=4&wa=80`.
- **Short stable string ids, never array indexes**, so presets can be reordered or added without breaking old links.
- `v` is the schema version. Decoding validates every field and falls back to the default **per field**, so a bad or old link never crashes the page.
- The store writes the URL with `history.replaceState` on every change, so the address bar is always the shareable link.
- Japanese text is URL-encoded UTF-8 (~9 chars per kanji). Add lz-string compression only if links get unwieldy.

### Scene composition (`src/scene/`)
- `Mannequin`: placeholder torso (lathe profile, elliptical cross-section), legs, arms, head. Waist size scales it.
- `Belt`, generated in code (not a fixed mesh) so length and width are just parameters:
  - **Wrap**: two stacked layers following the waist ellipse (real belts wrap twice)
  - **Knot**: placeholder rounded box; later a modeled knot scaled by width
  - **Tails**: two strips whose length = `(beltLength − wrapLength − knotAllowance) / 2`
- `ribbon.ts`: builds a strip with thickness along a list of frames (position, across, out). The front face is its own material group, with clean UVs (`u` along the length, `v` across the width), so text and logo textures can be added later without touching the geometry.

### Text and logos (phase 2)
- Draw text onto an offscreen `<canvas>` and use it as a `CanvasTexture` on the front face of the tail.
- Vertical (tategaki) layout along the tail; size, color and stroke weight come from the config.
- Generate a bump/normal map from the same canvas so it looks like raised embroidery.
- Japanese web fonts (Noto Serif/Sans JP, split into subsets via Google Fonts); wait for `document.fonts.load()` before drawing.

### Tail physics (phase 4)
- Turn each tail into a chain of points/bones driven by a small Verlet spring solver (gravity + damping + slight idle sway). No full cloth solver.
- The tail ribbon is already built from a list of frames, so physics only needs to update those frames each tick.

## Phases

### Phase 1: MVP scaffold ✅ (initial commit target)
- [x] Vite + React + TS + R3F project, dev server and build
- [x] Placeholder mannequin with waist presets
- [x] Generated belt: double wrap, knot, two tails
- [x] Belt color presets
- [x] Belt size (length) presets → tail length
- [x] Belt width 4cm / 5cm
- [x] Orbit / zoom camera with limits
- [x] Config ↔ URL sync + "Copy link"
- [x] "Download PNG"
- [x] Responsive panel (side panel on desktop, bottom sheet on mobile)
- [x] Unit tests for URL encode/decode

### Phase 2: Customization ✅
- [x] **Belt stitching**: parallel lines of stitching running the length of the belt (Shureido-style belts have ~10 rows across the width).
  - Draw the stitch pattern procedurally on a canvas → normal map + subtle color map on the belt (wrap, tails and knot). No image assets needed.
  - The row count, stitch length and thread tone depend on the width (4cm vs 5cm). Make them presets so different "brands" can differ later.
  - Build this first: it creates the canvas-texture pipeline that the tail text reuses.
- [x] ~~Body build~~ (removed later in favor of a single waist slider, 60–120 cm in 5 cm steps)
- [x] Canvas-texture text on each tail (kanji/katakana): one slot per tail with thread color (dropdown with catalog codes), stroke weight (1–5) and full/half-width characters; brush font for all embroidery
- [x] Japanese font loading (Google Fonts unicode-range slices; canvases redraw when glyphs arrive)
- [x] Generic black/red brand label, show/hide
- [x] Vertical chest kanji on the wearer's upper left chest (drei `Decal`), Shureido thread colors
- [x] Extended the URL schema (still `v=1`; new keys are optional and default when missing)

### Phase 2.5: Usability ✅
- [x] Accordion control panel (one section open at a time; collapsed sections show a summary of their values)
- [x] Click a part of the 3D model to open its section: belt wrap/knot → Belt, tail → Tail embroidery
  (flashes that tail's text, or moves a free text slot there), brand label → Brand label,
  upper jacket front → Chest kanji, rest of body → Body. Drags (camera rotation) don't count as clicks.

### Phase 2.7: Panel layout ✅
- [x] Sections: Belt · Belt embroidery (left tail, right tail, brand label) · Gi embroidery (chest kanji, hem) · Body
- [x] Clicking a part in 3D opens its section and flashes the specific group (tail, label, chest, hem)

### Phase 2.6: Jacket hem embroidery ✅
- [x] Black brush-font text written vertically up the front edge of the overlapping panel (where the jacket closes), starting ~2.5 cm above the hem, slanted ~17° to follow the collar line
- [x] Optional brand label below the text
- [x] Hem height and panel edge found automatically on the model (biggest depth steps), so it follows the waist slider

### Phase 3: Realism
- [x] Real dogi model (AI-generated scan, see "Dogi model pipeline" below), 765 KB compressed
- [x] Waist slider reshapes the model around the belt line; the generated belt wraps its measured waist
- [x] Modeled square knot: tilted vertical loop over the crossing; both tails come out from under its bottom edge at the same height and splay out, so equal tails end level (`src/scene/knot.ts`)
- [ ] Belt variants: stripe, colored tips, two-tone (red/white, red/black), dan bars

### Phase 4: Polish
- [x] Tail physics: stiff Verlet chain that only flexes out of the belt's plane (no sideways bending), gentle breeze, lift on click, reacts to camera orbit/pan (`src/scene/tailPhysics.ts`); breeze off with reduced-motion
- [ ] Mobile performance pass (DPR cap, triangle and texture budget, touch controls)
- [ ] Camera presets (front / side / tails close-up)
- [ ] Optional text-length clamping / auto-fit

## Dogi model pipeline
- Source: `assets/models/dogi-source.glb` (28 MB, git-ignored). It is a single fused mesh with a black belt baked in.
- `npm run model` = `model:prepare` + `model:optimize`:
  - `scripts/prepare-model.mjs`: finds the baked belt (connected dark-textured triangles grown from the back of
    the waist), deletes the hanging tails, flattens + repaints the wrap/knot as jacket fabric, rotates to face +Z,
    scales to meters with the belt line at y = 1.0, and writes the measured waist to `src/scene/dogiModel.json`.
  - `gltf-transform optimize`: simplify to ~100k triangles, meshopt + WebP 2K textures → `public/models/dogi.glb` (committed).
- At runtime (`src/scene/DogiModel.tsx`) the waist slider scales the model horizontally, full strength at the
  belt line and fading out toward the shoulders and hems.
- Known limits: the scan is baggy (≈112 cm waist as sculpted), so small waists pinch it in noticeably; faint
  repaint seams remain just above/below the belt; no head or hands (ghost-mannequin look).

## Reference dimensions (measured)
Real-world measurements the 3D scene is calibrated against. Source of truth in code:
`src/config/reference.ts`; `src/scene/beltLayout.test.ts` checks the app reproduces them.

| What | Measurement | Source | Used for |
|---|---|---|---|
| Tail length | **~35 cm** per tail, size 6 belt on a **~92 cm** waist (belt width assumed 4 cm) | Real belt, measured in person, 2026-11-22 | Knot allowance: belt − 2 wraps − 2 tails ≈ 45 cm for a 4 cm belt (scales with width) |
| Brand label length | **6.5 cm** along the tail | Same belt | Label size on the tail (and its proportions on the hem) |
| Brand label position | **0.5 cm** from the tip of the tail | Same belt | Label placement |

Still to measure: knot width/height, wrap overlap, belt thickness, embroidery character size on tails,
hem embroidery size/position.

## Shureido reference data
- **Belt sizes (official):** 00 = 190 cm, 0 = 200, 1 = 210, 1½ = 220, 2 = 230, 2½ = 240, 3 = 250, 3½ = 260,
  4 = 270, 4½ = 280, 5 = 290, 5½ = 300, 6 = 310, 6½ = 320, 7 = 330. Recommended wearer height is published
  for 00–6 (110–190 cm).
- **Embroidery threads (official catalog):** 白, 銀, 68, 69, 72, 10, 8, 114, 44, 43, 180, 2, 1, 39, 436, 53, 83,
  854, 856, 314, 387, 182, 816, 1079, 202, 244, 27, 28, 137. Hex values were sampled from Shureido's swatch
  photo, so they are approximate (camera sheen makes the whites and pale tints read a little bright).
- **Belt colors offered:** white, yellow, green, brown, black.
- **Brand label:** one generic black/red label (fictional), show/hide, on either tail.
- **Model:** see "Dogi model pipeline".
- **Chest:** black kanji embroidered directly on the jacket in the brush font, one vertical column, character size 3–7 cm (slider, default 5 cm). No patch.

## Open questions
- The mannequin is a fixed ~180 cm tall regardless of belt size. Should it scale to the size's wearer height?
- Knot allowance (5.5 × belt width) is a guess; tune against a real tied belt so tail lengths match photos.
- Long text currently runs up the tail and under the knot (by design for now). Decide on clamping/auto-fit.
- Stitching: currently tone-on-tone. Add a contrast thread option?
- Should waist size be a user-facing control or derived from belt size? (Currently a control.)
- Embroidery fonts: which styles to offer (block/mincho vs brush), and their licenses.
- Which way the text reads on each tail when worn (orientation convention).

# Karate Belt Simulator — Plan

A frontend-only single-page app that lets someone preview a customized karate belt
on a white dogi in 3D, then share that exact customization as a link.

## Scope decisions

| Topic | Decision |
|---|---|
| Body | Placeholder mannequin for now; real dogi model later |
| Logos | Fictional/generic brand labels only — no real trademarks |
| User uploads | None. All images (logos, patches) are presets referenced by id |
| Text | Kanji/katakana only (no romaji yet). User picks which tail each text goes on |
| Text length | Unclamped for now; text expands along the tail. Revisit later |
| Platform | Desktop Chrome first, but layout and performance must work on mobile |
| Color accuracy | Approximate; add a small disclaimer |
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
  texts[]    { tail: 'left'|'right', text, color, weight }
  logo       { id, tail } | none
  patch      preset id | none     (chest, upper left)
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

### Phase 2: Customization
- [ ] Canvas-texture text on either tail (kanji/katakana), per-text color and stroke weight
- [ ] Japanese font loading
- [ ] Preset (fictional) brand label on a tail
- [ ] Kanji patch on the upper left of the chest (drei `Decal` on the jacket)
- [ ] Extend the URL schema (bump to `v=2` only if a breaking change is needed)

### Phase 3: Realism
- [ ] Real dogi model (Blender → glTF, Draco/meshopt compressed), jacket lapels, sleeves, skirt
- [ ] Modeled square knot
- [ ] Materials: cotton vs satin belts (`MeshPhysicalMaterial` sheen), parallel stitch-row normal map, canvas-weave normal map for the dogi
- [ ] Belt variants: stripe, colored tips, two-tone (red/white, red/black), dan bars
- [ ] Color calibration against photos of real belts + disclaimer

### Phase 4: Polish
- [ ] Tail physics (Verlet chain)
- [ ] Mobile performance pass (DPR cap, triangle and texture budget, touch controls)
- [ ] Camera presets (front / side / tails close-up)
- [ ] Optional text-length clamping / auto-fit

## Open questions
- Exact belt size → length table (the current values are approximate and vary by maker).
- Should waist size be a user-facing control or derived from belt size? (Currently a control.)
- Embroidery fonts: which styles to offer (block/mincho vs brush), and their licenses.
- Which way the text reads on each tail when worn (orientation convention).

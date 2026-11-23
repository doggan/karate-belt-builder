# Task brief: clean up the gi model around the waist

This brief is self-contained, for a fresh agent that hasn't seen the earlier conversation.
Read it fully before changing anything. `PLAN.md` ("Dogi model pipeline") has background.

## The app in one paragraph

A frontend-only SPA (Vite + React 19 + TypeScript, react-three-fiber v9, drei v10, three
r187) showing a white karate gi (dogi) wearing a belt that is **generated in code**. The gi is
a scanned/AI-generated GLB model. Users customize the belt and embroidery, and set the waist
size, which reshapes the gi. Run it with `npm run dev` (http://localhost:5173). Checks:
`npx tsc --noEmit`, `npx vitest run`, `npm run build`.

## The problem

The source model came with a black belt baked into its geometry and texture. A one-off script
removed it, and the area where the belt used to be is now **full of jagged, spiky, stretched
polygons**: a ragged band around the waist, plus shards on the front of the jacket skirt where
the hanging tails were cut away. Parts of it show around the app's own belt, which is
narrower than the baked one. The task is to make that area look like clean, continuous jacket
fabric.

## How the model is produced

```
assets/models/dogi-source.glb   (28 MB, original download, git-ignored; don't modify)
   │  npm run model:prepare  → scripts/prepare-model.mjs
   ▼
assets/models/dogi-prepared.glb (27 MB, git-ignored) + src/scene/dogiModel.json (committed)
   │  npm run model:optimize → gltf-transform optimize: meshopt, WebP 2K textures,
   │                           simplify to ~10% (≈100k triangles), error 0.0005
   ▼
public/models/dogi.glb          (~750 KB, committed; what the app loads)
```

`npm run model` runs both steps. The tools available locally are Node with
`@gltf-transform/core`, `@gltf-transform/functions`, `@gltf-transform/cli` and `sharp`, plus
python3. **Blender is not installed.** You may add an npm dev dependency if it really helps
(e.g. `meshoptimizer` or a geometry library), but keep the pipeline reproducible from
`npm run model`.

### What `scripts/prepare-model.mjs` does today (the likely cause)

Source orientation: +X front, Y up, Z across the shoulders. One fused mesh, one primitive.

1. **Finds the belt band:** histograms dark-textured triangles (luminance < 70) at the back
   of the body to find the band's height `[beltLo, beltHi]`.
2. **Flood-fills the belt:** connected dark triangles (welding vertices by position across UV
   seams), then grows **3 extra rings** of triangles with luminance < 140 to catch
   anti-aliased edges.
3. **Deletes the hanging tails:** belt triangles below the band at the front. It then grows
   **5 rings** out from the deleted triangles and marks them for repainting.
   → Likely source of the ragged boundary and holes on the skirt front.
4. **"Flattens" the wrap and knot:** for every belt vertex, snaps its radius from the body
   axis to the **median radius of non-belt vertices just above/below the band, in 72 angle
   bins (5° each)**, moving vertices both in and out.
   → Likely main source of the jaggedness: each bin snaps to a constant radius (stair-steps
   between bins), belt vertices next to unsnapped neighbors produce long stretched triangles
   and spikes, the folds and overlaps of the original belt geometry (the knot, the layered
   wrap) collapse into self-intersecting slivers, and normals aren't recomputed.
5. **Repaints** the belt triangles in the base color, normal and metal/roughness textures
   with the median jacket color (flat normal), dilated 2.5 px in UV space.
6. **Measures the waist** cross-section, **transforms into app space** (faces +Z, meters, belt
   center at y = 1.0, scale set so the pants hem → belt center = 0.97 m), drops the deleted
   triangles, and writes `src/scene/dogiModel.json`.

Then the optimize step's simplification (to 10%) can make bad triangles worse.

## What a good result looks like

- Around the whole waist, the jacket surface is smooth and continuous between the clean
  fabric above and below the old belt band: no spikes, slivers, holes, stair-steps or
  inside-out faces. Plausible soft fabric is fine; perfect folds aren't needed.
- The front of the jacket skirt, where the tails were, is clean fabric with no holes or
  ragged shards. The jacket's front opening (one panel overlapping the other) should still
  read sensibly below the belt.
- The texture there matches the surrounding gi: no dark leftovers from the black belt and no
  obvious flat-color patch. Seams may stay faint, since the app's belt covers the middle
  ~4 cm of the old ~6.3 cm band.
- Normals are recomputed (or carried correctly) so the lighting is smooth over the repaired
  area.

## Hard constraints

- **Keep the pipeline in code:** `npm run model` must regenerate `public/models/dogi.glb` and
  `src/scene/dogiModel.json` from `dogi-source.glb`. No hand-edited binary outputs.
- **Keep app space the same:** faces +Z, meters, belt line at y = `WAIST_Y` = 1.0, same overall
  scale (`HEM_TO_WAIST` = 0.97). `dogiModel.json` keeps the same fields (`waistY`,
  `waist.a`/`waist.b` = the waist half-axes the belt wraps around, `bakedBeltWidth`, `minY`,
  `maxY`). If the waist measurements change, check that the generated belt still sits snugly
  on the jacket without sinking in or floating.
- **Size budget:** `public/models/dogi.glb` should stay roughly under 1 MB. It loads behind
  a progress bar and should stay quick.
- **Runtime code depends on the surface** (`src/scene/DogiModel.tsx`):
  - The waist slider reshapes the mesh horizontally with a gaussian falloff around y = 1.0
    (`reshapeWaist`). It must still look good at waists of 60 and 120 cm.
  - `findJacketHem` locates the jacket's bottom edge by raycasting down the front (the
    biggest step back in depth), and `findPlacketEdge` finds the jacket's closing edge
    (the biggest depth step scanning across x) just above the hem. The hem embroidery is
    placed from these. Re-check that both still land correctly (turn on hem embroidery:
    Gi embroidery → Hem embroidery).
  - The chest kanji decal is projected onto the upper chest (Gi embroidery → Chest kanji).
- Don't touch the belt, knot or tail code (`Belt.tsx`, `knot.ts`, `strand.ts`,
  `tailShape.ts`, `tailPhysics.ts`) or the stitching/embroidery code. This task is the gi
  model only.
- Don't commit; the user commits themselves.

## Suggested approaches (pick what works; these are ideas, not requirements)

- **Don't snap per angle bin.** Treat the belt region as a hole in the jacket surface and
  fill it smoothly from its boundary, e.g. hold the clean vertices fixed and relax the
  belt-region vertices with Laplacian/harmonic smoothing (many iterations) so they settle
  into a smooth membrane between the rims above and below.
- **Or rebuild the band:** delete the belt region's triangles entirely and loft a new
  strip between the upper and lower boundary loops (matched by angle around the body),
  with UVs mapped onto a clean patch of jacket texture.
- **Clean the boundary first:** grow or shrink the selected region to a smooth outline (no
  one-triangle notches), and remove slivers and degenerate or non-manifold triangles before
  smoothing.
- **Tails area:** delete the tails, then fill the resulting holes on the skirt the same way,
  rather than relying on repainting the fringe.
- **Texture:** instead of a flat median color, copy (clone-stamp) real fabric texture from
  just above/below the band, or blur and blend so the repaired area doesn't read as a patch.
- Recompute vertex normals over the repaired region after moving vertices.
- **Simplification:** if the optimize step's simplification re-introduces artifacts, try a
  gentler ratio or locking the repaired region's borders.

## How to verify

1. `npm run model`, then `npm run dev` and open http://localhost:5173.
2. Look at the waist from all around, front, sides, back and 3/4 views, zoomed in close.
   Do this with a **white belt** (the jacket edges are easiest to judge) and a **black
   belt**, at waists **60, 85 and 120 cm** (Body section).
3. Look at the jacket skirt front, below the knot and between the tails.
4. Turn on chest kanji and hem embroidery and check they still sit correctly on the jacket.
5. Compare before/after screenshots from the same views (record the camera views you use).
6. `npx tsc --noEmit && npx vitest run && npm run build` must pass. Report the new
   `public/models/dogi.glb` size and triangle count.

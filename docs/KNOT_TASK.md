# Task brief: belt knot and tail shape

This brief is self-contained, for a fresh agent that hasn't seen the earlier conversation.
Read it fully before changing code. `PLAN.md` has the wider project plan.

## The app in one paragraph

A frontend-only SPA (Vite + React 19 + TypeScript, react-three-fiber v9, drei v10,
three r187, zustand) showing a white karate gi (a scanned GLB model) wearing a belt that is
**generated in code**. Users pick belt color, size (official Shureido lengths), embroidery on
each tail, a brand label near one tail tip, and the waist size; the state is shared via the
URL. The belt tails have a lightweight cloth simulation. Run with `npm run dev` (port 5173).
Checks: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

## What the user wants now

1. **Tails should protrude from the knot, then hang.** Today they leave the knot and go
   straight down-and-out in a flat plane, so they look like stiff, flat paper. A real belt
   tail comes *forward* out of the knot (it's pushed out by the knot's bulk), arcs over, and
   then falls under gravity. It has visible thickness and softness: a slight curve along its
   length, maybe a gentle twist or a slight cupping across its width, not a perfectly flat
   plane.
2. **The knot still looks bad.** It should read clearly as a karate belt square knot. The
   user has a reference photo: **ask the user for it before starting knot work** (suggest
   saving it as `docs/knot-reference.jpg`). An earlier reference showed the classic look: a
   near-vertical band wrapping around the horizontal crossing strands, with one tail coming
   out from the top on one side and the other from the bottom on the other side, both then
   hanging down in a splayed "inverted V".

## Hard constraints (decided by the user; don't change these)

- **Both tails are the same length and end level** (same height). An earlier version had
  the right tail higher; the user flagged it twice.
- **Tails must look connected to the knot**: each visibly emerges from under or out of the
  knot, with no gaps or floating ends.
- **Physics:** tails may flex **only out of their own plane** (toward/away from the jacket,
  i.e. along the face normal `out`). **No sideways motion** across the belt's width. The user
  found sideways wobble and wave ripples unnatural, then asked for the out-of-plane motion to
  be "slightly loose". The tails also react to the camera orbiting/panning (already
  implemented: keep it).
- Tail length comes from `computeBeltLayout(config).tailLength` and is calibrated against a
  real belt (see `src/config/reference.ts`: a size 6 belt on a 92 cm waist gives ~35 cm tails).
  The knot's belt usage is `KNOT_LENGTH_PER_WIDTH` in `beltLayout.ts`. If the new knot visibly
  uses more or less belt, the tail length should still come from the layout; don't hand-tune
  tails to look right.
- **Embroidery and the brand label are drawn on the tails' front faces** using physical UVs
  (u = distance along the tail / belt width). The brand label sits 0.5 cm from the tip and is
  6.5 cm long. Clicking a tail uses `e.uv.x * width` to tell whether the label was hit.
  Whatever you do to the tail shape, keep `tailFrames` → `buildRibbon` / `buildFaceStrip`
  producing a strip whose u runs knot → tip and whose front face (`out`) faces the viewer.
- Belt is 4 cm wide (`BELT_WIDTH_CM`), `BELT_THICKNESS` 4 mm. One standard cotton material
  with procedural stitch rows (10 rows lengthwise) on the faces.
- No real trademarks; the generic brand label is fine.
- Performance: this must stay smooth while dragging the waist slider (everything in
  `Belt.tsx` re-runs per waist step). Keep geometry building to a few ms.

## Coordinate system

Meters. +Y up, +Z toward the viewer (the gi's front faces +Z), +X is the **viewer's right**.
The belt is centered at `WAIST_Y` (≈1.0). Belt wraps are ellipses (`innerWrap`, `outerWrap`
with half-axes `a` in x and `b` in z); the knot sits at the center front, x ≈ 0, z ≈ `outerWrap.b`.

## Files to touch

| File | What it does today |
| --- | --- |
| `src/scene/knot.ts` | `buildKnot(layout)` → `{ loop, core, tailStart: { l, r } }`. **Core:** a short horizontal ribbon in front of the wrap. **Loop:** a ribbon swept along an arc (top → front → bottom), tilted 13° (`LOOP_TILT`), 0.95 × belt width, curling back by `az` = 0.25w. **Tail starts:** both at (±0.12w, `WAIST_Y` − 0.74w, z0 + 1.1t), mirrored, just behind the loop's bottom edge. |
| `src/scene/ribbon.ts` | Sweep helpers. `Frame = { p, across, out }`. `buildRibbon(frames, width, thickness, closed, uLength)` makes a rectangular cross-section strip (material group 0 = both faces, group 1 = edges). `buildFaceStrip` is a thin front-face overlay for embroidery. `curveFrames(points, acrossHint)`, `framesFromPoints(points)` (used every frame for the simulated tails), `ellipseFrames`, and **`tailFrames(start, side, length, angle, segments)`**, which builds the straight, flat rest shape: each segment heads `(side·sin a, −cos a, 0.06)` with the splay angle easing from 36° at the knot to ~23° at the tip. |
| `src/scene/Belt.tsx` | Builds wraps, knot and tails. `TAIL_SPLAY` 36°, `TAIL_SEGMENTS` 32. Creates a `TailSim` per tail from the rest frames; `useFrame` advances it, adds the camera push, and rebuilds the tail ribbons from `framesFromPoints(sim.points())`. |
| `src/scene/tailPhysics.ts` | `TailSim`: Verlet chain springing to the rest shape (`K_ROOT` 260 → `K_TIP` 32), damping 0.965, length constraints, sideways lock (removes motion along `across`), forces only along `out`, a gentle breeze, `nudge()` on click, `BACK_LIMIT` so tails don't sink into the jacket. |
| `src/scene/beltLayout.ts` | `computeBeltLayout` → `{ width, thickness, innerWrap, outerWrap, beltLength, tailLength, … }`. |

Important detail: `framesFromPoints` rebuilds `across`/`out` from the point chain every
frame, so any **twist or cross-width shape** in the rest frames is lost once the sim runs.
If you add twist/cupping, carry the extra orientation through the sim, e.g. store per-particle
rest `across` vectors and rotate them with the chain.

## History: what was tried and rejected

1. A box/"square" at the front: rejected ("the belt shouldn't be a square").
2. A horizontal band across the front: rejected; the user sent the reference image.
3. A vertical loop with tails attached elsewhere: tails looked disconnected.
4. Tails moved under the loop: "still messed up, right tail higher".
5. Current: symmetric tail starts below the loop's bottom edge, a flatter loop so the tails
   stay behind it. The user says it **still looks very bad**.

The common failure is that the knot is assembled from separate pieces (a loop ribbon, a core
ribbon, two tails starting at points) that don't read as one continuous belt. Consider
modelling the knot as **continuous strands**: each belt end follows one path from the wrap,
through the knot, out into its tail, so connections are seamless by construction. The knot
should also have volume: it's several belt layers thick (~4 layers × 4 mm) and sits proud of
the wrap.

## Ideas for the tails (suggestions, not requirements)

- Rest shape as a curve, not a straight line: the first ~3–6 cm head forward (+Z) and
  slightly outward from the knot, then bend over and fall roughly like a heavy strap
  (e.g. a smooth blend from the exit direction to the hanging direction over the first ~25%
  of the length), keeping the inverted-V splay.
- Thickness/softness cues: slightly rounded edges or a small camber across the width in
  `buildRibbon`; a subtle lengthwise curve; maybe a few degrees of twist near the tip. Keep
  it subtle: the user wants it to read as a thick cotton belt, not a ribbon.
- Keep the physics' out-of-plane-only rule relative to the *local* frame of the curved rest
  shape.

## How to verify

- `npm run dev`, open http://localhost:5173. Check the default view and orbit around:
  front, 3/4 views, from below, and the side profile (the tail protrusion shows best side-on).
- Try sizes 00 (short tails) and 7 (long), waists 60 and 120, and both tails with embroidery
  plus the brand label on each side (the label must stay at the tip, upright and readable).
- Drag the waist slider: it must stay smooth.
- Click a tail (it lifts and settles; the panel jumps to that tail's section; clicking the
  label opens the label group).
- `npx tsc --noEmit && npx vitest run && npm run build` must pass.
  `src/scene/beltLayout.test.ts` pins the reference tail length (35 cm).
- Don't commit; the user commits themselves.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A p5.js (WebGL) computer-graphics course exercise (`L9/P9`). Plain client-side
JavaScript — **no build step, no tests, no linter, no package manager.** Comments
and the git history are in Korean.

## Running

Loading OBJ models and image/sound assets goes through `fetch`, which the
browser blocks under `file://`. Serve over HTTP instead of double-clicking
`index.html`:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Both sketches use **pointer lock** (click the canvas to capture the mouse). p5
is vendored at `libraries/p5.min.js` (v1.10.0); `jsconfig.json` wires up the
p5-vscode type stubs for editor autocomplete only.

## The deliverable is sketch.js

`sketch.js` is the actual project — a per-part bounding-box picker for an
elephant model. `index.html` loads only it.

`fps.js` is **reference scaffolding**, not part of the deliverable. It was
copied from an earlier project for its first-person movement/camera logic, which
was then ported into `sketch.js`; it is not referenced by `index.html` and its
`preload`ed assets (`src/prof.png`, `src/Subway Surf.mp3`) are absent. Treat it
as read-only context for the camera math — don't wire it into `index.html`
(it defines the same global p5 entrypoints as `sketch.js`, so the two cannot
load together), and don't extend it as if it were live code.

## sketch.js architecture

The elephant is loaded as 8 **separate** OBJ parts (`src/elpt/{head,body,ear_L,
ear_R,leg_FL,leg_FR,leg_BL,leg_BR}.obj`), listed in `PARTS`. `loadModel` is
called **without** `normalize`, so all parts stay aligned in one shared model
space. (`src/elpt.obj` is the merged single-mesh version; `src/elpt_sep.obj` a
separated variant — neither is used by the current code.)

Pipeline:
1. `setup()` computes a world-space AABB per part (`computeWorldAABB`) once,
   since the model transform is fixed, and unions them to place the camera.
2. `draw()` renders the mesh, then draws each part's AABB as a wireframe box.
3. A ray from the camera along the view direction (`pickPart` → `rayAABB` slab
   test) selects the part under the screen center; the hit box turns red.

**Critical invariant:** `modelToWorld()` manually replays the exact transform
`draw()` applies to the mesh — `translate(20,40,-20)` · `rotateX(PI)` ·
`rotateY(HALF_PI)` · `scale(22.5)`. The AABBs are only correct while these two
stay identical. **If you change the mesh transform in `draw()`, update
`modelToWorld()` to match (and vice-versa)**, or the boxes will desync from the
model.

## fps.js (reference only)

A first-person chase game kept for reference. Useful patterns it demonstrates,
several of which were carried into `sketch.js`: the yaw/pitch pointer-lock
camera; a **billboarded** textured `plane` that always faces the player
(`rotateY(atan2(...))`); `resolveAxis` collision that moves then resolves the X
and Z axes **separately** (axis-by-axis push-out); and distance-mapped music
volume. Not maintained as part of this project.

## Conventions (sketch.js)

- **Camera:** yaw/pitch first-person rig. Mouse look via pointer lock; `WASD`
  to move; forward is `(sin(yaw), -cos(yaw))`, right is `(cos(yaw), sin(yaw))`.
- **Up is `-y`** in this world (screen-up = negative Y). The camera stands on a
  gray floor `plane` at `groundY` (the scene's lowest point, i.e. max world Y);
  `Space` jumps and gravity (`velY`/`gravity`/`jumpSpeed`) pulls it back to
  `standY = groundY - eyeHeight`. No free up/down fly anymore.
- `R` resets the view to its initial position/orientation (and clears `velY`).

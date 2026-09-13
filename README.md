# Render Inspector

A browser workbench for Umbrella Lua draw captures. Open a JSON capture, preview frames, select a panel or individual primitives, then copy the corresponding Lua or export a smaller capture.

**[Open the website](https://madonchik123.github.io/render-inspector/)** · **[Download the recorder](recorder/render_proxy.lua)**

Files are read on your device. The viewer does not upload captures or imported images, use analytics, or fetch asset URLs from captures. The included example is synthetic.

## Capture a UI

1. Put `recorder/render_proxy.lua` in your Umbrella scripts directory as `000_render_proxy.lua`. Keep one installed copy. The early name helps installation order; aliases cached before installation cannot be intercepted.
2. Reload scripts. The recorder discovers exported drawing helpers and stays idle. Loading or reloading scripts does not start a capture or write a capture file.
3. Open **Scripts → Tools → Render Inspector → Capture → Recorder**. Open the panel you want to inspect, then use **Capture frame** or **Capture 30 frames**. The separate test-panel action generates an explicitly labeled test capture.
4. Open `render calls.json` from your Umbrella directory in the website. Captures can include displayed text and source paths; review the file before sharing it with others.

## Inspect and copy

- **Parts** lists visible supported primitives. **Groups** lists helper calls with captured children. **All calls** includes entries without preview support.
- Click a part, drag a selection rectangle, or Ctrl/Cmd-click for multiple parts. Right-click to select its containing panel, copy Lua, copy JSON, or copy source information.
- Step through frames and draw order. Change the preview resolution to inspect scaling.
- The export dialog offers coordinate scaling and draw-state context. It expands helper groups into captured child calls to avoid drawing them twice.
- Use **Add images** to supply missing textures locally. Assets are matched by filename. The capture contains resource metadata, not game texture pixels.
- Ctrl/Cmd+A selects visible parts, Ctrl/Cmd+C copies selected Lua, Delete hides the selection, and Escape clears it.

Exported Lua reconstructs recorded draw calls. It cannot recover the original script's variables, conditionals, callbacks, or complete source. Review export warnings and resource declarations before using it in a script.

## Capture coverage

| API or source | Capture | Preview |
| --- | --- | --- |
| `Render` | Plain-table functions, excluding geometry/size queries | Supported 2D primitives and draw state |
| `Renderer` | Legacy `Draw*`, `SetDrawColor`, clip and font/image loading when present as a plain table | Legacy coordinate and color adapters |
| `LIB_RENDER` | Known drawing helpers | Common text, image and primitive layouts |
| `XHelpers.XRender`, modules, exported scripts, `Panel` and `Panels` | Discovery of exported plain Lua drawing methods | Child-call grouping; unknown helpers remain inspectable as raw calls |
| Native HUD, Panorama, hidden upvalues, cached aliases | May bypass hooks | Not reconstructed |

Discovery is bounded to depth 3, 512 tables and 20,000 entries. Captures report installed hooks, discovered tables, limits reached, dropped calls and errors. A recorded method does not automatically have a visual adapter. Native metatables and class facades are never patched.

Clipping, alpha, legacy color and draw order are replayed. Fonts, blur, shadows and some gradients are approximations. Rotation is reported but not replayed. Offscreen render-target children are retained as data rather than incorrectly placed on screen. Missing images show placeholders.

Recorder limits: 1–120 frames per request, 1,500 calls per frame, 12,000 total calls, approximately 8 MiB of argument snapshots and 512 resources. Capture starts only when you press a capture button or call `capture()`/`demo()`. A requested capture saves when it finishes.

The website parses and checks files in a background worker with visible progress, then indexes calls by frame. Only the selected frame is prepared for preview. Nested helper metadata is preserved without a property-count or nesting-depth rejection, and there is no 30,000-call import limit. Files up to 128 MiB are accepted; larger files get an explicit size message. Opening another file cancels the previous import. Lua hooks still add overhead during capture.

## Recorder API

```lua
local capture = Render.__recorder
capture.discover()
capture.capture(30) -- starts next frame, exports after completion
capture.watch(MyPanel, "MyPanel", {Paint = true, DrawHeader = true})
-- capture.finish() -- finish early and export
-- capture.export() -- write current capture
-- capture.stop()   -- restore slots still owned by this recorder
```

`watch` accepts an exported plain Lua table. Register methods before capturing. Methods beginning with `On` are excluded to preserve engine callback registration. The recorder forwards original arguments and return values, restores nesting after errors, and rethrows the original error.

The version 2 JSON contains `screen`, `calls`, `sources`, `resources`, `hooks` and `discovery`. Calls carry frame, ID, optional parent ID, library, method, source index, argument snapshots and result snapshots. Typed values use `kind` tags such as `Vec2`, `Vector` and `Color`; unavailable values are explicit markers. Earlier ungrouped captures remain readable.

## Development and GitHub Pages

Requires a recent Node.js version supporting `node:test` and `import.meta.dirname`; Node 22 or newer is suitable. No package installation is needed.

```sh
npm test
npm run build
```

Tests cover normalization, geometry, state, selection exports and browser-controller interactions with a DOM/canvas stub. The recorder behavior test also runs when the Luau CLI is installed. These tests do not replace visual testing in a browser or live testing in Dota.

The project root is a static site with `.nojekyll`. GitHub Pages can publish from `main` and `/ (root)`. `npm run build` also produces a standalone `dist/` directory. Do not commit actual user captures or game assets.

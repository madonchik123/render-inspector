import {
  indexFrames,
  validate,
  buildFrame,
  describe,
  source,
  sourceLine,
  contains,
  encloses,
  rect,
  panelSelection,
  descendants,
  union,
} from "./model.js";
import { renderScene, assetKey } from "./paint.js";
import { luaExport, selectionJSON } from "./export.js";
import { exampleCapture } from "./example.js";
import { importCapture } from "./import.js";

const $ = (id) => document.getElementById(id),
  canvas = $("canvas"),
  ctx = canvas.getContext("2d");
const state = {
  data: null,
  frames: [],
  frame: null,
  tab: "parts",
  selected: new Set(),
  hidden: new Set(),
  hover: null,
  focus: null,
  zoom: 1,
  target: { width: 1920, height: 1080 },
  assets: new Map(),
  drag: null,
  dragEnd: null,
  playing: false,
  timer: null,
  drawPending: false,
  list: [],
  exported: null,
};
let noticeTimer;
let activeImport;
function notify(message, error = false) {
  clearTimeout(noticeTimer);
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
  $("notice").hidden = false;
  if (!error) noticeTimer = setTimeout(() => ($("notice").hidden = true), 6500);
}
function stopPlay() {
  state.playing = false;
  clearInterval(state.timer);
  $("play").textContent = "▶";
  $("play").setAttribute("aria-label", "Play capture");
}
function clearAssets() {
  for (const image of new Set(state.assets.values())) image.close?.();
  state.assets.clear();
}
function openData(data, name) {
  activeImport?.abort();
  activeImport = null;
  validate(data);
  stopPlay();
  clearAssets();
  state.data = data;
  const frames = indexFrames(data);
  state.frames = [...frames.keys()].sort(
    (a, b) => a - b,
  );
  state.selected.clear();
  state.hidden.clear();
  state.focus = null;
  state.hover = null;
  state.zoom = 1;
  state.target = { ...data.screen };
  $("filename").textContent = name || data.label || "Capture";
  $("welcome").hidden = true;
  canvas.hidden = false;
  $("width").value = data.screen.width;
  $("height").value = data.screen.height;
  $("frame").replaceChildren();
  const counts = new Map([...frames].map(([frame, calls]) => [frame, calls.length]));
  for (const f of state.frames) {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = f;
    $("frame").append(o);
  }
  $("api-filter").replaceChildren(new Option("All drawing APIs", ""));
  for (const lib of [
    ...new Set(data.calls.map((c) => c.library || "Render")),
  ].sort())
    $("api-filter").append(new Option(lib, lib));
  $("search").value = "";
  const best = state.frames.reduce(
    (a, b) => ((counts.get(b) || 0) > (counts.get(a) || 0) ? b : a),
    state.frames[0],
  );
  $("frame").value = best ?? "";
  $("coverage").textContent =
    `${data.calls.length.toLocaleString()} calls · ${data.sources.length} source stacks · ${data.dropped || 0} dropped. ${data.coverage || "Coverage depends on the recorder."}`;
  $("audit").textContent = JSON.stringify(
    {
      discovery: data.discovery,
      missingHooks: (data.hooks || []).filter((h) => !h.installed),
      resourceDropped: data.resourceDropped || 0,
    },
    null,
    2,
  );
  setFrame(best);
  if (!data.calls.length)
    notify(
      "The capture contains no calls. Open the target UI and record again.",
      true,
    );
  else
    notify(
      `Opened ${data.calls.length.toLocaleString()} calls. Your file stays in this browser.`,
    );
}
async function openFile(file) {
  if (!file) return;
  activeImport?.abort();
  const request = new AbortController();
  activeImport = request;
  stopPlay();
  const progress = message => {
    notify(`${message} — ${file.name}`);
    clearTimeout(noticeTimer);
  };
  progress("Opening capture");
  try {
    const data = await importCapture(file, {signal: request.signal, progress});
    if (request.signal.aborted) return;
    activeImport = null;
    openData(data, file.name);
  } catch (e) {
    if (e.name !== "AbortError") notify(e.message, true);
  } finally {
    if (activeImport === request) activeImport = null;
    if (!request.signal.aborted) $("file").value = "";
  }
}
function setFrame(number) {
  state.frame = buildFrame(state.data, number);
  state.selected.clear();
  state.hidden.clear();
  state.hover = null;
  state.focus = null;
  $("frame").value = number ?? "";
  const max = state.frame.nodes.length;
  $("step").max = max;
  $("step").value = max;
  update();
  fit();
}
function currentCutoff() {
  const i = Number($("step").value);
  return i ? (state.frame?.nodes[i - 1]?.call.id ?? Infinity) : -1;
}
function matches(n) {
  const lib = $("api-filter").value,
    q = $("search").value.toLowerCase();
  return (
    (!lib || n.library === lib) &&
    (!q ||
      `${describe(n)} ${n.call.method} ${n.library} ${source(n.call, state.data)}`
        .toLowerCase()
        .includes(q))
  );
}
function baseList() {
  if (!state.frame) return [];
  return state.tab === "parts"
    ? state.frame.parts
    : state.tab === "helpers"
      ? state.frame.helpers
      : state.frame.nodes;
}
function update() {
  if (!state.frame) return;
  state.list = baseList().filter(
    (n) => matches(n) && !state.hidden.has(n.call.id),
  );
  $("layer-count").textContent = state.list.length;
  $("layers").replaceChildren();
  for (const n of state.list) {
    const b = document.createElement("button");
    b.className = "layer" + (state.selected.has(n.call.id) ? " active" : "");
    b.setAttribute("aria-pressed", state.selected.has(n.call.id));
    const glyph = document.createElement("span");
    glyph.className = "glyph";
    glyph.textContent = n.helper
      ? "▱"
      : n.method === "Text"
        ? "T"
        : n.method.includes("Image")
          ? "▧"
          : n.supported
            ? "□"
            : "·";
    const label = document.createElement("span");
    label.className = "layer-text";
    const title = document.createElement("strong");
    title.textContent = describe(n);
    const detail = document.createElement("small");
    detail.textContent = `#${n.call.id} · ${n.library}${n.bounds ? " · " + Math.round(n.bounds[2]) + " × " + Math.round(n.bounds[3]) : " · data only"}`;
    label.append(title, detail);
    b.append(glyph, label);
    b.onclick = (e) => select(n.call.id, e.ctrlKey || e.metaKey);
    b.onpointerenter = () => {
      state.hover = n.call.id;
      scheduleDraw();
    };
    b.onpointerleave = () => {
      state.hover = null;
      scheduleDraw();
    };
    b.oncontextmenu = (e) => {
      if (!state.selected.has(n.call.id)) select(n.call.id);
      showContext(e);
    };
    $("layers").append(b);
  }
  $("list-empty").hidden = state.list.length > 0;
  $("list-empty").textContent =
    state.tab === "helpers"
      ? "No helper groups in this frame. Version 2 captures can include parent calls."
      : "No matching calls. Try All calls or clear the filter.";
  $("selected-count").textContent = state.selected.size;
  $("export").disabled = !state.selected.size;
  $("select-panel").disabled = !state.focus;
  $("hide").disabled = !state.selected.size;
  $("restore").hidden = !state.hidden.size;
  $("step-label").textContent =
    `${$("step").value} / ${state.frame.nodes.length}`;
  const n = state.frame.byId.get(state.focus);
  $("selected-title").textContent =
    state.selected.size > 1
      ? `${state.selected.size} parts selected`
      : n
        ? describe(n)
        : "Nothing selected";
  $("selected-meta").textContent = n
    ? `${n.library}.${n.call.method} · frame ${n.call.frame}`
    : "Click a part or drag around a group.";
  $("source").textContent = n
    ? source(n.call, state.data)
    : "No source selected.";
  $("arguments").textContent = n
    ? JSON.stringify(
        {
          id: n.call.id,
          parentId: n.call.parentId,
          args: n.call.args,
          results: n.call.results,
          error: n.call.error,
        },
        null,
        2,
      )
    : "—";
  $("geometry").replaceChildren();
  const box = union(
    [...state.selected].map((id) => state.frame.byId.get(id)?.bounds),
  );
  if (box)
    for (const [i, label] of ["X", "Y", "Width", "Height"].entries()) {
      const div = document.createElement("div");
      div.className = "metric";
      const span = document.createElement("span");
      span.textContent = label;
      div.append(
        span,
        document.createTextNode(String(Math.round(box[i] * 10) / 10)),
      );
      $("geometry").append(div);
    }
  scheduleDraw();
}
function select(id, add = false) {
  if (!add) state.selected.clear();
  if (add && state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  state.focus = id;
  update();
}
function selectPanel() {
  if (!state.focus) return;
  state.selected = panelSelection(state.frame, state.focus);
  update();
  if (state.selected.size < 2)
    notify("No containing panel found. Drag around the parts you need.");
}
function hideSelection() {
  state.hidden = new Set([
    ...state.hidden,
    ...descendants(state.frame, state.selected),
  ]);
  state.selected.clear();
  state.focus = null;
  update();
}
function fit() {
  if (!state.data) return;
  const stage = $("stage"),
    ratio = state.target.width / state.target.height;
  const width =
    Math.max(
      150,
      Math.min(stage.clientWidth - 48, (stage.clientHeight - 48) * ratio),
    ) * state.zoom;
  canvas.style.width = width + "px";
  canvas.style.height = width / ratio + "px";
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round((width / ratio) * dpr));
  $("zoom-label").textContent = Math.round(state.zoom * 100) + "%";
  scheduleDraw();
}
function scheduleDraw() {
  if (state.drawPending) return;
  state.drawPending = true;
  requestAnimationFrame(() => {
    state.drawPending = false;
    draw();
  });
}
function draw() {
  if (!state.frame) return;
  const hidden = new Set(state.hidden);
  for (const n of state.frame.parts) if (!matches(n)) hidden.add(n.call.id);
  renderScene(ctx, {
    frame: state.frame,
    screen: state.data.screen,
    width: canvas.width,
    height: canvas.height,
    selected: state.selected,
    hover: state.hover,
    assets: state.assets,
    wire: $("wire").checked,
    hidden,
    cutoff: currentCutoff(),
    drag: state.drag && state.dragEnd ? rect(state.drag, state.dragEnd) : null,
  });
}
function cursor(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * state.data.screen.width) / r.width,
    y: ((e.clientY - r.top) * state.data.screen.height) / r.height,
  };
}
function hits(p) {
  return state.frame.parts.filter(
    (n) =>
      n.call.id <= currentCutoff() &&
      !state.hidden.has(n.call.id) &&
      matches(n) &&
      contains(n.effective, p),
  );
}
canvas.onpointerdown = (e) => {
  if (e.button !== 0 || !state.data) return;
  state.drag = cursor(e);
  state.dragEnd = state.drag;
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (!state.data) return;
  const p = cursor(e);
  $("coordinates").textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
  if (state.drag) state.dragEnd = p;
  else state.hover = hits(p).at(-1)?.call.id ?? null;
  scheduleDraw();
};
canvas.onpointerleave = () => {
  state.hover = null;
  $("coordinates").textContent = "";
  scheduleDraw();
};
canvas.onpointercancel = () => {
  state.drag = null;
  state.dragEnd = null;
  scheduleDraw();
};
canvas.onpointerup = (e) => {
  if (e.button !== 0 || !state.drag) return;
  const p = cursor(e),
    start = state.drag;
  state.drag = null;
  state.dragEnd = null;
  const add = e.ctrlKey || e.metaKey;
  if (Math.hypot(p.x - start.x, p.y - start.y) > 5) {
    if (!add) state.selected.clear();
    const area = rect(start, p);
    for (const n of state.frame.parts)
      if (
        n.call.id <= currentCutoff() &&
        matches(n) &&
        !state.hidden.has(n.call.id) &&
        encloses(area, n.effective)
      )
        state.selected.add(n.call.id);
    state.focus = [...state.selected].at(-1);
    update();
  } else {
    const hit = hits(p).at(-1);
    if (hit) select(hit.call.id, add);
    else if (!add) {
      state.selected.clear();
      state.focus = null;
      update();
    }
  }
};
canvas.oncontextmenu = (e) => {
  if (!state.data) return;
  const p = cursor(e);
  if (
    ![...state.selected].some((id) =>
      contains(state.frame.byId.get(id)?.effective, p),
    )
  ) {
    const hit = hits(p).at(-1);
    if (hit) select(hit.call.id);
  }
  showContext(e);
};
function showContext(e) {
  e.preventDefault();
  if (!state.selected.size) return;
  const menu = $("context");
  menu.hidden = false;
  menu.style.left =
    Math.max(8, Math.min(e.clientX, innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.top =
    Math.max(8, Math.min(e.clientY, innerHeight - menu.offsetHeight - 8)) +
    "px";
}
document.addEventListener("click", (e) => {
  if (!$("context").contains(e.target)) $("context").hidden = true;
});
function createExport() {
  state.exported = luaExport(state.data, state.frame, state.selected, {
    scale: $("scale-code").checked,
    context: $("context-code").checked,
  });
  $("code").value = state.exported.code;
  $("export-warning").textContent =
    `${state.exported.count} calls exported. ${state.exported.warnings.length ? state.exported.warnings.join(" ") : "Review dynamic values before using this snapshot."}`;
  return state.exported;
}
function exportDialog() {
  if (!state.selected.size) return;
  createExport();
  $("export-dialog").showModal();
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    notify("Copied to clipboard.");
  } catch {
    if (!$("export-dialog").open) $("export-dialog").showModal();
    $("code").value = text;
    $("code").focus();
    $("code").select();
    notify(
      "Clipboard access was blocked. Press Ctrl/Cmd-C to copy the selected text.",
    );
  }
}
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function copyLua() {
  if (state.selected.size) copy(createExport().code);
  $("context").hidden = true;
}
for (const id of ["open", "welcome-open"])
  $(id).onclick = () => $("file").click();
$("file").onchange = (e) => openFile(e.target.files[0]);
$("example").onclick = () =>
  openData(exampleCapture(), "Example capture (synthetic)");
$("assets").onclick = () => $("image-files").click();
$("image-files").onchange = async (e) => {
  let count = 0;
  for (const file of [...e.target.files].slice(0, 64)) {
    try {
      if (file.size > 10 * 1024 * 1024)
        throw Error("Image too large: " + file.name);
      const image = await createImageBitmap(file);
      if (image.width > 8192 || image.height > 8192) {
        image.close();
        throw Error("Image dimensions exceed 8192 pixels.");
      }
      state.assets.get(assetKey(file.name))?.close?.();
      state.assets.set(assetKey(file.name), image);
      count++;
    } catch (error) {
      notify(error.message, true);
    }
  }
  if (count)
    notify(`Added ${count} images. Filenames match captured asset names.`);
  scheduleDraw();
  e.target.value = "";
};
for (const [id, tab] of [
  ["parts-tab", "parts"],
  ["helpers-tab", "helpers"],
  ["raw-tab", "raw"],
])
  $(id).onclick = () => {
    state.tab = tab;
    for (const name of ["parts", "helpers", "raw"])
      $(name + "-tab").classList.toggle("active", name === tab);
    update();
  };
$("search").oninput = update;
$("api-filter").onchange = update;
$("frame").onchange = () => {
  stopPlay();
  setFrame(Number($("frame").value));
};
function advance(delta) {
  if (!state.frames.length) return;
  const i = state.frames.indexOf(state.frame.frame),
    next = (i + delta + state.frames.length) % state.frames.length;
  setFrame(state.frames[next]);
}
$("prev").onclick = () => {
  stopPlay();
  advance(-1);
};
$("next").onclick = () => {
  stopPlay();
  advance(1);
};
$("play").onclick = () => {
  if (state.playing) return stopPlay();
  if (state.frames.length < 2) return;
  state.playing = true;
  $("play").textContent = "Ⅱ";
  $("play").setAttribute("aria-label", "Pause capture");
  state.timer = setInterval(() => advance(1), 160);
};
$("step").oninput = () => {
  $("step-label").textContent =
    `${$("step").value} / ${state.frame?.nodes.length || 0}`;
  scheduleDraw();
};
$("wire").onchange = scheduleDraw;
$("zoom-in").onclick = () => {
  state.zoom = Math.min(5, state.zoom * 1.25);
  fit();
};
$("zoom-out").onclick = () => {
  state.zoom = Math.max(0.25, state.zoom / 1.25);
  fit();
};
$("fit").onclick = () => {
  state.zoom = 1;
  fit();
};
new ResizeObserver(fit).observe($("stage"));
$("resolution").onclick = () => {
  state.target = {
    width: Math.max(320, Math.min(7680, Number($("width").value) || 1920)),
    height: Math.max(200, Math.min(4320, Number($("height").value) || 1080)),
  };
  fit();
};
$("select-panel").onclick = selectPanel;
$("ctx-panel").onclick = () => {
  selectPanel();
  $("context").hidden = true;
};
$("clear").onclick = () => {
  state.selected.clear();
  state.focus = null;
  update();
};
$("hide").onclick = () => state.frame && hideSelection();
$("ctx-hide").onclick = () => {
  hideSelection();
  $("context").hidden = true;
};
$("restore").onclick = () => {
  state.hidden.clear();
  update();
};
$("export").onclick = exportDialog;
$("close-export").onclick = () => $("export-dialog").close();
$("scale-code").onchange = createExport;
$("context-code").onchange = createExport;
$("copy-code").onclick = () => copy($("code").value);
$("save-lua").onclick = () =>
  download($("code").value, "selected-ui.lua", "text/plain");
$("save-json").onclick = () =>
  download(
    selectionJSON(state.data, state.frame, state.selected),
    "selection.json",
    "application/json",
  );
$("ctx-lua").onclick = copyLua;
$("ctx-json").onclick = () => {
  copy(selectionJSON(state.data, state.frame, state.selected));
  $("context").hidden = true;
};
$("ctx-source").onclick = () => {
  copy(
    [
      ...new Set(
        [...state.selected].map((id) =>
          source(state.frame.byId.get(id).call, state.data),
        ),
      ),
    ].join("\n\n"),
  );
  $("context").hidden = true;
};
$("help").onclick = () => $("help-dialog").showModal();
$("close-help").onclick = () => $("help-dialog").close();
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("context").hidden = true;
    if (!$("export-dialog").open && !$("help-dialog").open) {
      state.selected.clear();
      state.focus = null;
      update();
    }
    return;
  }
  if (
    !state.frame ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) ||
    $("export-dialog").open ||
    $("help-dialog").open
  )
    return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    state.selected = new Set(
      state.frame.parts.filter(matches).map((n) => n.call.id),
    );
    update();
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === "c" &&
    state.selected.size
  ) {
    e.preventDefault();
    copyLua();
  }
  if (e.key === "Delete") hideSelection();
});
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  $("stage").classList.add("drop-target");
});
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) $("stage").classList.remove("drop-target");
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  $("stage").classList.remove("drop-target");
  openFile(e.dataTransfer.files[0]);
});
for (const id of ["export", "select-panel", "hide"]) $(id).disabled = true;

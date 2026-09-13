import { stateMethods, normalize, descendants, sourceLine } from "./model.js";
const quote = (s) =>
  '"' +
  String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(
      /[\x00-\x1f\x7f]/g,
      (c) => "\\" + c.charCodeAt(0).toString().padStart(3, "0"),
    ) +
  '"';
const num = (n) =>
  Number.isInteger(n) ? String(n) : String(Number(n.toFixed(5)));
function value(v, scaled = true) {
  if (v == null || v.kind === "nil") return "nil";
  if (typeof v === "number") return num(v);
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") {
    if (v.endsWith(" [truncated]")) throw Error("truncated string");
    return quote(v);
  }
  if (v.kind === "Vec2")
    return `${scaled ? "P" : "Vec2"}(${num(v.x)}, ${num(v.y)})`;
  if (v.kind === "Vector")
    return `${scaled ? "V" : "Vector"}(${num(v.x)}, ${num(v.y)}, ${num(v.z)})`;
  if (v.kind === "Color")
    return `Color(${num(v.r)}, ${num(v.g)}, ${num(v.b)}, ${num(v.a)})`;
  if (v.kind === "table")
    return (
      "{" +
      v.entries
        .map((e) => "[" + value(e.key, false) + "] = " + value(e.value, scaled))
        .join(", ") +
      "}"
    );
  throw Error(`cannot reconstruct ${v.kind || "unknown value"}`);
}
export function selectionJSON(data, frame, ids) {
  const selected = descendants(frame, ids);
  const calls = frame.nodes
    .filter((n) => selected.has(n.call.id))
    .map((n) => ({
      ...n.call,
      parentId: selected.has(n.call.parentId) ? n.call.parentId : undefined,
    }));
  return JSON.stringify(
    {
      ...data,
      label: "Selection",
      calls,
      firstFrame: frame.frame,
      lastFrame: frame.frame,
    },
    null,
    2,
  );
}
export function luaExport(
  data,
  frame,
  ids,
  { scale = true, context = true } = {},
) {
  const selected = descendants(frame, ids),
    resources = Object.values(data.resources || {}),
    vars = new Map(),
    declarations = [],
    warnings = [],
    body = [];
  const nodes = frame.nodes.filter(
    (n) => selected.has(n.call.id) || (context && stateMethods.has(n.method)),
  );
  function resource(handle, font, library = "Render") {
    const key = library + (font ? ":font:" : ":image:") + handle;
    if (vars.has(key)) return vars.get(key);
    const r = resources.find(
        (r) =>
          r.result === handle && (library === "Renderer" ? r.library === "Renderer" : r.library !== "Renderer") &&
          (font
            ? ["LoadFont", "default_font", "default_font_awesome"].includes(
                r.method,
              )
            : ["LoadImage", "LoadSvg", "LoadSvgString"].includes(r.method)),
      ),
      name = (font ? "font" : "image") + (vars.size + 1);
    vars.set(key, name);
    if (!r) {
      warnings.push(
        `Supply ${name}: resource ${handle} was loaded before the recorder.`,
      );
      declarations.push(
        `local ${name} = nil -- supply the correct resource handle`,
      );
      return name;
    }
    try {
      const prefix = ["LIB_RENDER", "Renderer"].includes(r.library) ? r.library : "Render";
      declarations.push(
        `local ${name} = ${prefix}.${r.method}${r.method.startsWith("default_font") ? "" : "(" + r.args.map((v) => value(v, false)).join(", ") + ")"}`,
      );
    } catch (e) {
      declarations.push(`local ${name} = nil`);
      warnings.push(`${name}: ${e.message}`);
    }
    return name;
  }
  for (const n of nodes) {
    const c = n.call,
      lib = c.library || "Render";
    if (n.helper) {
      warnings.push(
        `Expanded helper #${c.id} ${lib}.${c.method} into captured child calls.`,
      );
      continue;
    }
    if (!["Render", "LIB_RENDER", "Renderer"].includes(lib)) {
      warnings.push(
        `Skipped #${c.id}: ${lib}.${c.method} has no known replay adapter.`,
      );
      continue;
    }
    if (
      c.method.startsWith("Load") ||
      [
        "load_image",
        "font",
        "FindOrCreateRT",
        "ResizeRT",
        "MarkDirtyRT",
      ].includes(c.method)
    )
      continue;
    if (n.offscreen) {
      warnings.push(
        `Skipped #${c.id}: render-target coordinates need manual integration.`,
      );
      continue;
    }
    if (!/^[A-Za-z_]\w*$/.test(c.method)) {
      warnings.push("Skipped invalid method name.");
      continue;
    }
    try {
      const args = c.args.map((v) => value(v, scale));
      if (n.method === "Text") {
        args[0] = resource(c.args[0], true, lib);
        if (scale && lib !== "Renderer") args[1] = `S(${args[1]})`;
      }
      if (lib === "Render" && ["Image", "ImageCentered"].includes(c.method))
        args[0] = resource(c.args[0], false);
      if (lib === "Render" && c.method === "TexturedPoly")
        args[1] = resource(c.args[1], false);
      if (lib === "Renderer" && ["DrawImage", "DrawImageCentered"].includes(c.method)) args[0] = resource(c.args[0], false, lib);
      const lengths =
        lib === "LIB_RENDER"
          ? {
              filled_rect: [3],
              outline_rect: [3],
              glow: [3, 4],
              line: [3],
              circle: [1],
              filled_circle: [1],
            }
          : {
              FilledRect: [3],
              Rect: [3, 5],
              Line: [3],
              Circle: [1, 3],
              FilledCircle: [1],
              Shadow: [3, 4],
              ShadowCircle: [1, 3],
              Gradient: [6],
              OutlineGradient: [6, 8],
              Image: [4],
              ImageCentered: [4],
              Blur: [4],
              RoundedProgressRect: [4, 5],
            };
      if (scale)
        for (const i of lengths[c.method] || [])
          if (typeof c.args[i] === "number") args[i] = `S(${args[i]})`;
      if (scale && lib === "Renderer") {
        const xywh = {0:"X",1:"Y",2:"X",3:"Y"};
        const mapping = c.method === "DrawText" ? {1:"X",2:"Y"} : ["DrawImage","DrawImageCentered"].includes(c.method) ? {1:"X",2:"Y",3:"X",4:"Y"} : ["DrawFilledCircle","DrawOutlineCircle"].includes(c.method) ? {0:"X",1:"Y",2:"S"} : ["DrawLine","DrawFilledRect","DrawOutlineRect","DrawFilledRoundedRect","DrawOutlineRoundedRect","DrawGlow","DrawBlur","DrawFilledRectFade","DrawFilledGradRect","PushClip"].includes(c.method) ? xywh : {};
        for (const [i, axis] of Object.entries(mapping)) if (typeof c.args[i] === "number") args[i] = `${axis === "S" ? "S" : "S" + axis}(${args[i]})`;
        if (c.method === "DrawText") warnings.push("Legacy font size was captured at load time; review it at other resolutions.");
      }
      body.push(
        `\t-- #${c.id} ${sourceLine(c, data).replace(/[\r\n]/g, " ")}`,
        `\t${lib}.${c.method}(${args.join(", ")})`,
      );
    } catch (e) {
      warnings.push(`Skipped #${c.id} ${lib}.${c.method}: ${e.message}.`);
    }
  }
  const lines = [
    "-- Reconstructed snapshot values, not original variables or layout logic.",
    "-- Review missing resources, initial draw state and dynamic values before use.",
    ...warnings.map((w) => "-- " + w.replace(/[\r\n]/g, " ")),
    ...declarations,
    "",
    "local function drawSelection()",
    "\tlocal screen = Render.ScreenSize()",
    `\tlocal sx, sy = screen.x / ${data.screen.width}, screen.y / ${data.screen.height}`,
    "\tlocal function P(x, y) return Vec2(x * sx, y * sy) end",
    "\tlocal function V(x, y, z) return Vector(x * sx, y * sy, z) end",
    "\tlocal function S(n) return n * math.min(sx, sy) end",
    "\tlocal function SX(n) return n * sx end",
    "\tlocal function SY(n) return n * sy end",
    ...body,
    "end",
    "",
    "return { OnDraw = drawSelection }",
  ];
  return { code: lines.join("\n"), warnings, count: body.length / 2 };
}

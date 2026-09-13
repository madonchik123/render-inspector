export const LIMITS = { bytes: 32 * 1024 * 1024, calls: 30000, nodes: 500000 };
const finite = (n) => typeof n === "number" && Number.isFinite(n);
export const vec = (v) => v && finite(v.x) && finite(v.y);
export const array = (v) => (Array.isArray(v) ? v : []);
const aliases = {
  filled_rect: "FilledRect",
  outline_rect: "Rect",
  glow: "Shadow",
  blur: "Blur",
  clip: "PushClip",
  pop_clip: "PopClip",
  gradient: "Gradient",
  line: "Line",
  circle: "Circle",
  filled_circle: "FilledCircle",
  gradient_circle: "CircleGradient",
  glow_circle: "ShadowCircle",
  triagle: "Triangle",
  filled_triagle: "FilledTriangle",
};
export const stateMethods = new Set([
  "PushClip",
  "PopClip",
  "SetGlobalAlpha",
  "ResetGlobalAlpha",
  "StartRotation",
  "StopRotation",
  "SetDrawColor",
]);
export const colorCSS = (v, fallback = "#8296ac") =>
  v?.kind === "Color"
    ? `rgba(${v.r},${v.g},${v.b},${Math.max(0, Math.min(1, v.a / 255))})`
    : fallback;
export function tableArray(v) {
  return array(v?.entries)
    .filter((e) => Number.isInteger(e.key))
    .sort((a, b) => a.key - b.key)
    .map((e) => e.value);
}
export function validate(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray(value.calls) ||
    !Array.isArray(value.sources)
  )
    throw Error(
      "This is not a render capture. Export JSON with the Render Proxy first.",
    );
  if (
    !finite(value.screen?.width) ||
    !finite(value.screen?.height) ||
    value.screen.width < 1 ||
    value.screen.height < 1 ||
    value.screen.width > 16384 ||
    value.screen.height > 16384
  )
    throw Error("The capture needs a valid screen width and height (1–16384).");
  if (value.calls.length > LIMITS.calls)
    throw Error(
      "This capture exceeds the 30,000-call limit. Capture fewer frames.",
    );
  const seen = new Set(),
    ids = new Set(),
    stack = [{ v: value, d: 0 }];
  let count = 0;
  while (stack.length) {
    const { v, d } = stack.pop();
    if (++count > LIMITS.nodes || d > 24)
      throw Error("The capture is too complex to open.");
    if (typeof v === "number" && !Number.isFinite(v))
      throw Error("The capture contains a non-finite number.");
    if (!v || typeof v !== "object") continue;
    if (seen.has(v)) throw Error("Cyclic capture data is unsupported.");
    seen.add(v);
    for (const x of Object.values(v)) stack.push({ v: x, d: d + 1 });
  }
  for (const c of value.calls) {
    if (
      !Number.isInteger(c.id) ||
      ids.has(c.id) ||
      !Number.isInteger(c.frame) ||
      typeof c.method !== "string" ||
      !Array.isArray(c.args)
    )
      throw Error("A draw call has invalid identifiers or arguments.");
    ids.add(c.id);
    if (c.library != null && typeof c.library !== "string")
      throw Error("Invalid drawing library.");
    if (c.parentId != null && (!ids.has(c.parentId) || c.parentId === c.id))
      throw Error("A parent call must precede its children.");
  }
  if (value.sources.some((s) => typeof s !== "string"))
    throw Error("Source stacks must be strings.");
  return value;
}
export function parseCapture(text) {
  if (new TextEncoder().encode(text).length > LIMITS.bytes)
    throw Error("Choose a JSON file smaller than 32 MB.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error("The file is not valid JSON.");
  }
  return validate(data);
}
export function normalize(c) {
  let a = c.args,
    m = c.method;
  const lib = c.library || "Render";
  if (lib === "LIB_RENDER") {
    m = aliases[m] || m;
    if (c.method === "text") {
      m = "Text";
      a = [a[0], a[1], a[3], a[2], a[4], a[5]];
    }
    if (c.method === "image") {
      m = "Image";
      a = [a[0], a[1], a[2], a[4], a[5]];
    }
  }
  if (lib === "Renderer") {
    const p = (x, y) => ({ kind: "Vec2", x, y });
    if (
      [
        "DrawFilledRect",
        "DrawOutlineRect",
        "DrawFilledRoundedRect",
        "DrawOutlineRoundedRect",
        "DrawGlow",
        "DrawBlur",
        "PushClip",
      ].includes(m)
    ) {
      m = {
        DrawFilledRect: "FilledRect",
        DrawOutlineRect: "Rect",
        DrawFilledRoundedRect: "FilledRect",
        DrawOutlineRoundedRect: "Rect",
        DrawGlow: "Shadow",
        DrawBlur: "Blur",
        PushClip: "PushClip",
      }[m];
      a =
        m === "PushClip"
          ? [p(a[0], a[1]), p(a[0] + a[2], a[1] + a[3]), a[4]]
          : m === "Shadow"
            ? [p(a[0], a[1]), p(a[0] + a[2], a[1] + a[3]), null, a[4], a[5]]
            : m === "Blur"
              ? [p(a[0], a[1]), p(a[0] + a[2], a[1] + a[3]), a[4], a[6], a[5]]
              : [p(a[0], a[1]), p(a[0] + a[2], a[1] + a[3]), null, a[4]];
    } else if (m === "DrawLine") {
      m = "Line";
      a = [p(a[0], a[1]), p(a[2], a[3]), null];
    } else if (m === "DrawText") {
      m = "Text";
      a = [a[0], 16, a[3], p(a[1], a[2]), null];
    } else if (m === "DrawImage" || m === "DrawImageCentered") {
      m = m === "DrawImage" ? "Image" : "ImageCentered";
      a = [a[0], p(a[1], a[2]), p(a[3], a[4]), null];
    } else if (m === "DrawFilledCircle" || m === "DrawOutlineCircle") {
      m = m === "DrawFilledCircle" ? "FilledCircle" : "Circle";
      a = [p(a[0], a[1]), a[2], null];
    } else if (
      [
        "DrawPolyLine",
        "DrawPolyLineFilled",
        "DrawFilledTriangle",
        "DrawOutlineTriangle",
        "DrawTexturedPolygon",
      ].includes(m)
    )
      m = {
        DrawPolyLine: "PolyLine",
        DrawPolyLineFilled: "FilledTriangle",
        DrawFilledTriangle: "FilledTriangle",
        DrawOutlineTriangle: "Triangle",
        DrawTexturedPolygon: "TexturedPoly",
      }[m];
    else if (m === "DrawFilledRectFade" || m === "DrawFilledGradRect") {
      m = "Gradient";
      a = [p(a[0], a[1]), p(a[2], a[3]), ...a.slice(4)];
    }
  }
  const color = a.find((x) => x?.kind === "Color");
  return {
    call: c,
    library: lib,
    method: m,
    args: a,
    color,
    align: lib === "LIB_RENDER" && m === "Text" ? tableArray(a[5]) : [],
    supported: false,
  };
}
export function primitiveBounds(p) {
  if (p.method === "Line" && vec(p.args[0]) && vec(p.args[1])) {
    const b = rect(p.args[0], p.args[1]), pad = Math.max(1, Number(p.args[3]) || 1) / 2;
    return [b[0] - pad, b[1] - pad, b[2] + pad * 2, b[3] + pad * 2];
  }
  const a = p.args,
    m = p.method;
  if (
    [
      "FilledRect",
      "Rect",
      "Gradient",
      "OutlineGradient",
      "Shadow",
      "Blur",
      "RoundedProgressRect",
      "PushClip",
      "Line",
    ].includes(m) &&
    vec(a[0]) &&
    vec(a[1])
  )
    return rect(a[0], a[1]);
  if (
    [
      "Circle",
      "FilledCircle",
      "CircleGradient",
      "ShadowCircle",
      "ShadowNGon",
      "DonutChart",
      "Logo",
    ].includes(m) &&
    vec(a[0]) &&
    finite(a[1]) &&
    a[1] >= 0
  )
    return [a[0].x - a[1], a[0].y - a[1], a[1] * 2, a[1] * 2];
  if (["Image", "ImageCentered"].includes(m) && vec(a[1]) && vec(a[2])) {
    let x = a[1].x,
      y = a[1].y;
    if (m === "ImageCentered") {
      x -= a[2].x / 2;
      y -= a[2].y / 2;
    }
    return [x, y, a[2].x, a[2].y];
  }
  if (m === "Text" && vec(a[3]) && finite(a[1])) {
    const lines = String(a[2]).split("\n"),
      w = Math.max(...lines.map((x) => x.length), 1) * a[1] * 0.56,
      h = Math.max(1, lines.length) * a[1] * 1.2;
    return [
      a[3].x - (p.align[0] ? w / 2 : 0),
      a[3].y - (p.align[1] ? h / 2 : 0),
      w,
      h,
    ];
  }
  if (
    [
      "Triangle",
      "FilledTriangle",
      "PolyLine",
      "TexturedPoly",
      "ShadowConvexPoly",
    ].includes(m)
  ) {
    const pts = tableArray(a[0]).filter(vec);
    if (pts.length) {
      const xs = pts.map((x) => x.x),
        ys = pts.map((x) => x.y);
      return [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      ];
    }
  }
  return null;
}
export function rect(a, b) {
  return [
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
  ];
}
export function intersect(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x = Math.max(a[0], b[0]),
    y = Math.max(a[1], b[1]);
  return [
    x,
    y,
    Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - x),
    Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - y),
  ];
}
export const contains = (b, p) =>
  b && p.x >= b[0] && p.y >= b[1] && p.x <= b[0] + b[2] && p.y <= b[1] + b[3];
export const encloses = (a, b) =>
  a &&
  b &&
  b[0] >= a[0] - 1 &&
  b[1] >= a[1] - 1 &&
  b[0] + b[2] <= a[0] + a[2] + 1 &&
  b[1] + b[3] <= a[1] + a[3] + 1;
export function union(boxes) {
  const b = boxes.filter(Boolean);
  if (!b.length) return null;
  const x = Math.min(...b.map((v) => v[0])),
    y = Math.min(...b.map((v) => v[1]));
  return [
    x,
    y,
    Math.max(...b.map((v) => v[0] + v[2])) - x,
    Math.max(...b.map((v) => v[1] + v[3])) - y,
  ];
}
export function source(c, data) {
  return data.sources[(c.source || 0) - 1] || "Source unavailable";
}
export function sourceLine(c, data) {
  return (
    source(c, data)
      .split("\n")
      .find((l) => /\.lua:\d+/.test(l) && !l.includes("render_proxy.lua"))
      ?.trim() ||
    source(c, data)
      .split("\n")
      .find((l) => /\.lua:\d+/.test(l))
      ?.trim() ||
    "Source unavailable"
  );
}
export function describe(p) {
  const a = p.args,
    m = p.method;
  if (m === "Text") return String(a[2]).slice(0, 100);
  if (m === "Image" && typeof a[0] === "string") return a[0].split("/").pop();
  return (
    {
      FilledRect: "Background",
      Rect: "Border",
      Shadow: "Shadow / glow",
      Blur: "Blur",
      Gradient: "Gradient",
      PushClip: "Begin clip",
      PopClip: "End clip",
    }[m] || p.call.method
  );
}
export function buildFrame(data, frame) {
  const calls = data.calls.filter((c) => c.frame === frame),
    nodes = calls.map(normalize),
    byId = new Map(nodes.map((n) => [n.call.id, n]));
  let clips = [],
    alpha = 1,
    rotation = 0,
    legacyColor = { kind: "Color", r: 255, g: 255, b: 255, a: 255 };
  const rtParents = new Set();
  for (const n of nodes) {
    n.children = [];
    n.bounds = primitiveBounds(n);
    n.supported = !!n.bounds && !stateMethods.has(n.method);
    n.clip = clips.at(-1) || null;
    n.alpha = alpha;
    n.rotation = rotation;
    if (n.library === "Renderer") {
      if (n.method === "SetDrawColor") {
        const a = n.args;
        legacyColor = {
          kind: "Color",
          r: a[0] ?? 255,
          g: a[1] ?? 255,
          b: a[2] ?? 255,
          a: a[3] ?? 255,
        };
      }
      n.color = legacyColor;
      if (n.method === "Text") {
        const font = Object.values(data.resources || {}).find(
          (r) =>
            r.result === n.args[0] &&
            r.library === "Renderer" &&
            r.method === "LoadFont",
        );
        if (font) n.args[1] = font.args[1];
        n.bounds = primitiveBounds(n);
      }
      if (n.call.method === "DrawFilledGradRect") {
        const a = n.call.args,
          c1 = { kind: "Color", r: a[4], g: a[5], b: a[6], a: a[7] },
          c2 = { kind: "Color", r: a[8], g: a[9], b: a[10], a: a[11] };
        n.args = [
          n.args[0],
          n.args[1],
          c1,
          a[12] ? c2 : c1,
          a[12] ? c1 : c2,
          c2,
        ];
      }
      if (n.call.method === "DrawFilledRectFade") {
        const a = n.call.args,
          c1 = { ...legacyColor, a: a[4] },
          c2 = { ...legacyColor, a: a[5] };
        n.args = [n.args[0], n.args[1], c1, a[6] ? c2 : c1, a[6] ? c1 : c2, c2];
      }
    }
    const parent = byId.get(n.call.parentId);
    if (parent) parent.children.push(n.call.id);
    n.offscreen =
      !!parent && (parent.method === "RenderRT" || parent.offscreen);
    if (n.method === "RenderRT") rtParents.add(n.call.id);
    if (n.method === "PushClip" && n.bounds)
      clips.push(
        n.args[2] === false ? n.bounds : intersect(clips.at(-1), n.bounds),
      );
    if (n.method === "PopClip") clips.pop();
    if (n.method === "SetGlobalAlpha" && finite(n.args[0])) alpha = n.args[0];
    if (n.method === "ResetGlobalAlpha") alpha = 1;
    if (n.method === "StartRotation") rotation++;
    if (n.method === "StopRotation") rotation = Math.max(0, rotation - 1);
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!n.bounds && n.children.length)
      n.bounds = union(n.children.map((id) => byId.get(id)?.bounds));
    n.helper = n.children.length > 0;
    n.effective = intersect(n.bounds, n.clip);
    n.visible =
      !!n.bounds &&
      n.bounds.every(finite) &&
      n.effective[2] > 0 &&
      n.effective[3] > 0 &&
      (!n.color || n.color.a * n.alpha > 0.5) &&
      !n.offscreen;
  }
  return {
    frame,
    nodes,
    byId,
    parts: nodes.filter(
      (n) => n.visible && !stateMethods.has(n.method) && !n.helper,
    ),
    helpers: nodes.filter((n) => n.helper && n.visible),
    unmapped: nodes.filter((n) => !n.bounds && !stateMethods.has(n.method)),
    warnings: [
      ...(clips.length ? ["Unclosed clip stack."] : []),
      ...(rotation ? ["Unclosed rotation."] : []),
      ...(rtParents.size
        ? ["Render-target children are listed but not placed on the screen."]
        : []),
    ],
  };
}
export function descendants(frame, ids) {
  const result = new Set(ids),
    queue = [...ids];
  while (queue.length) {
    const n = frame.byId.get(queue.pop());
    for (const id of n?.children || [])
      if (!result.has(id)) {
        result.add(id);
        queue.push(id);
      }
  }
  return result;
}
export function panelSelection(frame, id) {
  const node = frame.byId.get(id);
  if (!node?.bounds) return new Set();
  let ancestor = frame.byId.get(node.call.parentId);
  while (ancestor) {
    if (ancestor.helper && ancestor.bounds)
      return descendants(frame, [ancestor.call.id]);
    ancestor = frame.byId.get(ancestor.call.parentId);
  }
  const bg = frame.parts
    .filter((n) => n.method === "FilledRect" && encloses(n.bounds, node.bounds))
    .sort((a, b) => a.bounds[2] * a.bounds[3] - b.bounds[2] * b.bounds[3])[0];
  if (!bg) return new Set([id]);
  return new Set(
    frame.parts
      .filter((n) => encloses(bg.bounds, n.bounds))
      .map((n) => n.call.id),
  );
}

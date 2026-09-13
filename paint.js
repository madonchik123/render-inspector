import { colorCSS, tableArray, vec } from "./model.js";
export function assetKey(path) {
  return String(path)
    .split(/[\\/]/)
    .pop()
    .toLowerCase()
    .replace(/_(png|jpg|psd)\.vtex_c$/, "")
    .replace(/\.(png|jpg|jpeg|webp|vtex_c)$/, "");
}
function rounded(ctx, b, r) {
  ctx.beginPath();
  ctx.roundRect(
    ...b,
    Math.max(0, Math.min(Number(r) || 0, b[2] / 2, b[3] / 2)),
  );
}
export function drawPart(ctx, n, assets, wire = false) {
  if (!n.supported || !n.bounds) return;
  const a = n.args,
    b = n.bounds,
    m = n.method;
  ctx.save();
  if (n.clip) {
    ctx.beginPath();
    ctx.rect(...n.clip);
    ctx.clip();
  }
  ctx.globalAlpha = Math.max(0, Math.min(1, n.alpha));
  ctx.strokeStyle = colorCSS(n.color);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 1;
  if (wire) {
    ctx.strokeStyle = "#668398";
    ctx.strokeRect(...b);
    ctx.restore();
    return;
  }
  if (m === "FilledRect" || m === "Rect") {
    rounded(ctx, b, a[3]);
    if (m === "FilledRect") ctx.fill();
    else {
      ctx.lineWidth = Number(a[5]) || 1;
      ctx.stroke();
    }
  } else if (m === "Text") {
    const size = Math.max(1, Math.min(600, a[1]));
    ctx.font = `${size}px Arial, sans-serif`;
    ctx.textBaseline = "top";
    String(a[2])
      .split("\n")
      .forEach((line, i) => ctx.fillText(line, b[0], b[1] + i * size * 1.2));
  } else if (m === "Image" || m === "ImageCentered") {
    const image = assets.get(String(a[0])) || assets.get(assetKey(a[0]));
    rounded(ctx, b, a[4]);
    ctx.clip();
    if (image) {
      ctx.globalAlpha *= n.color ? n.color.a / 255 : 1;
      ctx.drawImage(image, ...b);
    } else {
      ctx.fillStyle = "#20303e";
      ctx.fillRect(...b);
      ctx.strokeStyle = "#476078";
      ctx.strokeRect(...b);
      ctx.beginPath();
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] + b[2], b[1] + b[3]);
      ctx.moveTo(b[0] + b[2], b[1]);
      ctx.lineTo(b[0], b[1] + b[3]);
      ctx.stroke();
      if (b[2] > 65) {
        ctx.fillStyle = "#bdcbd9";
        ctx.font = "12px sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(
          typeof a[0] === "string" ? assetKey(a[0]) : "image " + a[0],
          b[0] + 5,
          b[1] + b[3] / 2,
          Math.max(1, b[2] - 10),
        );
      }
    }
  } else if (m === "Line") {
    ctx.lineWidth = Number(a[3]) || 1;
    ctx.beginPath();
    ctx.moveTo(a[0].x, a[0].y);
    ctx.lineTo(a[1].x, a[1].y);
    ctx.stroke();
  } else if (
    [
      "Circle",
      "FilledCircle",
      "CircleGradient",
      "ShadowCircle",
      "ShadowNGon",
      "DonutChart",
      "Logo",
    ].includes(m)
  ) {
    const start =
        ((m === "Circle"
          ? Number(a[4]) || 0
          : m === "FilledCircle"
            ? Number(a[3]) || 0
            : 0) *
          Math.PI) /
        180,
      pct =
        m === "Circle" ? (a[5] ?? 1) : m === "FilledCircle" ? (a[4] ?? 1) : 1;
    ctx.lineWidth = m === "Circle" ? Number(a[3]) || 1 : 1;
    ctx.beginPath();
    ctx.arc(a[0].x, a[0].y, a[1], start, start + Math.PI * 2 * pct);
    if (m === "FilledCircle") ctx.fill();
    else ctx.stroke();
  } else if (m === "Gradient" || m === "OutlineGradient") {
    const g = ctx.createLinearGradient(b[0], b[1], b[0] + b[2], b[1] + b[3]);
    g.addColorStop(0, colorCSS(a[2]));
    g.addColorStop(1, colorCSS(a[5]));
    ctx.fillStyle = g;
    ctx.strokeStyle = g;
    rounded(ctx, b, a[6]);
    if (m === "Gradient") ctx.fill();
    else ctx.stroke();
  } else if (m === "Shadow") {
    ctx.shadowColor = colorCSS(n.color);
    ctx.shadowBlur = Math.min(100, Number(a[3]) || 10);
    ctx.strokeStyle = colorCSS(n.color);
    rounded(ctx, b, a[4]);
    ctx.stroke();
  } else if (m === "Blur") {
    ctx.fillStyle = "rgba(95,118,135,.18)";
    rounded(ctx, b, n.library === "LIB_RENDER" ? a[3] : a[4]);
    ctx.fill();
  } else if (m === "RoundedProgressRect") {
    rounded(ctx, b, a[4]);
    ctx.stroke();
    ctx.fillRect(b[0], b[1], b[2] * Math.max(0, Math.min(1, a[3])), b[3]);
  } else {
    const pts = tableArray(a[0]).filter(vec);
    if (pts.length) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (m === "FilledTriangle" || m === "TexturedPoly") {
        ctx.closePath();
        ctx.fill();
      } else ctx.stroke();
    }
  }
  ctx.restore();
}
export function renderScene(
  ctx,
  {
    frame,
    screen,
    width,
    height,
    selected,
    hover,
    assets,
    wire = false,
    hidden = new Set(),
    cutoff = Infinity,
    drag,
  },
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.scale(width / screen.width, height / screen.height);
  for (const n of frame.parts)
    if (n.call.id <= cutoff && !hidden.has(n.call.id))
      drawPart(ctx, n, assets, wire);
  for (const id of selected) {
    const b = frame.byId.get(id)?.effective;
    if (!b) continue;
    ctx.strokeStyle = "#61ecd3";
    ctx.lineWidth = (2 * screen.width) / width;
    ctx.strokeRect(...b);
    ctx.fillStyle = "rgba(72,225,190,.07)";
    ctx.fillRect(...b);
  }
  if (hover != null && !selected.has(hover)) {
    const b = frame.byId.get(hover)?.effective;
    if (b) {
      ctx.strokeStyle = "#e4c16d";
      ctx.lineWidth = (1.5 * screen.width) / width;
      ctx.strokeRect(...b);
    }
  }
  if (drag) {
    ctx.fillStyle = "rgba(63,198,220,.13)";
    ctx.strokeStyle = "#5ed0e0";
    ctx.lineWidth = screen.width / width;
    ctx.fillRect(...drag);
    ctx.strokeRect(...drag);
  }
}

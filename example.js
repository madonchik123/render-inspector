// Synthetic example: no user capture, game assets, names, or local paths.
export function exampleCapture() {
  const calls = [],
    sources = [
      "example.lua:12: in function drawPanel",
      "example.lua:25: in function drawContents",
    ],
    p = (x, y) => ({ kind: "Vec2", x, y }),
    c = (r, g, b, a = 255) => ({ kind: "Color", r, g, b, a });
  let id = 0;
  const add = (frame, method, args, parentId, library = "Render") => {
    calls.push({
      id: ++id,
      frame,
      method,
      args,
      parentId,
      library,
      source: parentId ? 2 : 1,
      completed: true,
      results: [],
    });
    return id;
  };
  for (let frame = 1; frame <= 12; frame++) {
    const parent = add(frame, "DrawPanel", [], null, "Example");
    add(
      frame,
      "Shadow",
      [p(550, 265), p(1110, 655), c(0, 0, 0, 190), 25, 14],
      parent,
    );
    add(
      frame,
      "FilledRect",
      [p(550, 265), p(1110, 655), c(23, 34, 48), 14],
      parent,
    );
    add(
      frame,
      "Rect",
      [p(550, 265), p(1110, 655), c(72, 97, 116), 14, 0, 1],
      parent,
    );
    add(
      frame,
      "Text",
      [3, 25, "Match overview", p(580, 294), c(231, 240, 248)],
      parent,
    );
    add(
      frame,
      "Text",
      [
        3,
        15,
        "Synthetic example · drag to select a group",
        p(580, 332),
        c(143, 165, 185),
      ],
      parent,
    );
    add(frame, "PushClip", [p(570, 370), p(1090, 633), true], parent);
    for (let i = 0; i < 3; i++) {
      const y = 375 + i * 65;
      add(
        frame,
        "FilledRect",
        [p(580, y), p(1078, y + 51), c(33, 49, 65), 7],
        parent,
      );
      add(
        frame,
        "Text",
        [
          3,
          16,
          ["Health", "Mana", "Experience"][i],
          p(595, y + 15),
          c(199, 220, 231),
        ],
        parent,
      );
      add(
        frame,
        "FilledRect",
        [p(760, y + 19), p(1048, y + 31), c(15, 25, 36), 5],
        parent,
      );
      add(
        frame,
        "FilledRect",
        [
          p(760, y + 19),
          p(760 + (i === 0 ? 125 + frame * 8 : i === 1 ? 205 : 80), y + 31),
          [c(118, 219, 177), c(88, 158, 233), c(236, 194, 112)][i],
          5,
        ],
        parent,
      );
    }
    add(frame, "PopClip", [], parent);
  }
  return {
    version: 2,
    label: "Synthetic example",
    screen: { width: 1600, height: 900 },
    firstFrame: 1,
    lastFrame: 12,
    calls,
    sources,
    resources: {
      font: {
        library: "Render",
        method: "LoadFont",
        result: 3,
        args: ["Arial", 0, 500],
      },
    },
    dropped: 0,
    hooks: [],
    coverage:
      "This is a generated example for learning the viewer. No real game data.",
    discovery: { scannedTables: 0, limited: false },
  };
}

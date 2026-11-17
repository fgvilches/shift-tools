/** Drawing tools available on the floor-plan canvas. */
export type MapTool = "select" | "line" | "rect" | "circle" | "text" | "point";

export const TOOL_SHORTCUTS: Record<MapTool, string> = {
  select: "V",
  line: "L",
  rect: "R",
  circle: "C",
  text: "T",
  point: "P",
};

export const TOOL_LABELS: Record<MapTool, string> = {
  select: "Select / pan",
  line: "Line",
  rect: "Rectangle",
  circle: "Circle",
  text: "Text label",
  point: "Measurement point",
};

export const TOOL_ORDER: MapTool[] = ["select", "line", "rect", "circle", "text", "point"];

/** Keyboard key (lowercase) → tool. */
export const TOOL_BY_KEY: Record<string, MapTool> = {
  v: "select",
  l: "line",
  r: "rect",
  c: "circle",
  t: "text",
  p: "point",
};

const MARGIN = 16;
const MIN_WIDTH = 420;
const MIN_HEIGHT = 360;
const HEADING_HEIGHT = 42;
const RESIZE_STEP = 16;
const DEFAULT_SIZE = { width: 780, height: 560 };

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
function limits(viewport) {
  const margin = Math.min(MARGIN, viewport.width / 4, viewport.height / 4);
  const width = viewport.width - margin * 2, height = viewport.height - margin * 2;
  return { margin, width, height, minWidth: Math.min(MIN_WIDTH, width), minHeight: Math.min(MIN_HEIGHT, height) };
}

export function fitRect(rect, viewport) {
  const limit = limits(viewport);
  const width = clamp(rect.width, limit.minWidth, limit.width), height = clamp(rect.height, limit.minHeight, limit.height);
  return { x: clamp(rect.x, limit.margin, viewport.width - limit.margin - width), y: clamp(rect.y, limit.margin, viewport.height - limit.margin - height), width, height };
}

export function centerRect(viewport, size = DEFAULT_SIZE) {
  const rect = fitRect({ ...size, x: 0, y: 0 }, viewport);
  return { ...rect, x: (viewport.width - rect.width) / 2, y: (viewport.height - rect.height) / 2 };
}

export function moveRect(rect, delta, viewport) {
  return fitRect({ ...rect, x: rect.x + delta.x, y: rect.y + delta.y }, viewport);
}

export function resizeRect(rect, delta, edge, viewport) {
  const limit = limits(viewport);
  let left = rect.x, top = rect.y, right = left + rect.width, bottom = top + rect.height;
  if (edge.includes('w')) left = clamp(left + delta.x, limit.margin, right - limit.minWidth);
  if (edge.includes('e')) right = clamp(right + delta.x, left + limit.minWidth, viewport.width - limit.margin);
  if (edge.includes('n')) top = clamp(top + delta.y, limit.margin, bottom - limit.minHeight);
  if (edge.includes('s')) bottom = clamp(bottom + delta.y, top + limit.minHeight, viewport.height - limit.margin);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

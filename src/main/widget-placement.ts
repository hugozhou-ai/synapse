interface DisplayLike { readonly id: number; readonly workArea: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }; }
interface WindowSize { readonly width: number; readonly height: number; }

export function resolveWidgetPlacement(
  displays: readonly DisplayLike[],
  primaryDisplayId: number,
  savedDisplayId: string | null,
  positions: Readonly<Record<string, { x: number; y: number }>>,
  size: WindowSize,
): { displayId: string; x: number; y: number } {
  const display = displays.find((candidate) => String(candidate.id) === savedDisplayId)
    ?? displays.find((candidate) => candidate.id === primaryDisplayId)
    ?? displays[0];
  if (!display) return { displayId: String(primaryDisplayId), x: 16, y: 16 };
  const key = String(display.id); const saved = positions[key]; const bounds = display.workArea;
  const maxX = Math.max(bounds.x, bounds.x + bounds.width - size.width);
  const maxY = Math.max(bounds.y, bounds.y + bounds.height - size.height);
  return {
    displayId: key,
    x: Math.min(maxX, Math.max(bounds.x, saved?.x ?? maxX)),
    y: Math.min(maxY, Math.max(bounds.y, saved?.y ?? bounds.y + 16)),
  };
}

export function resolveAnchoredWidgetBounds(
  workArea: DisplayLike["workArea"],
  anchor: { readonly right: number; readonly y: number },
  size: WindowSize,
): { x: number; y: number; width: number; height: number } {
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - size.width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - size.height);
  return {
    x: Math.min(maxX, Math.max(workArea.x, anchor.right - size.width)),
    y: Math.min(maxY, Math.max(workArea.y, anchor.y)),
    width: size.width,
    height: size.height,
  };
}

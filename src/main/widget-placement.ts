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
  const defaultX = bounds.x + bounds.width - size.width - 16;
  const maxX = Math.max(bounds.x, bounds.x + bounds.width - size.width);
  const maxY = Math.max(bounds.y, bounds.y + bounds.height - size.height);
  return {
    displayId: key,
    x: Math.min(maxX, Math.max(bounds.x, saved?.x ?? defaultX)),
    y: Math.min(maxY, Math.max(bounds.y, saved?.y ?? bounds.y + 16)),
  };
}

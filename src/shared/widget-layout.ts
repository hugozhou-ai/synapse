export type WidgetMode = "collapsed" | "activity" | "expanded";
export interface WidgetBounds { readonly width: number; readonly height: number; }

export const WIDGET_COLLAPSED_SIZE = 40;
export const WIDGET_EXPANDED_WIDTH = 304;
export const WIDGET_MAX_HEIGHT = 600;

const ACTIVITY_HEADER_HEIGHT = 56;
const EXPANDED_HEADER_HEIGHT = 88;
const BODY_BORDER_HEIGHT = 1;
const SESSION_ROW_HEIGHT = 74;
const EMPTY_STATE_HEIGHT = 92;
const HISTORY_ROW_HEIGHT = 42;

export function resolveWidgetBounds(mode: WidgetMode, sessionCount: number): WidgetBounds {
  if (mode === "collapsed") return { width: WIDGET_COLLAPSED_SIZE, height: WIDGET_COLLAPSED_SIZE };
  if (mode === "activity") return { width: WIDGET_EXPANDED_WIDTH, height: ACTIVITY_HEADER_HEIGHT + BODY_BORDER_HEIGHT + SESSION_ROW_HEIGHT };
  const queueHeight = sessionCount === 0 ? EMPTY_STATE_HEIGHT : Math.min(sessionCount, 3) * SESSION_ROW_HEIGHT;
  return { width: WIDGET_EXPANDED_WIDTH, height: EXPANDED_HEADER_HEIGHT + BODY_BORDER_HEIGHT + queueHeight + HISTORY_ROW_HEIGHT };
}

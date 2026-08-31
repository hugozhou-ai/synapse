import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Check } from "lucide-react";
import type { TurnSelectionView } from "@application/contracts";
import { statusLabel } from "../../lib/format";

export function applyTurnSelection(
  turns: readonly TurnSelectionView[],
  selected: ReadonlySet<string>,
  index: number,
  anchor: number | null,
  shift: boolean,
): Set<string> {
  const turn = turns[index]; const next = new Set(selected);
  if (!turn) return next;
  const value = !selected.has(turn.id);
  const start = shift && anchor !== null ? Math.min(anchor, index) : index;
  const end = shift && anchor !== null ? Math.max(anchor, index) : index;
  for (let current = start; current <= end; current += 1) {
    const id = turns[current]?.id;
    if (!id) continue;
    if (value) next.add(id); else next.delete(id);
  }
  return next;
}

export function TurnSelector({ turns, selected, onChange }: { turns: readonly TurnSelectionView[]; selected: ReadonlySet<string>; onChange(value: Set<string>): void }) {
  const anchor = useRef<number | null>(null);
  const drag = useRef<{ active: boolean; value: boolean; timer: number | null }>({ active: false, value: true, timer: null });
  const suppressClick = useRef(false);
  useEffect(() => {
    const onUp = () => { if (drag.current.timer) window.clearTimeout(drag.current.timer); drag.current = { active: false, value: true, timer: null }; };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, []);
  const click = (index: number, shift: boolean) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onChange(applyTurnSelection(turns, selected, index, anchor.current, shift));
    anchor.current = index;
  };
  const pointerDown = (event: ReactPointerEvent, turn: TurnSelectionView) => {
    if (event.button !== 0) return;
    const value = !selected.has(turn.id);
    drag.current.timer = window.setTimeout(() => { drag.current = { active: true, value, timer: null }; suppressClick.current = true; const next = new Set(selected); if (value) next.add(turn.id); else next.delete(turn.id); onChange(next); }, 350);
  };
  const pointerEnter = (turn: TurnSelectionView) => {
    if (!drag.current.active) return;
    const next = new Set(selected); if (drag.current.value) next.add(turn.id); else next.delete(turn.id); onChange(next);
  };

  return <>
    <div className="turn-list" aria-label="可总结的 turns">{turns.map((turn, index) => <button type="button" key={turn.id} role="checkbox" aria-checked={selected.has(turn.id)} className={`turn-row ${selected.has(turn.id) ? "selected" : ""}`} onClick={(event) => click(index, event.shiftKey)} onPointerDown={(event) => pointerDown(event, turn)} onPointerEnter={() => pointerEnter(turn)}>
      <span aria-hidden="true" className={`checkbox ${selected.has(turn.id) ? "checked" : ""}`}>{selected.has(turn.id) && <Check size={13} />}</span>
      <span className="turn-index">{String(index + 1).padStart(2, "0")}</span><span className="turn-copy"><strong>{turn.promptPreview || "无 prompt 预览"}</strong><span className="turn-assistant">{turn.assistantPreview || "暂无 assistant 回复预览"}</span><span>{new Date(turn.startedAt).toLocaleString()} · {statusLabel(turn.status)}</span></span>
    </button>)}</div>
    <div className="gesture-tip">单击或按空格选择；Shift 连续选择。按住约 350ms 后拖过多行可作为快捷操作。</div>
  </>;
}

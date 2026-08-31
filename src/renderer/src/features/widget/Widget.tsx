import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUpRight, BookOpen, Check, ChevronUp, LoaderCircle, Settings } from "lucide-react";
import type { WidgetSessionView } from "@application/contracts";
import { resolveWidgetBounds, type WidgetMode } from "@shared/widget-layout";
import { EmptyState } from "../../components/common";
import { SynapseLogo } from "../../components/SynapseLogo";
import { useHookInstallation } from "../../hooks/use-hook-installation";
import { useSessionQueue } from "../../hooks/use-session-queue";
import { formatDuration, messageOf, shortPath } from "../../lib/format";
import { findLatestSessionStatusChange, snapshotSessionStatuses, type SessionStatusSnapshot } from "./widget-activity";

const ACTIVITY_VISIBLE_MS = 3_000;
const LOGO_DRAG_THRESHOLD = 4;
interface LogoDragState { readonly pointerId: number; readonly startX: number; readonly startY: number; moved: boolean; }

export function Widget() {
  const { sessions, loaded, reload } = useSessionQueue();
  const { status: hooks } = useHookInstallation();
  const [mode, setMode] = useState<WidgetMode>("collapsed");
  const [activitySessionId, setActivitySessionId] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState<ReadonlySet<string>>(new Set());
  const [summaryErrors, setSummaryErrors] = useState<Readonly<Record<string, string>>>({});
  const requests = useRef(new Set<string>());
  const previousStatuses = useRef<SessionStatusSnapshot | null>(null);
  const activityTimer = useRef<number | null>(null);
  const logoDrag = useRef<LogoDragState | null>(null);
  const suppressLogoClick = useRef(false);
  const running = sessions.filter((session) => session.status === "running").length;
  const ready = sessions.filter((session) => session.status === "ready").length;
  const hooksReady = hooks?.installed === true && hooks.trusted;
  const activitySession = activitySessionId === null ? null : sessions.find((session) => session.id === activitySessionId) ?? null;
  const clearActivityTimer = () => {
    if (activityTimer.current === null) return;
    window.clearTimeout(activityTimer.current);
    activityTimer.current = null;
  };
  const collapse = () => { clearActivityTimer(); setActivitySessionId(null); setMode("collapsed"); };
  const toggleFromLogo = () => {
    if (suppressLogoClick.current) { suppressLogoClick.current = false; return; }
    clearActivityTimer();
    setActivitySessionId(null);
    setMode((current) => current === "expanded" ? "collapsed" : "expanded");
  };

  useEffect(() => {
    void window.synapse.window.resizeWidget(resolveWidgetBounds(mode, sessions.length));
  }, [mode, sessions.length]);
  useEffect(() => {
    if (!loaded) return;
    const currentStatuses = snapshotSessionStatuses(sessions);
    const previous = previousStatuses.current;
    previousStatuses.current = currentStatuses;
    if (previous === null) return;
    const changed = findLatestSessionStatusChange(previous, sessions);
    if (!changed || mode === "expanded") return;
    clearActivityTimer();
    setActivitySessionId(changed.id);
    setMode("activity");
    activityTimer.current = window.setTimeout(() => {
      activityTimer.current = null;
      setActivitySessionId(null);
      setMode("collapsed");
    }, ACTIVITY_VISIBLE_MS);
  }, [loaded, mode, sessions]);
  useEffect(() => () => clearActivityTimer(), []);
  useEffect(() => window.synapse.window.onWidgetBlur(() => { if (mode === "expanded") collapse(); }), [mode]);
  useEffect(() => {
    if (mode === "activity" && loaded && activitySession === null) collapse();
  }, [activitySession, loaded, mode]);
  const beginLogoDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (mode !== "collapsed" || event.button !== 0) return;
    if (typeof event.currentTarget.setPointerCapture === "function") event.currentTarget.setPointerCapture(event.pointerId);
    logoDrag.current = { pointerId: event.pointerId, startX: event.screenX, startY: event.screenY, moved: false };
    void window.synapse.window.beginWidgetDrag({ x: event.screenX, y: event.screenY });
  };
  const moveLogoDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = logoDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) < LOGO_DRAG_THRESHOLD) return;
    drag.moved = true;
    void window.synapse.window.moveWidgetDrag({ x: event.screenX, y: event.screenY });
  };
  const endLogoDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = logoDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressLogoClick.current = drag.moved;
    logoDrag.current = null;
    if (typeof event.currentTarget.releasePointerCapture === "function" && (typeof event.currentTarget.hasPointerCapture !== "function" || event.currentTarget.hasPointerCapture(event.pointerId))) event.currentTarget.releasePointerCapture(event.pointerId);
    void window.synapse.window.endWidgetDrag();
  };
  const summarize = async (sessionId: string) => {
    if (requests.current.has(sessionId)) return;
    requests.current.add(sessionId);
    setSummarizing((current) => new Set(current).add(sessionId));
    setSummaryErrors((current) => { const next = { ...current }; delete next[sessionId]; return next; });
    try { await window.synapse.summaries.generateDefault(sessionId); reload(); }
    catch (error) { setSummaryErrors((current) => ({ ...current, [sessionId]: messageOf(error) })); }
    finally {
      requests.current.delete(sessionId);
      setSummarizing((current) => { const next = new Set(current); next.delete(sessionId); return next; });
    }
  };
  return <main className={`widget-shell ${mode}`}>
    <div className="widget-top drag-region">
      <button className="synapse-mark no-drag" aria-label={mode === "expanded" ? "收起悬浮窗" : "展开悬浮窗"} onClick={toggleFromLogo} onPointerDown={beginLogoDrag} onPointerMove={moveLogoDrag} onPointerUp={endLogoDrag} onPointerCancel={endLogoDrag}><SynapseLogo decorative /></button>
      {mode === "expanded" && <div className="widget-counters no-drag">
        <span className="counter running"><span className="live-dot" />{running} 进行中</span>
        {hooks && !hooksReady
          ? <button className="counter warning" onClick={() => window.synapse.window.openSettings()}>{hooks.installed ? "Hook 待信任" : "Hook 未安装"}</button>
          : <span className="counter ready">{ready} 待整理</span>}
        <button className="icon-button" onClick={() => window.synapse.window.openSettings()} aria-label="打开设置"><Settings size={15} /></button>
        <button className="icon-button" onClick={collapse} aria-label="收起"><ChevronUp size={16} /></button>
      </div>}
    </div>
    {mode === "activity" && activitySession && <div className="widget-body no-drag"><SessionMiniCard session={activitySession} summarizing={summarizing.has(activitySession.id)} error={summaryErrors[activitySession.id] ?? null} onSummarize={summarize} /></div>}
    {mode === "expanded" && <div className="widget-body no-drag">
      {sessions.slice(0, 3).map((session) => <SessionMiniCard key={session.id} session={session} summarizing={summarizing.has(session.id)} error={summaryErrors[session.id] ?? null} onSummarize={summarize} />)}
      {sessions.length === 0 && <EmptyState compact><span>{hooks === null ? "正在检测 Codex Hook 状态" : hooksReady ? "等待新的 Codex 任务" : "需要先安装并信任 Codex Hook"}</span>{hooks !== null && !hooksReady && <button className="secondary tiny" onClick={() => window.synapse.window.openSettings()}>检查 Hook 设置</button>}</EmptyState>}
      <button className="widget-history" onClick={() => window.synapse.window.openHistory()}><BookOpen size={14} /> 打开历史</button>
    </div>}
  </main>;
}

function SessionMiniCard({ session, summarizing, error, onSummarize }: { session: WidgetSessionView; summarizing: boolean; error: string | null; onSummarize(id: string): Promise<void> }) {
  return <article className="mini-card">
    <div className={`status-orb ${session.status}`}>{session.status === "running" ? <LoaderCircle size={14} /> : <Check size={14} />}</div>
    <div className="mini-main"><strong>{session.title}</strong><span>{shortPath(session.cwd)} · {formatDuration(session.elapsedSeconds)}</span></div>
    {session.status === "ready" && <div className="mini-actions">
      <button className={`primary tiny mini-summary ${error ? "failed" : ""}`} disabled={summarizing} aria-label={summarizing ? "正在总结" : "总结"} title={error ?? undefined} onClick={() => void onSummarize(session.id)}>{summarizing ? <LoaderCircle className="spin" size={14} /> : "总结"}</button>
      {session.summaryDocumentId && <button className="mini-result-link" aria-label="打开整理结果" title="打开整理结果" onClick={() => window.synapse.window.openSummaryResult(session.summaryDocumentId!)}><ArrowUpRight size={15} /></button>}
    </div>}
  </article>;
}

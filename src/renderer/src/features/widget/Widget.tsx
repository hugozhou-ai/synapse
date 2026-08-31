import { useRef, useState } from "react";
import { ArrowUpRight, BookOpen, Check, ChevronDown, ChevronUp, LoaderCircle, Settings, Sparkles } from "lucide-react";
import type { WidgetSessionView } from "@application/contracts";
import { EmptyState } from "../../components/common";
import { useHookInstallation } from "../../hooks/use-hook-installation";
import { useSessionQueue } from "../../hooks/use-session-queue";
import { formatDuration, messageOf, shortPath } from "../../lib/format";

export function Widget() {
  const { sessions, reload } = useSessionQueue();
  const { status: hooks } = useHookInstallation();
  const [expanded, setExpanded] = useState(false);
  const [summarizing, setSummarizing] = useState<ReadonlySet<string>>(new Set());
  const [summaryErrors, setSummaryErrors] = useState<Readonly<Record<string, string>>>({});
  const requests = useRef(new Set<string>());
  const running = sessions.filter((session) => session.status === "running").length;
  const ready = sessions.filter((session) => session.status === "ready").length;
  const hooksReady = hooks?.installed === true && hooks.trusted;
  const toggle = () => { const next = !expanded; setExpanded(next); void window.synapse.window.resizeWidget(next); };
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
  return <main className={`widget-shell ${expanded ? "expanded" : ""}`}>
    <div className="widget-top drag-region">
      <div className="synapse-mark"><Sparkles size={15} /><span>Synapse</span></div>
      <div className="widget-counters no-drag">
        <span className="counter running"><span className="live-dot" />{running} 进行中</span>
        {hooks && !hooksReady
          ? <button className="counter warning" onClick={() => window.synapse.window.openSettings()}>{hooks.installed ? "Hook 待信任" : "Hook 未安装"}</button>
          : <span className="counter ready">{ready} 待整理</span>}
        <button className="icon-button" onClick={() => window.synapse.window.openSettings()} aria-label="打开设置"><Settings size={15} /></button>
        <button className="icon-button" onClick={toggle} aria-label={expanded ? "收起" : "展开"}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      </div>
    </div>
    {expanded && <div className="widget-body no-drag">
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

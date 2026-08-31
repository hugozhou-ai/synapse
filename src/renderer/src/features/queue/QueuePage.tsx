import { Archive, Clock3, Code2, RefreshCw, Sparkles } from "lucide-react";
import { EmptyState, PageHeader } from "../../components/common";
import { useHookInstallation } from "../../hooks/use-hook-installation";
import { useSessionQueue } from "../../hooks/use-session-queue";
import { formatDuration, shortPath, statusLabel } from "../../lib/format";

export function QueuePage({ onSummarize, onOpenSettings }: { onSummarize(id: string): void; onOpenSettings(): void }) {
  const { sessions, reload } = useSessionQueue();
  const { status: hooks } = useHookInstallation();
  return <div className="page">
    <PageHeader eyebrow="LIVE QUEUE" title="任务队列" description="正在进行与刚结束的 Codex 任务。完成的任务会留在这里，直到你总结或忽略。" actions={<button className="secondary" onClick={reload}><RefreshCw size={15} /> 刷新</button>} />
    <div className="metric-row"><Metric label="正在进行" value={sessions.filter((session) => session.status === "running").length} tone="ink" /><Metric label="待总结" value={sessions.filter((session) => session.status === "ready").length} tone="orange" /><Metric label="已观察" value={sessions.length} tone="sage" /></div>
    <div className="queue-list">
      {sessions.map((session) => <article className="queue-card" key={session.id}>
        <div className={`queue-status ${session.status}`}><span className="live-dot" /><span>{statusLabel(session.status)}</span></div>
        <div className="queue-copy"><h3>{session.title}</h3><p>{session.promptPreview || "等待 prompt 内容…"}</p><div className="meta"><span><Code2 size={13} />{shortPath(session.cwd)}</span><span><Clock3 size={13} />{formatDuration(session.elapsedSeconds)}</span></div></div>
        <div className="queue-actions">{session.status === "ready" && <button className="primary" onClick={() => onSummarize(session.id)}><Sparkles size={15} /> 总结</button>}<button className="ghost" onClick={() => window.synapse.sessions.ignore(session.id)}>{session.status === "running" ? "隐藏" : "忽略"}</button></div>
      </article>)}
      {sessions.length === 0 && <EmptyState><Archive size={25} /><span>{hooks?.installed ? "Hook 已安装；请确认已在 Codex /hooks 中信任，然后开始一个新任务或提交新的 prompt。" : "尚未收到 Codex Hook 事件。首次使用需要先安装并信任 Hook。"}</span><button className="primary" onClick={onOpenSettings}>{hooks?.installed ? "检查 Hook" : "打开设置"}</button></EmptyState>}
    </div>
  </div>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`metric ${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}

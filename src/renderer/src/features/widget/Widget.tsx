import { useState } from "react";
import { BookOpen, Check, ChevronDown, ChevronUp, LoaderCircle, Settings, Sparkles } from "lucide-react";
import type { WidgetSessionView } from "@application/contracts";
import { EmptyState } from "../../components/common";
import { useHookInstallation } from "../../hooks/use-hook-installation";
import { useSessionQueue } from "../../hooks/use-session-queue";
import { formatDuration, shortPath } from "../../lib/format";

export function Widget() {
  const { sessions } = useSessionQueue();
  const { status: hooks } = useHookInstallation();
  const [expanded, setExpanded] = useState(false);
  const running = sessions.filter((session) => session.status === "running").length;
  const ready = sessions.filter((session) => session.status === "ready").length;
  const hooksReady = hooks?.installed === true && hooks.trusted;
  const toggle = () => { const next = !expanded; setExpanded(next); void window.synapse.window.resizeWidget(next); };
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
      {sessions.slice(0, 3).map((session) => <SessionMiniCard key={session.id} session={session} />)}
      {sessions.length === 0 && <EmptyState compact><span>{hooks === null ? "正在检测 Codex Hook 状态" : hooksReady ? "等待新的 Codex 任务" : "需要先安装并信任 Codex Hook"}</span>{hooks !== null && !hooksReady && <button className="secondary tiny" onClick={() => window.synapse.window.openSettings()}>检查 Hook 设置</button>}</EmptyState>}
      <button className="widget-history" onClick={() => window.synapse.window.openHistory()}><BookOpen size={14} /> 打开历史</button>
    </div>}
  </main>;
}

function SessionMiniCard({ session }: { session: WidgetSessionView }) {
  return <article className="mini-card">
    <div className={`status-orb ${session.status}`}>{session.status === "running" ? <LoaderCircle size={14} /> : <Check size={14} />}</div>
    <div className="mini-main"><strong>{session.title}</strong><span>{shortPath(session.cwd)} · {formatDuration(session.elapsedSeconds)}</span></div>
    {session.status === "ready" && <button className="primary tiny" onClick={() => window.synapse.window.openSummary(session.id)}>总结</button>}
  </article>;
}

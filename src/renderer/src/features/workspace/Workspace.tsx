import { useEffect, useState, type ReactNode } from "react";
import { Archive, History, Settings, Sparkles } from "lucide-react";
import { HistoryPage } from "../history/HistoryPage";
import { QueuePage } from "../queue/QueuePage";
import { SettingsPage } from "../settings/SettingsPage";
import { SummaryComposer } from "../summary/SummaryComposer";

type WorkspaceRoute = "history" | "queue" | "settings" | `summary/${string}`;

export function Workspace() {
  const [route, setRoute] = useState<WorkspaceRoute>("queue");
  useEffect(() => window.synapse.window.onNavigate((path) => setRoute(path as WorkspaceRoute)), []);
  const sessionId = route.startsWith("summary/") ? route.slice(8) : null;
  return <div className="workspace-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Sparkles size={17} /></div><div><strong>Synapse</strong><span>Codex memory</span></div></div>
      <nav aria-label="主导航">
        <NavButton active={route === "queue" || Boolean(sessionId)} icon={<Archive size={17} />} label="任务队列" onClick={() => setRoute("queue")} />
        <NavButton active={route === "history"} icon={<History size={17} />} label="总结历史" onClick={() => setRoute("history")} />
        <NavButton active={route === "settings"} icon={<Settings size={17} />} label="设置" onClick={() => setRoute("settings")} />
      </nav>
      <div className="sidebar-foot"><span className="live-dot" /> 本地运行 · 数据不离开设备</div>
    </aside>
    <section className="content-shell">
      {sessionId ? <SummaryComposer sessionId={sessionId} onClose={() => setRoute("queue")} /> : route === "queue" ? <QueuePage onSummarize={(id) => setRoute(`summary/${id}`)} /> : route === "history" ? <HistoryPage /> : <SettingsPage />}
    </section>
  </div>;
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick(): void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick}>{icon}<span>{label}</span></button>;
}

import { useEffect, useState, type ReactNode } from "react";
import { Archive, History, Settings, Sparkles } from "lucide-react";
import { HistoryPage } from "../history/HistoryPage";
import { QueuePage } from "../queue/QueuePage";
import { SettingsPage } from "../settings/SettingsPage";
import { SummaryComposer } from "../summary/SummaryComposer";
import { historyWorkspaceDocumentId, parseWorkspaceRoute, summaryWorkspaceRoute, type WorkspaceRoute } from "./workspace-route";

export function Workspace() {
  const [route, setRoute] = useState<WorkspaceRoute>(() => parseWorkspaceRoute(location.hash));
  useEffect(() => window.synapse.window.onNavigate((path) => setRoute(parseWorkspaceRoute(path))), []);
  const summaryRoute = summaryWorkspaceRoute(route);
  const historyDocumentId = historyWorkspaceDocumentId(route);
  return <div className="workspace-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Sparkles size={17} /></div><div><strong>Synapse</strong><span>Local / Codex memory</span></div></div>
      <nav aria-label="主导航">
        <NavButton index="01" active={route === "queue" || Boolean(summaryRoute)} icon={<Archive size={17} />} label="任务队列" onClick={() => setRoute("queue")} />
        <NavButton index="02" active={route === "history" || historyDocumentId !== null} icon={<History size={17} />} label="总结历史" onClick={() => setRoute("history")} />
        <NavButton index="03" active={route === "settings"} icon={<Settings size={17} />} label="设置" onClick={() => setRoute("settings")} />
      </nav>
      <div className="sidebar-foot"><span className="live-dot" /><span>LOCAL PROCESS<br />DATA STAYS HERE</span></div>
    </aside>
    <section className="content-shell">
      {summaryRoute ? <SummaryComposer key={route} sessionId={summaryRoute.sessionId} onClose={() => setRoute("queue")} /> : route === "queue" ? <QueuePage onSummarize={(id) => setRoute(`summary/${id}`)} onOpenSettings={() => setRoute("settings")} /> : route === "history" || historyDocumentId !== null ? <HistoryPage documentId={historyDocumentId} /> : <SettingsPage />}
    </section>
  </div>;
}

function NavButton({ index, active, icon, label, onClick }: { index: string; active: boolean; icon: ReactNode; label: string; onClick(): void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick}><small>{index}</small>{icon}<span>{label}</span></button>;
}

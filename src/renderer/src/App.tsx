import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import ReactMarkdown from "react-markdown";
import { Archive, BookOpen, Check, ChevronDown, ChevronUp, CircleAlert, Clock3, Code2, Database, FileDown, History, LoaderCircle, NotebookPen, Plus, RefreshCw, Search, Settings, Sparkles, Trash2, X } from "lucide-react";
import type { ApplicationSettings, AppServerRuntimeStatus, HookInstallationStatus, SummarySearchItem } from "@application/ports";
import type { SummaryContent } from "@domain/summary";
import type { SummaryDetailView, SummaryDraft, SummaryProfileView, TurnSelectionView, WidgetSessionView } from "@application/contracts";

export function App() {
  return location.hash.startsWith("#/widget") ? <Widget /> : <Workspace />;
}

function useSessionQueue() {
  const [sessions, setSessions] = useState<readonly WidgetSessionView[]>([]);
  const reload = useCallback(() => { void window.synapse.sessions.listWidgetQueue().then(setSessions).catch(() => undefined); }, []);
  useEffect(() => { reload(); const unsubscribe = window.synapse.window.onSessionsChanged(reload); const timer = setInterval(reload, 5_000); return () => { unsubscribe(); clearInterval(timer); }; }, [reload]);
  return { sessions, reload };
}

function Widget() {
  const { sessions } = useSessionQueue();
  const [expanded, setExpanded] = useState(false);
  const running = sessions.filter((session) => session.status === "running").length;
  const ready = sessions.filter((session) => session.status === "ready").length;
  const toggle = () => { const next = !expanded; setExpanded(next); void window.synapse.window.resizeWidget(next); };
  return <main className={`widget-shell ${expanded ? "expanded" : ""}`}>
    <div className="widget-top drag-region">
      <div className="synapse-mark"><Sparkles size={15} /><span>Synapse</span></div>
      <div className="widget-counters no-drag">
        <span className="counter running"><span className="live-dot" />{running} 进行中</span>
        <span className="counter ready">{ready} 待整理</span>
        <button className="icon-button" onClick={toggle} aria-label={expanded ? "收起" : "展开"}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      </div>
    </div>
    {expanded && <div className="widget-body no-drag">
      {sessions.slice(0, 3).map((session) => <SessionMiniCard key={session.id} session={session} />)}
      {sessions.length === 0 && <EmptyState compact>还没有感知到 Codex 任务</EmptyState>}
      {sessions.length > 3 && <button className="more-row" onClick={() => window.synapse.window.openHistory()}>+{sessions.length - 3} 个任务 · 查看全部</button>}
      <button className="widget-history" onClick={() => window.synapse.window.openHistory()}><BookOpen size={14} /> 打开历史</button>
    </div>}
  </main>;
}

function SessionMiniCard({ session }: { session: WidgetSessionView }) {
  const ready = session.status === "ready";
  return <article className="mini-card">
    <div className={`status-orb ${session.status}`}>{session.status === "running" ? <LoaderCircle size={14} /> : <Check size={14} />}</div>
    <div className="mini-main"><strong>{session.title}</strong><span>{shortPath(session.cwd)} · {formatDuration(session.elapsedSeconds)}</span></div>
    {ready && <button className="primary tiny" onClick={() => window.synapse.window.openSummary(session.id)}>总结</button>}
  </article>;
}

type WorkspaceRoute = "history" | "queue" | "settings" | `summary/${string}`;

function Workspace() {
  const [route, setRoute] = useState<WorkspaceRoute>("queue");
  useEffect(() => window.synapse.window.onNavigate((path) => setRoute(path as WorkspaceRoute)), []);
  const sessionId = route.startsWith("summary/") ? route.slice(8) : null;
  return <div className="workspace-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Sparkles size={17} /></div><div><strong>Synapse</strong><span>Codex memory</span></div></div>
      <nav>
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

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick(): void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions && <div className="header-actions">{actions}</div>}</header>;
}

function QueuePage({ onSummarize }: { onSummarize(id: string): void }) {
  const { sessions, reload } = useSessionQueue();
  return <div className="page"><PageHeader eyebrow="LIVE QUEUE" title="任务队列" description="正在进行与刚结束的 Codex 任务。完成的任务会留在这里，直到你总结或忽略。" actions={<button className="secondary" onClick={reload}><RefreshCw size={15} /> 刷新</button>} />
    <div className="metric-row"><Metric label="正在进行" value={sessions.filter((s) => s.status === "running").length} tone="ink" /><Metric label="待总结" value={sessions.filter((s) => s.status === "ready").length} tone="orange" /><Metric label="已观察" value={sessions.length} tone="sage" /></div>
    <div className="queue-list">
      {sessions.map((session) => <article className="queue-card" key={session.id}>
        <div className={`queue-status ${session.status}`}><span className="live-dot" /><span>{statusLabel(session.status)}</span></div>
        <div className="queue-copy"><h3>{session.title}</h3><p>{session.promptPreview || "等待 prompt 内容…"}</p><div className="meta"><span><Code2 size={13} />{shortPath(session.cwd)}</span><span><Clock3 size={13} />{formatDuration(session.elapsedSeconds)}</span></div></div>
        <div className="queue-actions">{session.status === "ready" && <button className="primary" onClick={() => onSummarize(session.id)}><Sparkles size={15} /> 总结</button>}<button className="ghost" onClick={() => window.synapse.sessions.ignore(session.id)}>{session.status === "running" ? "隐藏" : "忽略"}</button></div>
      </article>)}
      {sessions.length === 0 && <EmptyState><Archive size={25} />等待 Codex Hook 事件。你可以先到设置页安装 Hook。</EmptyState>}
    </div>
  </div>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className={`metric ${tone}`}><strong>{value}</strong><span>{label}</span></div>; }

function SummaryComposer({ sessionId, onClose }: { sessionId: string; onClose(): void }) {
  const [turns, setTurns] = useState<readonly TurnSelectionView[]>([]);
  const [profiles, setProfiles] = useState<readonly SummaryProfileView[]>([]);
  const [settings, setSettings] = useState<ApplicationSettings | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profileId, setProfileId] = useState("");
  const [syncNotes, setSyncNotes] = useState(false);
  const [notesAccount, setNotesAccount] = useState("");
  const [notesFolder, setNotesFolder] = useState("Synapse");
  const [draft, setDraft] = useState<SummaryDraft | null>(null);
  const [content, setContent] = useState<SummaryContent | null>(null);
  const [preview, setPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState(false);
  const lastIndex = useRef<number | null>(null);
  const drag = useRef<{ active: boolean; value: boolean; timer: number | null }>({ active: false, value: true, timer: null });
  const suppressClick = useRef(false);
  const editRevision = useRef(0);
  const pendingSave = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => { void Promise.all([window.synapse.sessions.turns(sessionId), window.synapse.profiles.list(), window.synapse.settings.read()]).then(([nextTurns, nextProfiles, nextSettings]) => {
    setTurns(nextTurns); setProfiles(nextProfiles); setSettings(nextSettings);
    setSelected(new Set(nextTurns.filter((turn) => turn.selectedByDefault).map((turn) => turn.id)));
    setProfileId(nextProfiles.find((profile) => profile.isDefault)?.id ?? nextProfiles[0]?.id ?? "");
    setSyncNotes(nextSettings.syncNotesByDefault);
    setNotesAccount(nextSettings.notesAccount ?? ""); setNotesFolder(nextSettings.notesFolder);
  }).catch((reason) => setError(messageOf(reason))); }, [sessionId]);

  useEffect(() => {
    const onUp = () => { if (drag.current.timer) window.clearTimeout(drag.current.timer); drag.current = { active: false, value: true, timer: null }; };
    window.addEventListener("pointerup", onUp); return () => window.removeEventListener("pointerup", onUp);
  }, []);

  const applySelection = (id: string, value: boolean) => setSelected((current) => { const next = new Set(current); if (value) next.add(id); else next.delete(id); return next; });
  const clickTurn = (index: number, shift: boolean) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    const turn = turns[index]; if (!turn) return;
    if (shift && lastIndex.current !== null) {
      const start = Math.min(lastIndex.current, index); const end = Math.max(lastIndex.current, index); const value = !selected.has(turn.id);
      setSelected((current) => { const next = new Set(current); for (let i = start; i <= end; i += 1) { const id = turns[i]!.id; if (value) next.add(id); else next.delete(id); } return next; });
    } else applySelection(turn.id, !selected.has(turn.id));
    lastIndex.current = index;
  };
  const pointerDown = (event: ReactPointerEvent, turn: TurnSelectionView) => {
    if (event.button !== 0) return; const value = !selected.has(turn.id);
    drag.current.timer = window.setTimeout(() => { drag.current = { active: true, value, timer: null }; suppressClick.current = true; applySelection(turn.id, value); }, 350);
  };
  const pointerEnter = (turn: TurnSelectionView) => { if (drag.current.active) applySelection(turn.id, drag.current.value); };

  const generate = async () => {
    const stopTurnId = [...turns].reverse().find((turn) => turn.status !== "running")?.id;
    if (!stopTurnId || !profileId || selected.size === 0 || !settings) return;
    setBusy(true); setError(null);
    try {
      const result = await window.synapse.summaries.generate({
        sessionId, selectedTurnIds: [...selected], profileId, stopTurnId, model: settings.summaryModel,
        syncToNotes: syncNotes, publicationTarget: syncNotes ? { account: notesAccount || null, folder: notesFolder } : null,
      });
      setDraft(result); setContent(result.content);
    } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  };

  const saveDraft = async () => {
    if (!draft || !content) return; setBusy(true);
    editRevision.current += 1; setDirty(false);
    try { const next = await window.synapse.summaries.updateDraft({ documentId: draft.documentId, content }); setDraft(next); }
    catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  };
  const finalize = async () => {
    if (!draft || !content) return; setBusy(true); setError(null);
    editRevision.current += 1; setDirty(false);
    try { await pendingSave.current; await window.synapse.summaries.finalize({ documentId: draft.documentId, content, syncToNotes: syncNotes }); setFinalized(true); }
    catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!dirty || !draft || !content || finalized) return;
    const revision = editRevision.current;
    const snapshot = content;
    const timer = window.setTimeout(() => {
      setAutoSaving(true);
      const operation = window.synapse.summaries.updateDraft({ documentId: draft.documentId, content: snapshot })
        .then((next) => { setDraft(next); if (editRevision.current === revision) setDirty(false); })
        .catch((reason) => setError(messageOf(reason)))
        .finally(() => setAutoSaving(false));
      pendingSave.current = operation;
    }, 800);
    return () => window.clearTimeout(timer);
  }, [content, dirty, draft, finalized]);

  const editContent = (next: SummaryContent) => { editRevision.current += 1; setContent(next); setDirty(true); };

  return <div className="page composer-page"><PageHeader eyebrow="SUMMARY HARNESS" title="整理会话" description="选择事实来源与整理方案。生成结果先保存为草稿，确认后才会成为不可变 final。" actions={<button className="ghost" onClick={onClose}><X size={16} />关闭</button>} />
    {error && <ErrorBanner message={error} />}
    {!draft ? <div className="composer-grid">
      <section className="panel turns-panel"><div className="panel-head"><div><h2>选择 turns</h2><p>默认选中已完成 turn；失败或中断的 turn 需手动纳入。</p></div><div className="selection-actions"><button onClick={() => setSelected(new Set(turns.filter((turn) => turn.status !== "running").map((turn) => turn.id)))}>全选</button><button onClick={() => setSelected(new Set())}>取消</button></div></div>
        <div className="turn-list">{turns.map((turn, index) => <div key={turn.id} className={`turn-row ${selected.has(turn.id) ? "selected" : ""}`} onClick={(event) => clickTurn(index, event.shiftKey)} onPointerDown={(event) => pointerDown(event, turn)} onPointerEnter={() => pointerEnter(turn)}>
          <span className={`checkbox ${selected.has(turn.id) ? "checked" : ""}`}>{selected.has(turn.id) && <Check size={13} />}</span>
          <div className="turn-index">{String(index + 1).padStart(2, "0")}</div><div className="turn-copy"><strong>{turn.promptPreview || "无 prompt 预览"}</strong><p>{turn.assistantPreview || "暂无 assistant 回复预览"}</p><span>{new Date(turn.startedAt).toLocaleString()} · {statusLabel(turn.status)}</span></div>
        </div>)}</div><div className="gesture-tip">提示：Shift 单击连续选择；按住约 350ms 后拖过多行可快速框选。</div>
      </section>
      <aside className="panel generation-panel"><h2>整理设置</h2><label>命名方案<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label>
        <div className="profile-preview"><span>{profiles.find((profile) => profile.id === profileId)?.kind === "template" ? "Markdown 模板" : "系统提示词"}</span><p>{profiles.find((profile) => profile.id === profileId)?.instructions.slice(0, 240)}</p></div>
        <label className="toggle-row"><input type="checkbox" checked={syncNotes} onChange={(event) => setSyncNotes(event.target.checked)} /><span className="toggle" /><div><strong>同步到 Apple Notes</strong><small>{settings?.notesFolder ?? "Synapse"} · 仅 final 后执行</small></div></label>
        {syncNotes && <div className="notes-target"><label>账户（留空使用默认）<input value={notesAccount} onChange={(event) => setNotesAccount(event.target.value)} /></label><label>文件夹<input value={notesFolder} onChange={(event) => setNotesFolder(event.target.value)} /></label></div>}
        <div className="source-count"><strong>{selected.size}</strong><span>个 turns 将作为事实来源</span></div>
        <button className="primary wide" disabled={busy || selected.size === 0 || !profileId || (syncNotes && !notesFolder.trim())} onClick={generate}>{busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}生成草稿</button>
      </aside>
    </div> : <section className="draft-workspace">
      <div className="draft-toolbar"><div><span className={`version-pill ${finalized ? "final" : ""}`}>{finalized ? "FINAL" : "DRAFT"}</span><span>版本 {draft.versionId.slice(0, 8)}</span>{autoSaving && <span>自动保存中…</span>}{!autoSaving && !finalized && !dirty && <span>已自动保存</span>}</div><div><button className="secondary" disabled={busy || finalized} onClick={saveDraft}>保存草稿</button><button className="primary" disabled={busy || finalized || autoSaving} onClick={finalize}>{finalized ? <><Check size={15} />已完成</> : <><NotebookPen size={15} />完成并归档</>}</button></div></div>
      <div className="editor-tabs"><button className={!preview ? "active" : ""} onClick={() => setPreview(false)}>编辑</button><button className={preview ? "active" : ""} onClick={() => setPreview(true)}>预览</button></div>
      {content && (preview ? <article className="markdown-preview"><h1>{content.title}</h1><p className="abstract">{content.abstract}</p><div className="tag-row">{content.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><ReactMarkdown>{content.bodyMarkdown}</ReactMarkdown></article> : <div className="editor-form"><label>标题<input value={content.title} onChange={(event) => editContent({ ...content, title: event.target.value })} /></label><label>摘要<textarea rows={3} value={content.abstract} onChange={(event) => editContent({ ...content, abstract: event.target.value })} /></label><label>标签<input value={content.tags.join(", ")} onChange={(event) => editContent({ ...content, tags: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label><label>Markdown 正文<textarea className="markdown-editor" value={content.bodyMarkdown} onChange={(event) => editContent({ ...content, bodyMarkdown: event.target.value })} /></label></div>)}
    </section>}
  </div>;
}

function HistoryPage() {
  const [query, setQuery] = useState(""); const [items, setItems] = useState<readonly SummarySearchItem[]>([]); const [selected, setSelected] = useState<SummaryDetailView | null>(null); const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<readonly SummaryProfileView[]>([]); const [projects, setProjects] = useState<string[]>([]);
  const [filters, setFilters] = useState({ cwd: "", profileId: "", status: "", from: "", to: "" });
  useEffect(() => { void window.synapse.profiles.list().then(setProfiles); }, []);
  const search = useCallback(() => { void window.synapse.summaries.search({ ...(query.trim() ? { text: query.trim() } : {}), ...(filters.cwd ? { cwd: filters.cwd } : {}), ...(filters.profileId ? { profileId: filters.profileId } : {}), ...(filters.status ? { status: filters.status } : {}), ...(filters.from ? { from: new Date(`${filters.from}T00:00:00`).toISOString() } : {}), ...(filters.to ? { to: new Date(`${filters.to}T23:59:59`).toISOString() } : {}), limit: 100, offset: 0 }).then((result) => { setItems(result.items); setProjects((current) => [...new Set([...current, ...result.items.map((item) => item.cwd)])].sort()); }).catch((reason) => setError(messageOf(reason))); }, [query, filters]);
  useEffect(() => { const timer = setTimeout(search, 200); return () => clearTimeout(timer); }, [search]);
  const open = (id: string) => void window.synapse.summaries.get(id).then(setSelected).catch((reason) => setError(messageOf(reason)));
  return <div className="page"><PageHeader eyebrow="LOCAL ARCHIVE" title="总结历史" description="全文搜索标题、摘要、正文、标签与工作目录。SQLite 是完整版本历史的唯一主存储。" actions={<button className="secondary" onClick={() => window.synapse.export.revealDatabase()}><Database size={15} />数据库目录</button>} />
    {error && <ErrorBanner message={error} />}
    <div className="search-box"><Search size={17} /><input placeholder="搜索总结、标签或项目路径…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <div className="filter-bar"><select value={filters.cwd} onChange={(event) => setFilters({ ...filters, cwd: event.target.value })}><option value="">所有项目</option>{projects.map((project) => <option key={project} value={project}>{shortPath(project)}</option>)}</select><select value={filters.profileId} onChange={(event) => setFilters({ ...filters, profileId: event.target.value })}><option value="">所有方案</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">所有状态</option><option value="final">Final</option><option value="agent-draft">Agent draft</option><option value="edited-draft">Edited draft</option></select><input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} aria-label="开始日期" /><input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} aria-label="结束日期" /></div>
    <div className="history-layout"><div className="history-list">{items.map((item) => <button className={`history-card ${selected?.id === item.documentId ? "active" : ""}`} key={item.documentId} onClick={() => open(item.documentId)}><span>{item.versionKind}</span><h3>{item.title}</h3><p>{item.abstract}</p><div>{item.tags.slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}<time>{new Date(item.updatedAt).toLocaleDateString()}</time></div></button>)}{items.length === 0 && <EmptyState><Search size={24} />没有匹配的总结</EmptyState>}</div>
      <div className="history-detail">{selected?.currentVersion ? <HistoryDetail detail={selected} onChanged={() => open(selected.id)} onError={setError} /> : <EmptyState>选择一条总结查看详情</EmptyState>}</div>
    </div>
  </div>;
}

function HistoryDetail({ detail, onChanged, onError }: { detail: SummaryDetailView; onChanged(): void; onError(message: string): void }) {
  const [editing, setEditing] = useState(false); const [content, setContent] = useState(detail.currentVersion!.content); const [busy, setBusy] = useState(false);
  useEffect(() => { setContent(detail.currentVersion!.content); setEditing(false); }, [detail.id, detail.currentVersion?.id]);
  const act = async (operation: () => Promise<unknown>) => { setBusy(true); try { await operation(); onChanged(); } catch (reason) { onError(messageOf(reason)); } finally { setBusy(false); } };
  const regenerate = () => act(async () => {
    const [turns, settings] = await Promise.all([window.synapse.sessions.turns(detail.sessionId), window.synapse.settings.read()]);
    const stopTurnId = [...turns].reverse().find((turn) => turn.status !== "running")?.id;
    if (!stopTurnId) throw new Error("找不到可重新生成的已完成 turn。");
    await window.synapse.summaries.regenerate({ documentId: detail.id, selectedTurnIds: detail.selectedTurnIds, profileId: detail.profileId, stopTurnId, model: settings.summaryModel });
  });
  const save = () => act(() => window.synapse.summaries.updateDraft({ documentId: detail.id, content }));
  const finalize = () => act(() => window.synapse.summaries.finalize({ documentId: detail.id, content, syncToNotes: detail.publicationStatus !== "not-requested" }));
  return <><div className="detail-actions"><button disabled={busy} onClick={() => setEditing((value) => !value)}><NotebookPen size={14} />{editing ? "预览" : "编辑"}</button><button disabled={busy} onClick={regenerate}><RefreshCw size={14} />重新生成</button><button onClick={() => window.synapse.export.markdown(detail.id)}><FileDown size={14} />MD</button><button onClick={() => window.synapse.export.json(detail.id)}><FileDown size={14} />JSON</button>{detail.publicationStatus === "failed" && <button onClick={() => window.synapse.summaries.retryNotes(detail.id)}><RefreshCw size={14} />重试 Notes</button>}</div>
    {editing ? <div className="editor-form history-editor"><label>标题<input value={content.title} onChange={(event) => setContent({ ...content, title: event.target.value })} /></label><label>摘要<textarea rows={3} value={content.abstract} onChange={(event) => setContent({ ...content, abstract: event.target.value })} /></label><label>正文<textarea className="markdown-editor" value={content.bodyMarkdown} onChange={(event) => setContent({ ...content, bodyMarkdown: event.target.value })} /></label><div className="row-actions"><button className="secondary" disabled={busy} onClick={save}>保存新草稿</button><button className="primary" disabled={busy} onClick={finalize}>确认新 final</button></div></div> : <article className="markdown-preview"><span className="version-pill">{detail.currentVersion!.kind}</span><h1>{detail.currentVersion!.content.title}</h1><p className="abstract">{detail.currentVersion!.content.abstract}</p><ReactMarkdown>{detail.currentVersion!.content.bodyMarkdown}</ReactMarkdown></article>}
    <div className="version-history"><strong>版本历史</strong>{detail.versions.map((version) => <span key={version.id}>{version.kind} · {new Date(version.createdAt).toLocaleString()}</span>)}</div></>;
}

function SettingsPage() {
  const [settings, setSettings] = useState<ApplicationSettings | null>(null); const [hooks, setHooks] = useState<HookInstallationStatus | null>(null); const [profiles, setProfiles] = useState<readonly SummaryProfileView[]>([]); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  const [runtime, setRuntime] = useState<AppServerRuntimeStatus | null>(null);
  const [editing, setEditing] = useState<SummaryProfileView | null>(null);
  const reload = () => void Promise.all([window.synapse.settings.read(), window.synapse.settings.runtime(), window.synapse.hooks.inspect(), window.synapse.profiles.list()]).then(([s, r, h, p]) => { setSettings(s); setRuntime(r); setHooks(h); setProfiles(p); }).catch((reason) => setError(messageOf(reason)));
  useEffect(reload, []);
  const save = async () => { if (!settings) return; setSaving(true); try { setSettings(await window.synapse.settings.update(settings)); } catch (reason) { setError(messageOf(reason)); } finally { setSaving(false); } };
  const hookAction = async (install: boolean) => { setSaving(true); try { setHooks(install ? await window.synapse.hooks.install() : await window.synapse.hooks.uninstall()); } catch (reason) { setError(messageOf(reason)); } finally { setSaving(false); } };
  const saveProfile = async () => { if (!editing) return; try { await window.synapse.profiles.save(editing); setEditing(null); reload(); } catch (reason) { setError(messageOf(reason)); } };
  const deleteProfile = async () => { if (!editing?.id || editing.id === "builtin-task-retrospective") return; try { await window.synapse.profiles.delete(editing.id); setEditing(null); reload(); } catch (reason) { setError(messageOf(reason)); } };
  return <div className="page settings-page"><PageHeader eyebrow="CONFIGURATION" title="设置" description="外部系统均通过基础设施适配器连接；修改 Codex binary 后请重启 Synapse 以重新握手。" actions={<button className="primary" disabled={saving} onClick={save}>保存设置</button>} />
    {error && <ErrorBanner message={error} />}
    <section className="settings-section"><div className="settings-title"><div className="setting-icon"><Code2 size={18} /></div><div><h2>Codex App Server</h2><p>只用于读取 turns 与按需运行总结 agent。</p></div><span className={`health ${runtime?.available ? "good" : "warn"}`}>{runtime?.available ? "已连接" : "不可用"}</span></div><div className="runtime-grid"><span><small>实际 binary</small><code>{runtime?.binaryPath ?? "—"}</code></span><span><small>版本</small><code>{runtime?.version ?? "—"}</code></span><span><small>认证</small><code>{runtime?.authentication ?? "unknown"}</code></span></div>{runtime?.error && <ErrorBanner message={runtime.error} />}<div className="settings-fields"><label>Codex binary 路径<input value={settings?.codexBinaryPath ?? ""} placeholder="自动发现" onChange={(event) => settings && setSettings({ ...settings, codexBinaryPath: event.target.value || null })} /></label><label>总结模型<input value={settings?.summaryModel ?? ""} placeholder="使用 Codex 默认模型" onChange={(event) => settings && setSettings({ ...settings, summaryModel: event.target.value || null })} /></label></div></section>
    <section className="settings-section"><div className="settings-title"><div className="setting-icon orange"><Sparkles size={18} /></div><div><h2>Codex Hook</h2><p>SessionStart、UserPromptSubmit 与 Stop；安装操作会备份并原子合并现有配置。</p></div><span className={`health ${hooks?.installed ? "good" : "warn"}`}>{hooks?.installed ? "已安装" : "未安装"}</span></div><div className="hook-paths"><code>{hooks?.relayPath}</code><code>{hooks?.configPath}</code></div>{hooks?.message && <ErrorBanner message={hooks.message} />}{hooks && hooks.trustStates.length > 0 && <div className="trust-list">{hooks.trustStates.map((state) => <span key={state.cwd}><code>{shortPath(state.cwd)}</code><em className={state.status}>{state.status}</em></span>)}</div>}<div className="row-actions">{hooks?.installed ? <button className="danger" onClick={() => hookAction(false)}><Trash2 size={14} />卸载自有 Hook</button> : <button className="primary" onClick={() => hookAction(true)}><Plus size={14} />安装 Hook</button>}</div></section>
    <section className="settings-section"><div className="settings-title"><div className="setting-icon sage"><NotebookPen size={18} /></div><div><h2>Apple Notes</h2><p>仅在 final 版本提交后同步，同一文档持续更新同一便签。</p></div></div><label className="toggle-row"><input type="checkbox" checked={settings?.syncNotesByDefault ?? false} onChange={(event) => settings && setSettings({ ...settings, syncNotesByDefault: event.target.checked })} /><span className="toggle" /><div><strong>默认同步到便签</strong><small>总结面板仍可单次覆盖</small></div></label><div className="settings-fields"><label>账户（留空使用默认）<input value={settings?.notesAccount ?? ""} onChange={(event) => settings && setSettings({ ...settings, notesAccount: event.target.value || null })} /></label><label>文件夹<input value={settings?.notesFolder ?? "Synapse"} onChange={(event) => settings && setSettings({ ...settings, notesFolder: event.target.value })} /></label></div></section>
    <section className="settings-section"><div className="settings-title"><div className="setting-icon ink"><BookOpen size={18} /></div><div><h2>整理方案</h2><p>模板型保持 Markdown 骨架，系统提示词型提供完整规则。</p></div><button className="secondary push" onClick={() => setEditing({ id: "", name: "", kind: "template", instructions: "", isDefault: false })}><Plus size={14} />新建</button></div><div className="profile-list">{profiles.map((profile) => <button key={profile.id} onClick={() => setEditing(profile)}><div><strong>{profile.name}</strong><span>{profile.kind === "template" ? "Markdown 模板" : "系统提示词"}</span></div>{profile.isDefault && <em>默认</em>}</button>)}</div></section>
    {editing && <div className="modal-backdrop"><div className="profile-modal"><div className="panel-head"><h2>{editing.id ? "编辑整理方案" : "新建整理方案"}</h2><button className="icon-button" onClick={() => setEditing(null)}><X size={17} /></button></div><label>名称<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label>类型<select value={editing.kind} onChange={(event) => setEditing({ ...editing, kind: event.target.value as SummaryProfileView["kind"] })}><option value="template">Markdown 模板</option><option value="systemPrompt">系统提示词</option></select></label><label>内容<textarea className="profile-editor" value={editing.instructions} onChange={(event) => setEditing({ ...editing, instructions: event.target.value })} /></label><label className="check-line"><input type="checkbox" checked={editing.isDefault} onChange={(event) => setEditing({ ...editing, isDefault: event.target.checked })} />设为默认</label><div className="modal-actions">{editing.id && editing.id !== "builtin-task-retrospective" && <button className="danger" onClick={deleteProfile}><Trash2 size={14} />删除</button>}<button className="primary" onClick={saveProfile}>保存方案</button></div></div></div>}
  </div>;
}

function ErrorBanner({ message }: { message: string }) { return <div className="error-banner"><CircleAlert size={16} /><span>{message}</span></div>; }
function EmptyState({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) { return <div className={`empty-state ${compact ? "compact" : ""}`}>{children}</div>; }
function statusLabel(status: string): string { return ({ observed: "已观察", running: "进行中", ready: "待总结", summarized: "已总结", ignored: "已忽略", completed: "已完成", failed: "失败", interrupted: "已中断" } as Record<string, string>)[status] ?? status; }
function formatDuration(seconds: number): string { if (seconds < 60) return `${seconds}s`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`; }
function shortPath(path: string): string { const parts = path.split("/").filter(Boolean); return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path || "未知目录"; }
function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }

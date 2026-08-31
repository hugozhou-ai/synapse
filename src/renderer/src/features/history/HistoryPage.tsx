import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Database, FileDown, NotebookPen, RefreshCw, Search, Trash2 } from "lucide-react";
import type { SummarySearchItem } from "@application/ports";
import type { SummaryDetailView, SummaryProfileView } from "@application/contracts";
import { DatePicker } from "../../components/DatePicker";
import { EmptyState, ErrorBanner, PageHeader } from "../../components/common";
import { Select } from "../../components/Select";
import { messageOf, shortPath } from "../../lib/format";

export function HistoryPage({ documentId }: { documentId?: string | null }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<readonly SummarySearchItem[]>([]);
  const [selected, setSelected] = useState<SummaryDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<readonly SummaryProfileView[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [filters, setFilters] = useState({ cwd: "", profileId: "", status: "", from: "", to: "" });

  useEffect(() => { void window.synapse.profiles.list().then(setProfiles); }, []);
  const search = useCallback(() => {
    void window.synapse.summaries.search({
      ...(query.trim() ? { text: query.trim() } : {}),
      ...(filters.cwd ? { cwd: filters.cwd } : {}),
      ...(filters.profileId ? { profileId: filters.profileId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from ? { from: new Date(`${filters.from}T00:00:00`).toISOString() } : {}),
      ...(filters.to ? { to: new Date(`${filters.to}T23:59:59`).toISOString() } : {}),
      limit: 100, offset: 0,
    }).then((result) => {
      setItems(result.items);
      setProjects((current) => [...new Set([...current, ...result.items.map((item) => item.cwd)])].sort());
    }).catch((reason) => setError(messageOf(reason)));
  }, [query, filters]);
  useEffect(() => { const timer = window.setTimeout(search, 200); return () => window.clearTimeout(timer); }, [search]);
  const open = useCallback((id: string) => { void window.synapse.summaries.get(id).then(setSelected).catch((reason) => setError(messageOf(reason))); }, []);
  useEffect(() => { if (documentId) open(documentId); }, [documentId, open]);
  const deleted = useCallback(() => { setSelected(null); search(); }, [search]);

  return <div className="page">
    <PageHeader eyebrow="LOCAL ARCHIVE" title="总结历史" description="全文搜索标题、摘要、正文、标签与工作目录。SQLite 是完整版本历史的唯一主存储。" actions={<button className="secondary" onClick={() => window.synapse.export.revealDatabase()}><Database size={15} />数据库目录</button>} />
    {error && <ErrorBanner message={error} />}
    <div className="search-box"><Search size={17} /><input aria-label="搜索总结" placeholder="搜索总结、标签或项目路径…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <div className="filter-bar">
      <div className="compact-filter"><span>项目</span><Select ariaLabel="项目" value={filters.cwd} onChange={(cwd) => setFilters({ ...filters, cwd })} options={[{ value: "", label: "所有项目" }, ...projects.map((project) => ({ value: project, label: shortPath(project) }))]} /></div>
      <div className="compact-filter"><span>整理方案</span><Select ariaLabel="整理方案" value={filters.profileId} onChange={(profileId) => setFilters({ ...filters, profileId })} options={[{ value: "", label: "所有方案" }, ...profiles.map((profile) => ({ value: profile.id, label: profile.name }))]} /></div>
      <div className="compact-filter"><span>版本状态</span><Select ariaLabel="版本状态" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} options={[{ value: "", label: "所有状态" }, { value: "final", label: "Final" }, { value: "agent-draft", label: "Agent draft" }, { value: "edited-draft", label: "Edited draft" }]} /></div>
      <div className="compact-filter"><span>开始日期</span><DatePicker ariaLabel="开始日期" value={filters.from} onChange={(from) => setFilters({ ...filters, from })} /></div>
      <div className="compact-filter"><span>结束日期</span><DatePicker ariaLabel="结束日期" value={filters.to} onChange={(to) => setFilters({ ...filters, to })} /></div>
    </div>
    <div className="history-layout"><div className="history-list">{items.map((item) => <button className={`history-card ${selected?.id === item.documentId ? "active" : ""}`} key={item.documentId} onClick={() => open(item.documentId)}><span>{item.versionKind}</span><h3>{item.title}</h3><p>{item.abstract}</p><div>{item.tags.slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}<time>{new Date(item.updatedAt).toLocaleDateString()}</time></div></button>)}{items.length === 0 && <EmptyState><Search size={24} />没有匹配的总结</EmptyState>}</div>
      <div className="history-detail">{selected?.currentVersion ? <HistoryDetail detail={selected} onChanged={() => open(selected.id)} onDeleted={deleted} onError={setError} /> : <EmptyState>选择一条总结查看详情</EmptyState>}</div>
    </div>
  </div>;
}

function HistoryDetail({ detail, onChanged, onDeleted, onError }: { detail: SummaryDetailView; onChanged(): void; onDeleted(): void; onError(message: string): void }) {
  const current = detail.currentVersion!;
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(current.content);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => { setContent(current.content); setEditing(false); setConfirmingDelete(false); }, [detail.id, current.id]);
  const act = async (operation: () => Promise<unknown>) => { setBusy(true); try { await operation(); onChanged(); } catch (reason) { onError(messageOf(reason)); } finally { setBusy(false); } };
  const regenerate = () => act(async () => {
    const settings = await window.synapse.settings.read();
    await window.synapse.summaries.regenerate({ documentId: detail.id, selectedTurnIds: detail.selectedTurnIds, profileId: detail.profileId, model: settings.summaryModel });
  });
  const save = () => act(() => window.synapse.summaries.updateDraft({ documentId: detail.id, content }));
  const finalize = () => act(() => window.synapse.summaries.finalize({ documentId: detail.id, content, syncToNotes: detail.publicationStatus !== "not-requested" }));
  const deleteSummary = async () => {
    if (!confirmingDelete) { setConfirmingDelete(true); return; }
    setBusy(true);
    try { await window.synapse.summaries.delete(detail.id); onDeleted(); }
    catch (reason) { onError(messageOf(reason)); }
    finally { setBusy(false); }
  };
  return <>
    <div className="detail-actions"><button disabled={busy} onClick={() => { setConfirmingDelete(false); setEditing((value) => !value); }}><NotebookPen size={14} />{editing ? "预览" : "编辑"}</button><button disabled={busy} onClick={() => { setConfirmingDelete(false); void regenerate(); }}><RefreshCw size={14} />重新生成</button><button disabled={busy} onClick={() => { setConfirmingDelete(false); void window.synapse.export.markdown(detail.id); }}><FileDown size={14} />MD</button><button disabled={busy} onClick={() => { setConfirmingDelete(false); void window.synapse.export.json(detail.id); }}><FileDown size={14} />JSON</button>{detail.publicationStatus === "failed" && <button disabled={busy} onClick={() => { setConfirmingDelete(false); void window.synapse.summaries.retryNotes(detail.id); }}><RefreshCw size={14} />重试 Notes</button>}<button className={`delete-summary-action ${confirmingDelete ? "confirming" : ""}`} disabled={busy} title={confirmingDelete ? "永久删除本地总结；不会删除已同步的 Apple Notes 内容" : "删除总结"} onClick={() => void deleteSummary()}><Trash2 size={14} />{confirmingDelete ? "确认删除" : "删除"}</button></div>
    {editing ? <div className="editor-form history-editor"><label>标题<input value={content.title} onChange={(event) => setContent({ ...content, title: event.target.value })} /></label><label>摘要<textarea rows={3} value={content.abstract} onChange={(event) => setContent({ ...content, abstract: event.target.value })} /></label><label>标签<input value={content.tags.join(", ")} onChange={(event) => setContent({ ...content, tags: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label><label>正文<textarea className="markdown-editor" value={content.bodyMarkdown} onChange={(event) => setContent({ ...content, bodyMarkdown: event.target.value })} /></label><div className="row-actions"><button className="secondary" disabled={busy} onClick={save}>保存新草稿</button><button className="primary" disabled={busy} onClick={finalize}>确认新 final</button></div></div> : <article className="markdown-preview"><span className="version-pill">{current.kind}</span><h1>{current.content.title}</h1><p className="abstract">{current.content.abstract}</p><div className="tag-row">{current.content.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><ReactMarkdown>{current.content.bodyMarkdown}</ReactMarkdown></article>}
    <div className="version-history"><strong>版本历史</strong>{detail.versions.map((version) => <span key={version.id}>{version.kind} · {new Date(version.createdAt).toLocaleString()}</span>)}</div>
  </>;
}

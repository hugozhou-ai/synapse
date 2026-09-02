import { useCallback, useEffect, useState, type DragEvent } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowUpRight, Check, Copy, Database, FileDown, GitCompareArrows, MessageSquareText, NotebookPen, RefreshCw, Search, Trash2, X } from "lucide-react";
import type { SummarySearchItem } from "@application/ports";
import type { SummaryDetailView, SummaryProfileView, SummaryVersionOperationView, SummaryVersionSourceView, SummaryVersionView } from "@application/contracts";
import { DatePicker } from "../../components/DatePicker";
import { EmptyState, ErrorBanner, PageHeader } from "../../components/common";
import { Select } from "../../components/Select";
import { messageOf, shortPath } from "../../lib/format";
import { contributionVersions, diffSummaryContent, emptySummaryContent, type DiffPart } from "./summary-diff";

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
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [baseId, setBaseId] = useState<string>(current.parentVersionId ?? "empty");
  const [targetId, setTargetId] = useState(current.id);
  const [sourceVersion, setSourceVersion] = useState<SummaryVersionView | null>(null);
  const [source, setSource] = useState<SummaryVersionSourceView | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  useEffect(() => {
    setContent(current.content); setEditing(false); setCopied(false); setConfirmingDelete(false);
    setBaseId(current.parentVersionId ?? "empty"); setTargetId(current.id); setSourceVersion(null); setSource(null);
  }, [detail.id, current.id]);
  const act = async (operation: () => Promise<unknown>) => { setBusy(true); try { await operation(); onChanged(); } catch (reason) { onError(messageOf(reason)); } finally { setBusy(false); } };
  const regenerate = () => act(async () => {
    const settings = await window.synapse.settings.read();
    await window.synapse.summaries.regenerate({ documentId: detail.id, model: settings.summaryModel });
  });
  const save = () => act(() => window.synapse.summaries.updateDraft({ documentId: detail.id, expectedVersionId: current.id, content }));
  const finalize = () => act(() => window.synapse.summaries.finalize({ documentId: detail.id, expectedVersionId: current.id, content }));
  const copyReference = async () => {
    setBusy(true);
    try { await window.synapse.summaries.copyReference(detail.id, current.id); setCopied(true); }
    catch (reason) { onError(messageOf(reason)); }
    finally { setBusy(false); }
  };
  const dragReference = (event: DragEvent<HTMLButtonElement>) => {
    if (!detail.reference) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", detail.reference.text);
  };
  const deleteSummary = async () => {
    if (!confirmingDelete) { setConfirmingDelete(true); return; }
    setBusy(true);
    try { await window.synapse.summaries.delete(detail.id); onDeleted(); }
    catch (reason) { onError(messageOf(reason)); }
    finally { setBusy(false); }
  };
  const versions = [...detail.versions].sort((left, right) => left.sequence - right.sequence);
  const versionById = (id: string) => versions.find((version) => version.id === id) ?? null;
  const base = baseId === "empty" ? null : versionById(baseId);
  const target = versionById(targetId) ?? current;
  const selectBase = (id: string) => {
    const next = id === "empty" ? null : versionById(id);
    if (next?.id === target.id) return;
    if (next && next.sequence >= target.sequence) { setBaseId(target.id); setTargetId(next.id); return; }
    setBaseId(id);
  };
  const selectTarget = (id: string) => {
    const next = versionById(id); if (!next) return;
    if (next.id === base?.id) return;
    if (base && next.sequence <= base.sequence) { setBaseId(next.id); setTargetId(base.id); return; }
    setTargetId(id);
  };
  const openSource = async (version: SummaryVersionView) => {
    setSourceVersion(version); setSource(null); setSourceBusy(true);
    try { setSource(await window.synapse.summaries.source(detail.id, version.id)); }
    catch (reason) { onError(messageOf(reason)); setSourceVersion(null); }
    finally { setSourceBusy(false); }
  };
  return <>
    <div className="detail-actions"><button disabled={busy} draggable={Boolean(detail.reference)} title="点击复制；也可拖入 Codex 输入框" onDragStart={dragReference} onClick={() => { setConfirmingDelete(false); void copyReference(); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制引用" : "引用"}</button><button disabled={busy} onClick={() => { setConfirmingDelete(false); setEditing((value) => !value); }}><NotebookPen size={14} />{editing ? "预览" : "编辑"}</button><button disabled={busy} onClick={() => { setConfirmingDelete(false); void regenerate(); }}><RefreshCw size={14} />重新生成</button><button disabled={busy} onClick={() => { setConfirmingDelete(false); void window.synapse.export.markdown(detail.id); }}><FileDown size={14} />MD</button><button disabled={busy} onClick={() => { setConfirmingDelete(false); void window.synapse.export.json(detail.id); }}><FileDown size={14} />JSON</button>{detail.publicationStatus === "failed" && <button disabled={busy} onClick={() => { setConfirmingDelete(false); void window.synapse.summaries.retryPublication(detail.id); }}><RefreshCw size={14} />重试{detail.publisher === "notion" ? " Notion" : " Notes"}</button>}<button className="delete-summary-action" disabled={busy} title={confirmingDelete ? "永久删除本地总结；不会删除已同步的外部页面" : "删除总结"} onClick={() => void deleteSummary()}><Trash2 size={14} />{confirmingDelete ? "确认删除" : "删除"}</button></div>
    {editing ? <div className="editor-form history-editor"><label>标题<input value={content.title} onChange={(event) => setContent({ ...content, title: event.target.value })} /></label><label>摘要<textarea rows={3} value={content.abstract} onChange={(event) => setContent({ ...content, abstract: event.target.value })} /></label><label>标签<input value={content.tags.join(", ")} onChange={(event) => setContent({ ...content, tags: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label><label>正文<textarea className="markdown-editor" value={content.bodyMarkdown} onChange={(event) => setContent({ ...content, bodyMarkdown: event.target.value })} /></label><div className="row-actions"><button className="secondary" disabled={busy} onClick={save}>保存新草稿</button><button className="primary" disabled={busy} onClick={finalize}>确认新 final</button></div></div> : <article className="markdown-preview"><span className={`version-pill ${current.kind}`}>{current.kind}</span><h1>{current.content.title}</h1><p className="abstract">{current.content.abstract}</p><div className="tag-row">{current.content.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><ReactMarkdown>{current.content.bodyMarkdown}</ReactMarkdown></article>}
    <VersionExplorer versions={versions} base={base} target={target} baseId={baseId} onSelectBase={selectBase} onSelectTarget={selectTarget} onOpenSource={(version) => void openSource(version)} />
    {sourceVersion && <SourceDrawer version={sourceVersion} source={source} busy={sourceBusy} onClose={() => { setSourceVersion(null); setSource(null); }} />}
  </>;
}

function VersionExplorer({ versions, base, target, baseId, onSelectBase, onSelectTarget, onOpenSource }: {
  versions: readonly SummaryVersionView[]; base: SummaryVersionView | null; target: SummaryVersionView; baseId: string;
  onSelectBase(id: string): void; onSelectTarget(id: string): void; onOpenSource(version: SummaryVersionView): void;
}) {
  const diff = diffSummaryContent(base?.content ?? emptySummaryContent, target.content);
  const contributions = contributionVersions(versions, base?.sequence ?? null, target.sequence);
  const option = (version: SummaryVersionView, disabled = false) => ({ value: version.id, label: `V${version.sequence + 1} · ${operationLabel(version.operation)}`, disabled });
  const metadata = [
    { label: "标题", before: base?.content.title ?? "", after: target.content.title },
    { label: "摘要", before: base?.content.abstract ?? "", after: target.content.abstract },
    { label: "标签", before: base?.content.tags.join(", ") ?? "", after: target.content.tags.join(", ") },
  ];
  const metadataModifications = metadata.filter((field) => field.before !== field.after).length;
  return <section className="version-explorer">
    <div className="version-explorer-head"><div><GitCompareArrows size={17} /><strong>版本比较</strong></div><span>任意两版累计 Diff；来源按中间版本逐次归因</span></div>
    <div className="version-selectors">
      <label>基线版本<Select ariaLabel="基线版本" value={baseId} onChange={onSelectBase} options={[{ value: "empty", label: "空白基线" }, ...versions.map((version) => option(version, version.id === target.id))]} /></label>
      <span>→</span>
      <label>目标版本<Select ariaLabel="目标版本" value={target.id} onChange={onSelectTarget} options={versions.map((version) => option(version, version.id === base?.id))} /></label>
      {target.baseVersionId && target.baseVersionId !== baseId && <button className="secondary" onClick={() => onSelectBase(target.baseVersionId!)}>与融合基线比较</button>}
    </div>
    <div className="version-timeline" aria-label="版本历史">{versions.map((version) => <button className={version.id === target.id ? "active" : ""} key={version.id} onClick={() => onSelectTarget(version.id)}><b>V{version.sequence + 1}</b><span>{operationLabel(version.operation)} · {version.kind}</span><small>{version.model ?? "本机用户"} · {version.sourceTurnIds.length} turns · {new Date(version.createdAt).toLocaleString()}</small></button>)}</div>
    <div className="diff-stats"><span className="added">+{diff.stats.added} 新增</span><span className="removed">-{diff.stats.removed} 删除</span><span className="modified">~{diff.stats.modified + metadataModifications} 修改</span></div>
    <div className="metadata-diff">{metadata.map((field) => <div key={field.label}><strong>{field.label}</strong>{field.before === field.after ? <span>{field.after || "（空）"}</span> : <><del>{field.before || "（空）"}</del><ins>{field.after || "（空）"}</ins></>}</div>)}</div>
    <div className="body-diff">{diff.rows.length === 0 ? <p>正文没有变化</p> : diff.rows.map((row, index) => <div className={`diff-row ${row.kind}`} key={`${index}-${row.oldLine}-${row.newLine}`}><code>{row.kind === "added" ? "+" : row.kind === "removed" ? "−" : row.kind === "modified" ? "~" : " "}</code><pre>{row.kind === "modified" ? <><span className="old-line">{renderParts(row.oldParts ?? [])}</span><span className="new-line">{renderParts(row.newParts ?? [])}</span></> : row.newLine ?? row.oldLine}</pre></div>)}</div>
    <div className="contribution-chain"><strong>变更贡献链</strong>{contributions.map((version) => {
      const parent = version.parentVersionId ? versions.find((item) => item.id === version.parentVersionId) ?? null : null;
      const versionDiff = diffSummaryContent(parent?.content ?? emptySummaryContent, version.content);
      const human = version.operation === "manual-edit" || version.operation === "finalize";
      const finalChanged = version.operation === "finalize" && parent !== null && (versionDiff.stats.added + versionDiff.stats.removed + versionDiff.stats.modified > 0 || metadataChanged(parent, version));
      return <button key={version.id} onClick={() => onOpenSource(version)}><b>V{version.sequence + 1}</b><span>{finalChanged ? "人工修改并确认" : operationLabel(version.operation)}</span><small>{human ? "本机人工操作 · 沿用背景来源" : `直接来源 · ${version.sourceTurnIds.length} turns`} · +{versionDiff.stats.added} -{versionDiff.stats.removed} ~{versionDiff.stats.modified}</small><MessageSquareText size={15} /></button>;
    })}</div>
  </section>;
}

function SourceDrawer({ version, source, busy, onClose }: { version: SummaryVersionView; source: SummaryVersionSourceView | null; busy: boolean; onClose(): void }) {
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [openingCodex, setOpeningCodex] = useState(false);
  const [openCodexError, setOpenCodexError] = useState<string | null>(null);
  useEffect(() => { setSelectedTurnId(source?.turns[0]?.id ?? null); setOpenCodexError(null); }, [source]);
  const selectedTurn = source?.turns.find((turn) => turn.id === selectedTurnId) ?? source?.turns[0] ?? null;
  const openInCodex = async () => {
    if (!source?.session) return;
    setOpeningCodex(true); setOpenCodexError(null);
    try { await window.synapse.sessions.openInCodex(source.session.threadId); }
    catch (reason) { setOpenCodexError(`无法打开 Codex：${messageOf(reason)}`); }
    finally { setOpeningCodex(false); }
  };
  return <div className="source-drawer-backdrop" onClick={onClose}><aside className="source-drawer" role="dialog" aria-modal="true" aria-label={`V${version.sequence + 1} 对话追踪`} onClick={(event) => event.stopPropagation()}>
    <header><div><span>{version.operation === "manual-edit" || version.operation === "finalize" ? "背景来源" : "直接来源"}</span><h2>V{version.sequence + 1} 对话追踪</h2></div><button aria-label="关闭来源详情" onClick={onClose}><X size={17} /></button></header>
    <div className="source-hash"><span>来源快照</span><code>{version.sourceHash}</code></div>
    {busy && <p className="source-loading">正在载入完整对话…</p>}
    {!busy && source && <>
      {source.session ? <div className="source-session-meta"><strong>{source.session.title || "未命名任务"}</strong><span>{source.session.cwd}</span><code>session {source.session.sessionId}</code><code>thread {source.session.threadId}</code><small>{source.session.model ?? "未知模型"} · {source.session.status}</small><button className="secondary source-session-open" disabled={openingCodex} onClick={() => void openInCodex()}><ArrowUpRight size={14} />{openingCodex ? "正在打开…" : "在 Codex 中打开"}</button>{openCodexError && <p className="source-open-error">{openCodexError}</p>}</div> : <p className="source-unavailable">来源 session 不可用：{version.sourceSessionId}</p>}
      {source.missingTurnIds.length > 0 && <p className="source-unavailable">缺失 turn：{source.missingTurnIds.join(", ")}</p>}
      {source.turns.length > 1 && <div className="source-turn-tabs" aria-label="关联 turns">{source.turns.map((turn) => <button className={turn.id === selectedTurn?.id ? "active" : ""} key={turn.id} onClick={() => setSelectedTurnId(turn.id)}>TURN {turn.sequence + 1}<small>{turn.status}</small></button>)}</div>}
      <div className="source-turns">{selectedTurn && <article><header><b>TURN {selectedTurn.sequence + 1}</b><code>{selectedTurn.id}</code><span>{selectedTurn.status} · {new Date(selectedTurn.startedAt).toLocaleString()}{selectedTurn.completedAt ? ` → ${new Date(selectedTurn.completedAt).toLocaleString()}` : ""}</span></header><section><strong>用户</strong><pre>{selectedTurn.promptContent || "（无内容）"}</pre></section><section><strong>助手</strong><pre>{selectedTurn.assistantContent || "（无内容）"}</pre></section></article>}</div>
    </>}
  </aside></div>;
}

function renderParts(parts: readonly DiffPart[]) { return parts.map((part, index) => part.changed ? <mark key={index}>{part.value}</mark> : part.value); }

function metadataChanged(parent: SummaryVersionView | null, version: SummaryVersionView): boolean {
  if (!parent) return Boolean(version.content.title || version.content.abstract || version.content.tags.length);
  return parent.content.title !== version.content.title || parent.content.abstract !== version.content.abstract || parent.content.tags.join("\u0000") !== version.content.tags.join("\u0000");
}

function operationLabel(operation: SummaryVersionOperationView): string {
  return ({ generate: "Agent 新建", merge: "Agent 融合", regenerate: "Agent 重新生成", "manual-edit": "人工编辑", finalize: "确认 final" })[operation];
}

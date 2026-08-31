# macOS 人工验收清单

以下项目涉及真实 UI、Codex 信任状态、额度或 Apple Events 权限，因此默认不在自动化测试中执行。

## Electron 与挂件

- 运行 `npm run dev`，确认挂件出现在主屏幕右上安全区。
- 确认挂件透明、无边框、置顶、所有 Space 可见，拖到另一显示器后重启仍恢复对应位置。
- 确认收起态显示进行中/待总结数量，展开态最多显示 3 条并用 `+N` 展示其余数量。
- 在挂件点击“总结”后确认工作区不打开，按钮原位变为 loading；完成后按钮右侧出现跳转图标，点击直接打开对应历史详情。
- Tray 可打开历史、显示/隐藏挂件和退出。

## Codex Hook

- 在设置页安装 Hook，检查原 `~/.codex/hooks.json` 内容仍保留，并存在备份与 manifest。
- 首次未安装 Hook 时，从挂件齿轮、空队列按钮和 Tray“打开设置”均可到达安装入口；安装后设置页应自动展示信任确认框，列出完整 relay 命令及 SessionStart、UserPromptSubmit、Stop 三个事件。
- 使用全新数据库启动时应自动打开设置引导；成功安装或点击“暂不设置”后，后续启动不再自动弹出。主动卸载后也不得重新触发首次引导。
- 在 Synapse 确认框点击“信任并启用”，检查设置页显示“已启用”，Codex `/hooks` 中三个 Synapse Hook 均为 `trusted`；修改任一 handler 定义后应恢复为 `modified` 并要求重新确认。
- 提交 prompt 后挂件立即显示 running；Stop 后卡片置顶并显示“总结”。
- 关闭 Synapse，完成一个 Codex turn，再启动 Synapse；确认 spool 事件重放且文件随后删除。
- 模拟数据库暂时不可写，确认 Receiver 不返回成功 ACK，Relay 将原始事件保留到 spool，而不是静默丢弃。
- 检查 `~/Library/Application Support/Synapse/logs/synapse.log` 持久化记录启动、Hook 状态和事件接收日志。
- 模拟 Renderer 组件抛错时应显示可重新加载的错误页，并在日志中留下 `[synapse:renderer]` 记录，而不是白屏。
- 开发模式固定监听 `127.0.0.1:43173`；若端口已占用应直接启动失败，不得在 IPv4/IPv6 的同名 `localhost` 上加载其他 Vite 项目。
- 打包后确认 sandboxed preload 为 `out/preload/index.cjs`，设置页可正常读取 `window.synapse`，日志中没有 `preload-failed`。
- 重复安装后卸载，确认只删除 Synapse handler，用户 Hook 未被删除。

## turn 选择与总结

- 打开总结面板，确认 completed turns 默认选中，failed/interrupted 可见但默认不选。
- 验证单击、Shift 连选、全选/取消，以及按住约 350ms 后拖过多行；长按结束不应反向取消首行。
- 选择任意非连续 turns 生成草稿；确认 App Server 不可用时只影响 agent 生成，Hook 监控与本地 turns 仍保持正常。
- 对没有本地 rollout、但 Hook 已完整接收 prompt/assistant 的任务执行总结，确认不会出现 `thread not loaded`。
- 编辑标题、摘要、标签与 Markdown，等待自动保存；切换预览后确认格式。
- 点击完成后出现 final，历史中保留 agent draft、edited draft、final 各版本。
- 对长会话生成总结，检查 `summary_jobs.stage_coverage_json` 包含 chunk 与 final 的 turn IDs。

## 历史、导出与数据库

- 验证全文搜索和项目/profile/日期/状态过滤。
- 在历史详情重新生成、编辑并确认新 final，旧 final 保持不变。
- 在历史详情操作栏点击“删除”，确认第一次只切换为“确认删除”；第二次点击后详情和历史条目消失。若它是该 session 最后一份总结，确认源任务重新出现在待整理队列。
- 删除已同步到 Notes 的总结，确认 Synapse 本地版本、全文索引及发布状态已删除，同时已有 Apple Notes 内容不受影响。
- 导出 Markdown/JSON，检查内容与当前版本一致。
- “数据库目录”只在 Finder 中显示目录，不移动活动 SQLite 文件。

## Apple Notes

- 首次 final + 同步时允许 macOS 自动化权限，确认目标文件夹中只创建一个便签。
- 确认设置页和总结页可列出真实账户/文件夹，并能明确选择“新建文件夹”。
- 修改并确认新 final，确认更新同一 note identifier；SQLite 仍有完整版本。
- 拒绝权限，确认状态为 failed 且不会每隔数秒反复请求。
- 删除已关联便签或文件夹后重试，确认明确失败且不静默创建重复便签。
- 修复目标后点击“重试 Notes”，确认原失败 outbox 被关闭。

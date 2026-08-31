# macOS 人工验收清单

以下项目涉及真实 UI、Codex 信任状态、额度或 Apple Events 权限，因此默认不在自动化测试中执行。

## Electron 与挂件

- 运行 `npm run dev`，确认挂件出现在主屏幕右上安全区。
- 确认挂件透明、无边框、置顶、所有 Space 可见，拖到另一显示器后重启仍恢复对应位置。
- 确认收起态显示进行中/待总结数量，展开态最多显示 3 条并用 `+N` 展示其余数量。
- Tray 可打开历史、显示/隐藏挂件和退出。

## Codex Hook

- 在设置页安装 Hook，检查原 `~/.codex/hooks.json` 内容仍保留，并存在备份与 manifest。
- 在 Codex `/hooks` 中确认三个 Synapse Hook 首次为 `untrusted`，信任后设置页显示 `trusted`；修改定义后应显示 `modified`。
- 提交 prompt 后挂件立即显示 running；Stop 后卡片置顶并显示“总结”。
- 关闭 Synapse，完成一个 Codex turn，再启动 Synapse；确认 spool 事件重放且文件随后删除。
- 模拟数据库暂时不可写，确认 Receiver 不返回成功 ACK，Relay 将原始事件保留到 spool，而不是静默丢弃。
- 重复安装后卸载，确认只删除 Synapse handler，用户 Hook 未被删除。

## turn 选择与总结

- 打开总结面板，确认 completed turns 默认选中，failed/interrupted 可见但默认不选。
- 验证单击、Shift 连选、全选/取消，以及按住约 350ms 后拖过多行；长按结束不应反向取消首行。
- 选择任意非连续 turns 生成草稿；确认 App Server 不可用时只显示可操作错误，Hook 监控保持正常。
- 在 App Server 启动较慢或会话尚未持久化时，确认 turn 面板明确显示“同步中/不可用”，同步完成前不允许基于缓存生成。
- 编辑标题、摘要、标签与 Markdown，等待自动保存；切换预览后确认格式。
- 点击完成后出现 final，历史中保留 agent draft、edited draft、final 各版本。
- 对长会话生成总结，检查 `summary_jobs.stage_coverage_json` 包含 chunk 与 final 的 turn IDs。

## 历史、导出与数据库

- 验证全文搜索和项目/profile/日期/状态过滤。
- 在历史详情重新生成、编辑并确认新 final，旧 final 保持不变。
- 导出 Markdown/JSON，检查内容与当前版本一致。
- “数据库目录”只在 Finder 中显示目录，不移动活动 SQLite 文件。

## Apple Notes

- 首次 final + 同步时允许 macOS 自动化权限，确认目标文件夹中只创建一个便签。
- 确认设置页和总结页可列出真实账户/文件夹，并能明确选择“新建文件夹”。
- 修改并确认新 final，确认更新同一 note identifier；SQLite 仍有完整版本。
- 拒绝权限，确认状态为 failed 且不会每隔数秒反复请求。
- 删除已关联便签或文件夹后重试，确认明确失败且不静默创建重复便签。
- 修复目标后点击“重试 Notes”，确认原失败 outbox 被关闭。

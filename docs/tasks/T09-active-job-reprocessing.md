# T09 — 活跃岗位按 2027 档案重新处理

## 目标

仅重新处理当前活跃岗位（`new`、`to-apply`），让它们使用已确认的 2027 候选人事实、T10 的 Eligibility/Match 新 schema，以及 T08 的 readiness 质量闸门。`applied` 和 `rejected` 始终冻结；`skip` 默认不重处理。

当前只读盘点结论：共有 4 个活跃记录，其中 3 个带 legacy 评分、1 个未评分；它们都需要当前 schema 的新评分。岗位名称、JD、简历或材料内容不在本任务卡中记录。

## 绝对边界

- 不改写 `applied` / `rejected` 的任何 job、score、材料或状态。
- 不自动申请、提交表单、发送外联或标记 `applied`。
- 不把 sponsorship 未说明视为不合格；只记录为 `needs-verification` 风险。
- 不将计划中的 NIW 当作当前工作授权或 sponsorship 替代品。
- 不自动生成 stretch 或 `needs-verification` 岗位的材料；必须由用户逐项选择。
- 每个会调用模型的阶段需要独立授权，且不得显示或写入 API key。

## T09-A — 活跃岗位预演与保护清单（待授权；不调用模型）

### 工作内容

1. 只读取活跃 job 的状态、record policy、score schema、readiness 和文件名/字节聚合；不读取或输出 JD、简历、求职信或外联文本。
2. 生成 aggregate-only 计划：待重新评分数量、已有 legacy 材料数量、缺少材料数量、已初始化 readiness 状态、按状态分布。
3. 为每个活跃记录生成不含内容的保护清单，明确后续若生成新材料时需先归档旧材料；预演阶段不复制、不写入。
4. 检查本地 LLM 配置是否仅以“已配置/未配置”状态可用；不读取密钥、不发请求。

### 验收

- 不调用 LLM、Render、Neon、浏览器或外部网络。
- 不修改 `data/jobs`；前后 aggregate checksum 相同。
- 输出不含岗位标题、公司、URL、JD、档案或材料文本。
- 用户确认计划后才可进入 T09-B。

## T09-B — 当前 schema 重新评分（需单独授权；有模型成本）

### 工作内容

1. 对 T09-A 确认的 4 个活跃岗位逐个调用现有本地 LLM provider，只重写活跃岗位的 `score.json` 和匹配报告。
2. 使用 T10 结构校验；失败必须显式记录并保留原有文件，不得以无效输出覆盖旧评分。
3. 状态规则：仅 `eligibility.ineligible` 且含明确 hard blocker 可移至 `skip`；`needs-verification`、low-match、stretch 保持活跃，由用户决定。
4. 每个岗位记录模型使用量与结果摘要；报告只包含用户已确认的事实，不生成材料。

### 验收

- `applied` / `rejected` 字节不变；`skip` 默认不处理。
- 每个被处理的活跃岗位都有有效 Eligibility、Match、recommendation 或清晰失败记录。
- 不生成 resume、cover letter、PDF、docx、外联或任何对外动作。
- 用户得到逐岗但可编辑的“主投 / 海投 / stretch / 待核实 / 明确不合格”决策清单。

## T09-C — 用户选择后的材料生成与 ready 清单（需逐项授权；有模型成本）

### 工作内容

1. 用户从 T09-B 决策清单中选择可生成材料的岗位；默认候选为 `eligible` 的 `main_target` / `mass_apply`。stretch 和 `needs-verification` 必须显式点选；`ineligible` 不生成。
2. 在写入任何新材料前，归档活跃岗位现有 legacy 材料并记录版本/哈希；不改变冻结历史。
3. 生成简历和求职信，执行事实核查、一页判定、readiness 初始化；问题或未知页数一律为 `needs-review`。
4. 用户在看板/CLI 审阅后用标准确认或带理由 override 标记 `ready`；系统仍不标记 `applied`。

### 验收

- 每个新材料都能追溯到当前 score、2027 profile 和生成时间；旧材料可恢复查看。
- 只有 `ready` 且已人工确认/override 的材料可通过 `applied` 闸门。
- 不触碰已投/被拒历史；不自动提交。

## 依赖与顺序

`T09-A 预演确认` → `T09-B 当前评分` → `用户选择` → `T09-C 归档与生成` → `人工 ready 确认`。

T09-A 之前必须保留当前本地备份；T09-B/T09-C 不可与 push、部署、云端迁移或批量导入混在同一授权中。

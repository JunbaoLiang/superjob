# T08 — 材料就绪状态、人工确认与投递拦截

## 目标

在本地工作流中把“投递进度”与“材料质量”明确分离，并确保任何入口都不能在材料未准备好、未由用户确认前把岗位标为 `applied`。系统仍不自动提交申请；这里只控制内部状态变更。

## 当前缺口

本地 CLI、`POST /api/status` 和看板拖拽都能直接把任意岗位改为 `applied`，不检查事实核查、简历页数、材料版本或人工确认。已投/被拒历史记录已有 `record_policy` 元数据，但本任务不会重写它们的材料或回填 readiness。

云端也存在相同的直接状态接口，但其数据在 Neon 中，需要单独的 schema 迁移、备份与部署验证；按已确认的本地优先策略，这一部分留给 T08-B。

## T08-A 范围（本地实现）

1. 在活跃岗位的 `job.json` 中新增可追溯的 `material_readiness` 对象；不删除或覆盖既有字段、材料或历史材料。建议结构：

   ```json
   {
     "state": "not-generated | draft | needs-review | ready",
     "assessment": {
       "resume_fact_verdict": "clean | issues | needs-review | unknown",
       "cover_fact_verdict": "clean | issues | needs-review | unknown",
       "resume_pages": 1,
       "material_profile_version": "active-2027 | legacy-2026 | unknown",
       "checked_at": "ISO-8601"
     },
     "confirmation": {
       "confirmed_at": "ISO-8601",
       "mode": "standard | override",
       "reason": "override 时必填",
       "unresolved": ["确认时仍存在的闸门问题"]
     }
   }
   ```

2. 定义并测试纯 readiness 评估规则：
   - 无完整材料：`not-generated`；
   - 事实核查不是 `clean`、页数未知/不是一页、材料基于 `legacy-2026`，或任何检查无法确认：`needs-review`；
   - 两份事实核查均 clean、简历恰好一页、材料是 `active-2027`，但尚未人工确认：`draft`；
   - 只有用户运行明确确认命令后，`draft` 才变为 `ready`；
   - 用户可以 override 为 `ready`，但必须填写非空原因，并记录当时未解决问题、时间和模式。
3. 生成材料后只更新活跃岗位的材料版本和 readiness 评估；生成过程不自动把任何材料标 `ready`。`applied`/`rejected` 冻结历史不生成、不覆写、不迁移。
4. 在本地状态变更的单一边界中阻止 `→ applied`：只有 `material_readiness.state === "ready"` 才允许；所有 CLI、API、看板拖拽/下拉框自然继承该规则。
5. 增加本地 CLI：
   - `job readiness <job-id>`：显示状态、检查结果和是否可标已投；
   - `job confirm-ready <job-id>`：仅在全部自动闸门通过时确认；
   - `job override-ready <job-id> --reason "…"`：记录理由后明确放行。
6. 更新本地看板/API 返回值并显示 readiness badge、无法投递的原因和已记录 override；被阻止的拖拽/下拉操作显示服务器返回的错误，而不是静默刷新。
7. 对当前活跃岗位仅提供默认 dry-run 的 readiness 初始化统计；必须在单独确认后才写入活跃岗位元数据。历史岗位不写入、不重评分、不生成材料。
8. 添加 fixture-only 测试：评估规则、override 理由与审计字段、`applied` 拦截、CLI/API 共用边界、冻结历史拒绝写入，以及重复初始化幂等性。

## T08-A 非范围

- 不调用 LLM、不重新处理活跃岗位、不自动投递、不发送外联。
- 不修改 `applied`/`rejected` 的原始材料、状态或冻结记录；不删除岗位。
- 不将未确认的材料伪装为 `ready`，也不允许空理由 override。
- 不执行 Neon 数据库迁移、Render 部署或云端 API/UI 改动；这些是 T08-B。
- 不 commit、push 或部署，除非另行授权。

## 实施分段与授权

### T08-A1 — 纯规则与 dry-run（首次授权）

添加 readiness 评估器、fixture 测试、CLI 只读查看和默认 dry-run 初始化。不得写真实岗位元数据，不得生成材料或改变状态。报告仅含聚合数量。

### T08-A2 — 本地写入与交互（需再次确认）

在用户确认 dry-run 统计后，执行一次仅对活跃岗位的幂等初始化；接入生成流程、确认/override 命令、本地 API 与看板。验证 `→ applied` 已在单一状态边界阻止，且历史岗位未改变。

### T08-B — 云端同步（未来独立授权）

先设计 Neon 可回滚迁移与 cloud fixture 测试，再单独授权执行。不得把本地数据当作云端迁移输入，也不得删除本地副本。

## 验收

T08-A1：

```bash
npm test
node src/cli.js readiness <fixture-only job>
git diff --check
```

真实数据只允许执行 dry-run，并输出数量而非岗位名称、JD、简历或材料内容。

T08-A2：

1. 任何非 `ready` 的活跃岗位经 CLI、本地 API、看板拖拽或下拉均不能改为 `applied`。
2. clean + 一页 + `active-2027` 的材料仍须显式 `confirm-ready`；override 必有理由、时间和快照。
3. 失败/未知事实核查或页数、旧 2026 材料始终为 `needs-review`。
4. `applied`/`rejected` 历史目录、材料字节和状态均不变。
5. 第二次初始化为 no-op；测试和数据完整性检查通过。

## 下一步授权

`授权执行 T08-A1`：只实现本地纯规则、fixture 测试、CLI 查看和真实数据 dry-run；不写真实岗位、不生成材料、不改状态、不调用模型、不提交/push/部署。

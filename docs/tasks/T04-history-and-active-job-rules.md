# T04 — 历史岗位冻结与活跃岗位规则

状态：`complete`
优先级：P0

## 目标

为每个岗位明确区分“投递进度”和“材料所基于的候选人档案版本”，冻结已投/被拒的历史记录，并让活跃岗位可在后续按当前 2027 档案重新准备。T04 不重新评分、不生成材料、不改变投递状态。

## 当前发现

- 现有数据已有 application status，但没有材料版本、冻结原因或记录类型字段。
- 已生成材料仍来自过期候选人档案；它们必须保留为历史证据，而不是被新档案覆盖。

## 数据规则

每个岗位的 `job.json` 将在单独授权后新增一个可迁移、可扩展的 `record_policy` 对象：

```json
{
  "record_policy": {
    "record_type": "historical | active | skipped",
    "frozen": true,
    "frozen_reason": "submitted | rejected | null",
    "material_profile_version": "legacy-2026 | active-2027 | unknown",
    "migration_version": 1
  }
}
```

- `applied` 与 `rejected`：`historical`、冻结；保留当时所有材料，标为 `legacy-2026`。
- `new` 与 `to-apply`：`active`、不冻结；已有旧材料仅标记 `legacy-2026`，后续可按当前档案重新准备。
- `skip`：`skipped`、不自动重生成；保留既有资料，不把它伪装成当前可投材料。
- 未来进入 `applied` 的岗位必须保存当时提交材料的版本，不被后续重新生成覆盖。

T04 只定义归档/版本规则。`material readiness`（`not-generated`、`draft`、`needs-review`、`ready`）和人工 override 留给 T08 实施。

## 授权边界

仅在用户回复“授权执行 T04-A”后才可改写 `job.json` 元数据或新增迁移脚本。

允许：

- 添加幂等 migration/dry-run 工具及其测试。
- 仅向 `job.json` 添加 `record_policy` 元数据；不改既有业务字段。
- 记录每种状态的迁移结果和缺失/异常项数量，不输出岗位名称、链接或材料内容。

禁止：

- 修改、删除、移动或重命名任何岗位目录、岗位原文、简历、求职信、导出文件或 status。
- 覆盖旧材料，重新评分，调用 LLM，提交申请、外联或推送 Git。

## 执行步骤

1. 建立只读岗位清单，仅统计 status、材料文件是否存在和现有元数据完整性。
2. 先为 migration 写 fixture 与幂等测试；覆盖 historical、active、skipped 和缺失 `job.json` 的安全失败路径。
3. 实现 dry-run：输出将新增/保留/跳过的数量，不写数据。
4. 经用户确认 dry-run 结果后，执行一次仅新增 `record_policy` 的迁移；第二次运行不得产生差异。
5. 验证所有 `applied`/`rejected` 均冻结，所有 `new`/`to-apply` 均活跃，`skip` 不被排为 ready；确认材料文件字节未变。

## 验收标准

- 投递状态仍保持现有值，历史材料文件字节不变。
- 已投和被拒岗位可明确识别为冻结历史记录与旧档案版本。
- 活跃岗位可明确识别为可用当前档案后续处理的记录，但 T04 不生成任何新材料。
- migration 可 dry-run、可重复执行，并且不泄露岗位或候选人内容。
- Git 不包含真实岗位数据、档案或材料；没有 commit、push、部署或外部操作。

## 完成后的交付

报告状态统计、迁移结果、异常数量、材料完整性校验结果和下一张建议任务卡：T05 — 自动化测试基线。

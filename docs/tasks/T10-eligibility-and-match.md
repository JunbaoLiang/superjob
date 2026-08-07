# T10 — Eligibility 与 Match 拆分

## 目标

把岗位评分拆为两条独立、可解释的轴：

- **Eligibility（是否可申请）**：工作授权、签证、国籍/安全许可、学历、时间、地点等明确要求。
- **Match（实际匹配）**：技能、研究领域、职责、级别和真实经历的匹配度。

这项任务落实已确认的规则：只有 JD 明确表明不符合时才形成 hard block；`sponsorship unspecified` 是待核实风险，不能自动判为不合格或跳过。主投阈值为 75，海投阈值为 60；stretch 岗位只有用户点选后才生成材料。

## 已发现边界

1. 现有 score Prompt 将硬条件、软匹配和隐性优势合在一个 0–100 分数与 `verdict` 中。
2. 现有本地和云端流水线会在任何 `verdict === "skip"` 时自动把岗位移至 `skip` 状态；这会把不确定信息和低匹配混为一谈。
3. 现有 score schema 仅有 `score`、`verdict`、`hard_blockers`、`gaps`、`strengths`、`rationale` 和 `resume_angle`，无法表达“可申请但需核实”的风险。
4. 本地历史岗位与其既有 score/material 都是记录；T10 不回写 `applied`/`rejected`，不改其投递材料。
5. 云端 `jobs` 表当前为空；云端实现必须支持未来新记录，但不需要回填或迁移现有云端评分。

## T10-A — 离线规则、schema 与测试（待授权）

### 修改范围

- `data/prompts/score.md` 与 `cloud/server/prompts/score.md`
- `src/output-validation.js` 与 `cloud/server/src/output-validation.js`
- 本地/云端 `pipeline`、`server` / `tasks` 的评分后状态逻辑
- 本地/云端报告、CLI、看板的评分呈现
- fixture-only 测试、公开任务文档

不读取或修改 `data/profile/`、`data/jobs/`，不调用 LLM、Neon 或 Render，也不生成任何材料。

### 目标结构

模型输出应包含以下概念；字段名可在实现前按现有代码风格细化，但语义不得缩减：

```json
{
  "eligibility": {
    "verdict": "eligible | needs-verification | ineligible",
    "hard_blockers": ["仅 JD 明确的即时不符合项"],
    "risks": ["JD 未说明或需向招聘方核实的项目"],
    "checks": ["工作授权/签证、时间、地点、学历、许可的简明依据"]
  },
  "match": {
    "score": 0,
    "verdict": "strong_match | worth_applying | stretch | low_match",
    "rationale": [],
    "gaps": [],
    "strengths": [],
    "resume_angle": ""
  },
  "recommendation": "main_target | mass_apply | stretch | verify | skip"
}
```

规则：

- `eligibility.verdict === "ineligible"` 时 `hard_blockers` 必须非空，且 recommendation 只能为 `skip`。
- `needs-verification` 时 `hard_blockers` 必须为空；`risks` 必须非空；不能因 sponsorship 未说明而自动 `skip`。
- 只有 `ineligible` 才可自动移至 `skip`；低 Match、stretch 或待核实岗位保持 `new` / `to-apply`，由用户决定。
- 以候选人档案中已确认的实习/全职窗口、F-1 CPT、OPT/STEM OPT、长期 sponsorship 需求为唯一事实来源；Prompt 不得推断额外移民资格。
- 主投为 Match ≥75 且 eligible；海投为 Match ≥60 且 eligible；`needs-verification` 只展示核实提醒，不自动降级为不可申请。
- stretch 一律不自动生成材料；生成入口必须要求用户显式点选。

### 必须先写的测试

1. schema 拒绝缺失 eligibility、非法 verdict、hard blocker 与 verdict 冲突、风险与 `eligible` 冲突的输出。
2. fixture 覆盖：明确需要公民身份/安全许可（ineligible）；明确支持或满足当前授权要求（eligible）；sponsorship 未说明（needs-verification，不 skip）；实习与全职窗口不同的时间判断。
3. 本地和云端评分后状态规则：只有明确 `ineligible` 会移动至 `skip`。
4. recommendation 阈值：75 主投、60 海投、低于 60 的 stretch/low-match 区分。
5. 报告/看板/CLI 能显示 eligibility、风险、Match 和 recommendation；旧 score 文件只读显示为 legacy，不崩溃、不改写。
6. 本地与云端 validator、score Prompt 维持字节一致或由单一来源生成。

### 验收

- 不调用真实模型的前提下，根项目与云端测试一条命令通过。
- 所有未知 sponsorship fixture 都不能产生 hard blocker 或自动 `skip`。
- 已投/被拒 fixture 的 score、材料和状态字节不变。
- `git diff --check` 通过，且 `data/` 无改动。

## T10-B — 离线历史回放与活跃岗位准备（需单独授权）

在 T10-A 经测试后，运行只读 replay：仅统计历史 37 个已有评分在新 schema 下的分布差异、明确 blocker 与待核实风险数量。不得向 LLM 发送岗位原文或写入任何岗位文件。

若用户确认 replay 结果，再由单独任务 T09 仅对 `new` / `to-apply` 活跃岗位以当前 2027 profile 调用模型重新评分和生成；`applied` / `rejected` 一律不重写。

## 禁止项

- 不自动申请、发送消息、提交表单或改变 `applied` 历史。
- 不将 `unspecified` sponsorship 当作已知拒绝。
- 不把“计划申请 NIW”写成当前雇佣授权或雇主 sponsorship 的替代品。
- 不在 T10-A 访问真实岗位、档案、Neon 或任何 LLM 服务。
- 不 commit、push、部署或执行回放，除非用户另行授权。

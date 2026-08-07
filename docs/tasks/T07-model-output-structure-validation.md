# T07 — 模型输出结构校验

## 目标

让本地与云端流水线把模型输出的“能解析 JSON”与“满足任务契约”分开处理。字段缺失、类型错误、非法 verdict/score，或事实核查解析失败时，系统必须给出明确错误或 `needs-review`，绝不能把它们伪装成通过。

## 已发现的问题

当前 `askJSON()` 只从输出中提取并解析 JSON；调用方没有验证任务字段：

- 职位抽取可在缺少公司或职位名的情况下继续创建记录。
- 评分可保存任意对象，非法分数、verdict 或 blocker 组合不会被发现。
- 外联可保存缺少 `who`、`channel`、`note` 或 `message` 的对象。
- 两种事实核查在 JSON 解析异常时返回 `{ verdict: "clean", issues: [] }`；这会把“没有完成核查”错误地展示为“核查通过”。

这与已确认的 D05 相冲突：事实核查解析失败时，材料必须保持 `needs-review`，而非 clean/ready。

## 范围

1. 为本地与云端分别增加可单测的纯输出校验边界；保持两端相同的任务契约和失败语义。
2. 校验职位抽取输出：
   - 合法的 `error`/`reason` 无职位分支可以正常返回；
   - 正常职位至少有非空的公司名与职位名；
   - `remote_policy`、`visa_sponsorship` 只能使用 Prompt 指定枚举；数组字段必须为字符串数组。
3. 校验评分输出：`score` 是 0–100 的整数，`verdict` 属于四个已定义值，文本数组字段类型正确；`hard_blockers` 非空时必须为 `skip`。
4. 校验事实核查输出：
   - `verdict` 仅可为 `clean` 或 `issues`；
   - `issues` 为结构正确的数组，且 `clean` 必须对应空数组，`issues` 必须对应至少一个问题；
   - 解析或结构校验失败返回显式的 `needs-review` 核查结果和错误说明，绝不返回 `clean`；生成流程仍可保存草稿供人工查看。
5. 校验外联输出：`who` 为字符串数组，`channel`、`note`、`message` 均为非空字符串；只有通过校验才保存并执行既有 200 字符 note 兜底。
6. 添加本地和云端的离线 fixture 测试，覆盖合法输出、缺字段、非法枚举/分数、blocker 规则、非 JSON 输出，以及事实核查失败不再 clean。
7. 保持错误信息可行动且不泄露完整 JD、简历、模型原文或 API key。

## 非范围

- 不调用真实 LLM，不产生 API 成本，也不重新生成任何岗位材料。
- 不更改 Prompt 的求职策略、评分阈值、候选人事实或历史岗位。
- 不实施完整 `material_readiness` 数据模型、人工 override、看板 badge 或投递拦截；这些属于 T08。
- 不迁移/覆盖 `applied`、`rejected` 的冻结历史材料。
- 不提交、push、部署或修改 Render/Neon 环境变量。

## 实施顺序

1. 先写失败 fixture：每个任务契约的最小合法样本与典型坏样本。
2. 实现纯校验器及清晰的失败类型；让 local/cloud 使用同一份契约定义或行为等价的实现。
3. 将校验接到 `extractJob`、`scoreJob`、`generateOutreach`、简历事实核查与求职信事实核查。
4. 运行完整离线测试和语法/diff 检查，确认不访问 `data/`。

## 验收

```bash
npm run test:all
node --check src/pipeline.js
node --check cloud/server/src/pipeline.js
git diff --check
```

并确认：

1. 无效职位/评分/外联输出不会被写入或伪装为有效结果。
2. 事实核查解析失败和 schema 失败均为 `needs-review`，且保留可读错误原因。
3. 合法 fixture 在本地和云端均继续通过。
4. 测试仅使用假客户端/静态 JSON；没有 LLM、Render、Neon 或个人数据访问。
5. `data/` 下没有任何改动。

## 下一步授权

`授权执行 T07-A`：只实现上述校验与离线测试；不调用模型、不生成材料、不改历史岗位、不提交/push/部署。

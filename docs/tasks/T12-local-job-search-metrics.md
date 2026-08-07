# T12 — 本地求职效果指标

## 目标

在本地看板和 CLI 提供可解释的求职漏斗：抓取量、资格/匹配建议、材料 readiness、投递状态与来源渠道，帮助判断问题在来源、筛选还是材料转化。

## 隐私与边界

- 只读取本地 `job.json`、`score.json` 和存在性标记；不读取 JD、简历、求职信或外联内容。
- 不写回岗位记录，不上传第三方，不调用模型。
- 仅报告聚合计数及 URL hostname 来源；不在统计输出包含公司、职位、完整 URL 或材料文本。

## 分阶段

1. 以临时 fixture 实现纯聚合器，覆盖状态、Eligibility/Match recommendation、readiness、来源及缺失/旧版评分。
2. 添加 `job metrics`、本机 `/api/metrics` 与看板概览；验证不含个人内容。
3. 后续若要衡量材料生成时间或面试率，需先新增明确的时间字段；现有历史记录不得猜测时间。

## 验收

- 输出能解释 active、ready、applied/interview/offer/rejected、main/mass/verify/skip 的数量。
- 来源仅按 hostname 聚合；缺少 URL 显示 `unknown`。
- fixture 测试证明不会修改任何文件。

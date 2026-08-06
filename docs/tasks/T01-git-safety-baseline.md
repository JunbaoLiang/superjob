# T01 — 建立 Git 安全基线

状态：`ready-for-authorization`
优先级：P0
创建日期：2026-08-06
正式目录：`<project-root>`
目标远端：`https://github.com/JunbaoLiang/superjob.git`（公开仓库）

## 1. 目标

为 Superjob 建立一个可公开分享、可复现、不会泄露个人求职数据或密钥的 Git 基线。任务完成后，公开仓库只包含通用代码、通用 Prompt/模板、示例配置和去个人化文档；所有真实档案、岗位、申请材料、运行日志、密钥和本机配置继续只保留在本地。

T01 不修改产品逻辑，不备份或迁移个人数据，不更新候选人档案，也不执行部署。

## 2. 已确认输入

- 正式项目目录固定为 `<project-root>`。
- GitHub 仓库允许公开，目标远端为 `https://github.com/JunbaoLiang/superjob.git`。
- 已投递和被拒岗位及其原始材料必须冻结；T01 不得改写这些文件。
- 项目计划可进入 `docs/`，但公开版本必须去个人化；具体身份、工作许可、移民计划、真实简历和岗位信息留在 Git 忽略的本地档案中。
- 不自动提交、推送、部署、申请职位、发送消息或删除历史数据。

## 3. 当前已知状态

- 正式目录目前不是 Git 仓库。
- 根目录已经存在 `.gitignore`，但规则需要为公开仓库补强。
- 本地存在 `.env`、`.capture-token`、`data/`、`node_modules/` 和本机工具设置等内容。
- 根项目、`cloud/server/` 和 `cloud/migrate/` 均为 Node.js 项目区域；目前没有自动测试、lint 或 build script。T05 将建立正式测试基线。
- `dropoff.md`、`sample-jd.txt` 和 `sample-jd-match.txt` 尚未完成公开安全归类，不能默认纳入首次提交。

## 4. 授权边界

### 4.1 T01-A：本地安全准备

只有用户明确回复“授权执行 T01-A”后才可执行。允许修改或创建：

- `.gitignore`
- `docs/superjob-takeover-plan.md`（公开、去个人化版本）
- `docs/tasks/T01-git-safety-baseline.md`
- Git 初始化产生的 `.git/` 元数据和暂存区

允许读取代码、配置、Prompt 和模板以判断是否适合公开；对个人数据只允许进行路径核验、忽略规则核验和字节校验，不在报告中输出其正文。

### 4.2 T01-B：本地基线提交

完成 T01-A 后，Codex 必须先展示完整的拟提交文件清单、敏感信息扫描结果、校验结果和验证结果。只有用户再次明确授权后，才可创建本地基线 commit。

### 4.3 T01-C：首次公开推送

本地 commit 完成后仍不得自动 push。只有用户明确授权公开推送后，才能向 `origin/main` 推送。禁止 force push。

## 5. 必须保护的内容

以下内容不得进入 Git 暂存区、commit 或远端：

- `.env`、`.env.*` 中的真实配置；仅允许确认无真实值的 `.env.example`
- `.capture-token`、API key、数据库 URL、认证 token、私钥、cookie
- `data/profile/**`
- `data/jobs/**`，可保留空目录占位文件，但不得包含真实岗位或材料
- `data/server.log` 及其他运行日志
- 真实简历、cover letter、PDF、DOCX、岗位原文和评分/核查结果
- `node_modules/**`
- `.claude/settings.local.json`、`.planning/**` 及其他本机工具状态
- 包含个人联系方式、身份/工作许可细节或未公开申请信息的文档

`data/prompts/**` 和 `data/templates/**` 属于通用项目资产，可在逐文件审查后进入 Git；不得因为它们位于 `data/` 下而一并忽略。

## 6. 执行步骤

### 步骤 1 — 只读预检

1. 确认当前目录精确为 `<project-root>`。
2. 读取本任务卡、相关源码、`.gitignore`、`package.json` 和当前 Git 状态。
3. 只读检查远端引用；若远端已有未知 commit、默认分支或文件，立即停止并报告，不合并、不覆盖、不 force push。
4. 建立临时的个人数据文件清单和 SHA-256 校验值，写入 `/private/tmp` 下的新临时目录；不读取或打印文件正文。
5. 记录现有用户文件，不删除、不移动、不重命名。

### 步骤 2 — 补强忽略规则

更新 `.gitignore`，至少覆盖：

- `.env` 和真实环境变量文件，同时显式允许 `.env.example`
- `.capture-token`
- `node_modules/`
- `.DS_Store`
- `data/profile/`
- `data/jobs/`，仅在确有需要时允许 `.gitkeep`
- `data/server.log` 和运行日志
- `.claude/settings.local.json`
- `.planning/`

修改后使用 `git check-ignore -v --no-index` 对代表性敏感路径逐项验证。不能仅凭肉眼判断 `.gitignore` 有效。

### 步骤 3 — 建立公开文档

1. 创建 `docs/superjob-takeover-plan.md`，保留项目目标、原则、D01–D10 的产品/工程结论和 T01–T18 路线图。
2. 删除或泛化候选人特定事实，包括身份、工作许可、移民计划、联系方式、真实公司/岗位和申请状态明细。
3. 明确标注哪些能力是当前已有、哪些是计划中，避免把尚未实施的 readiness 闸门等写成现有功能。
4. 不在 T01 中顺带重写产品 README 或产品行为。

### 步骤 4 — 初始化本地 Git

1. 在正式目录初始化 `main` 分支。
2. 配置远端名称 `origin` 指向已确认 URL；若已有不同远端，停止并报告。
3. 禁止使用 `git add .` 或其他宽泛暂存方式。
4. 先按明确允许列表暂存代码、通用资产和文档：
   - `.gitignore`、经检查的 `.env.example`
   - `package.json`、锁文件、安装/卸载脚本
   - `src/`、`extension/`
   - 审查通过的 `cloud/`
   - `data/prompts/`、`data/templates/`
   - `README.md` 和 `docs/`
5. `dropoff.md`、`sample-jd.txt`、`sample-jd-match.txt` 只有在确认内容已去个人化、无完整第三方岗位原文且适合公开后才可加入；否则保持本地未跟踪或加入忽略规则，不删除原文件。

### 步骤 5 — 暂存区安全审计

在任何 commit 前完成并报告：

1. `git status --short --ignored`：确认受保护路径处于 ignored，而非 staged/untracked 漏网状态。
2. `git diff --cached --name-only`：人工审查每一个拟提交路径。
3. `git diff --cached --stat` 和 `git diff --cached --check`：检查异常大文件、空白和补丁错误。
4. 对暂存内容扫描常见 API key、GitHub token、Bearer token、数据库连接串、私钥头、邮箱、电话和本机绝对路径。
5. 手工复核 Markdown、JSON、YAML、示例文本和部署配置，防止真实档案、岗位原文或申请材料以“示例”名义进入仓库。
6. 确认暂存区不包含 `data/profile/`、`data/jobs/`、`.env`、`.capture-token`、`.planning/`、本机设置、PDF/DOCX 或运行日志。
7. 比较步骤 1 的个人数据 SHA-256 清单，确认 T01 前后字节不变。

任何扫描命中都按失败处理：先取消相关文件暂存并查明原因；不能把扫描失败描述成 clean。

### 步骤 6 — 无成本验证

验证不得调用真实 LLM、不得读取真实 API key、不得产生 API 费用：

1. 确认 Node.js 满足根项目要求 `>=20.12`。
2. 对 `src/`、`extension/` 和 `cloud/` 中的 JavaScript 运行 `node --check`。
3. 使用锁文件进行根项目和 `cloud/server/` 的 clean install 验证；不为 `cloud/migrate/` 临时生成新锁文件。
4. 若 clean install 需要受限网络，按环境要求申请授权；不得静默跳过后宣称通过。
5. 记录当前“无自动测试/build script”的事实；T01 不伪造测试覆盖，正式测试留给 T05。

### 步骤 7 — 审批关口与提交

向用户报告：

- 修改文件
- 完整拟提交文件清单
- ignored 敏感路径验证证据
- secret/个人数据扫描结果
- SHA-256 前后对比结果
- Node 语法与安装验证结果
- 未分类文件及遗留风险

报告完成后停止，等待 T01-B 授权。获得授权后仅创建本地基线 commit，建议消息：`chore: establish public project baseline`。

### 步骤 8 — 审批关口与公开推送

本地 commit 后再次报告 commit ID 和最终文件树，等待 T01-C 授权。获得授权后才能执行首次普通 push，并在新的 `/private/tmp` 目录中进行干净克隆验证。禁止 force push；禁止修改 GitHub 仓库可见性、权限或付费设置。

## 7. 验收标准

- Git 只跟踪通用代码、通用 Prompt/模板、示例配置和去个人化文档。
- `.env`、`.capture-token`、完整 `data/profile/`、完整 `data/jobs/`、日志、依赖和本机状态均被规则实际忽略。
- 暂存内容的敏感信息扫描无未解决命中。
- 已投递/被拒历史材料及其他个人数据的前后 SHA-256 清单一致。
- 所有 JavaScript 语法检查通过；根项目和 `cloud/server/` 可从锁文件安装。
- 公开计划不包含候选人特定身份或申请数据，并区分当前能力与未来路线图。
- commit 和 push 都有独立、明确的用户授权记录。
- 推送后可在临时目录干净克隆，并重复完成适用的安装和语法验证。

## 8. 停止条件

遇到以下任一情况必须停止并请求用户决定：

- 远端仓库已有未知或冲突历史。
- 拟提交内容包含真实密钥、个人档案、岗位材料或无法确认是否适合公开的信息。
- `.gitignore` 无法可靠隔离受保护路径。
- 个人数据校验值发生变化。
- 必须修改本任务卡授权范围之外的文件才能继续。
- 需要 force push、删除文件、重写历史、创建付费资源或改变仓库权限。

## 9. 回滚与事故处理

- commit 前：只撤销暂存，不删除或覆盖工作区文件。
- commit 后但 push 前：停止并报告，通过新的修正 commit 处理；不使用破坏性 reset。
- push 后发现敏感信息：立即停止后续操作，通知用户轮换/吊销相关凭据，再单独制定历史清理方案；不能仅删除最新文件后声称泄露已解决。
- T01 不删除 `.git/`、个人数据或历史材料。

## 10. 明确不在范围内

- T02 个人数据备份
- T03 候选人档案更新
- 任何产品代码、Prompt、评分、readiness 或状态模型改造
- 自动测试框架建设（T05）
- 安装器修复、云端部署或数据迁移
- GitHub 仓库权限、可见性、分支保护或许可证选择
- 自动申请、外联、删除岗位或覆盖历史材料

## 11. 执行完成后的交付格式

执行者必须列出：

1. 改动内容及文件路径
2. 暂存/提交文件清单
3. 验证命令和通过/失败证据
4. 受保护数据未变化的证据
5. 公开推送状态和 commit ID（如已获授权）
6. 遗留风险
7. 下一张建议任务卡：T02 — 备份个人数据与历史材料

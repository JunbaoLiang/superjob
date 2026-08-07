# 求职助手 (Job Copilot)

个人求职辅助工具:看到职位 → 判断匹配度 → 生成投递材料 → 一键导出可提交的 PDF/docx。

**当前进度:M1 命令行核心闭环 ✅ + 材料生成增强 ✅ + M2 浏览器一键抓取 ✅ + 零终端后台服务 ✅**
- 解析 JD → 匹配打分(含软性偏好)→ 每岗一份人类可读 `match-report.md`
- 生成定制简历 + cover letter,**自动事实核查**(对照主简历查虚构/过度拉伸并修正)
- **一页硬保证**:渲染探测页数,超出自动压缩重排
- **导出 PDF + docx**:ATS/HR/AI 友好的 Charter 单栏排版
- skip 岗位可走**海投模式**;`genall` 批量生成
- **Chrome 扩展一键抓取**:招聘页点一下就解析+打分,免复制粘贴
- **零终端**:双击 `安装.command` 一次,服务开机自启、崩溃自动拉起,日常完全不碰终端

(Notion 追踪 M3 / 面试准备 M4 待开发)

## ☁️ 云端版(网页 + 插件,免费部署)

`cloud/` 目录是完整的云端版:**Neon**(Postgres 数据库)+ **Render**(API + 生成流水线)+ **Vercel**(网页面板)。
部署后任何设备的浏览器都能看投递看板、生成简历,Mac 关机也不影响;Chrome 扩展改为指向云端地址。
部署步骤见 **`cloud/DEPLOY.md`**(约 20 分钟,全部走免费额度)。本地版与云端版数据相互独立,`cloud/migrate/` 有一次性迁移脚本。

## 安装(一次性)

**双击项目里的 `安装.command`**,它会自动完成:

1. 定位 Node(兼容 homebrew / nvm)并在缺依赖时 `npm install`
2. 没有 `.env` 时创建并打开它；填写 `LLM_PROVIDER`、`LLM_MODEL`，以及该 provider 对应的 API key
3. 注册 macOS 开机自启后台服务(launchd,崩溃自动拉起,日志在 `data/server.log`)
4. 安装全局 `job` 命令(终端里 `job list` 即可,不用再打 `node src/cli.js ...`)
5. 打开浏览器面板 http://127.0.0.1:8787/

> 若双击提示权限问题,右键 →「打开」;或终端里跑一次 `bash 安装.command`。
> 换了 Node 版本 / 挪动项目目录 / 服务异常,**重新双击一次即可修复**。
> 不想要了双击 `卸载.command`,数据不受影响。

```bash
# 导出 PDF/docx 需要 pandoc(macOS 已随系统带 xelatex 做 PDF 引擎):
brew install pandoc
# 没装 pandoc 也能跑,会退化为仅用系统 textutil 出 docx(无 PDF)
```

## 初始配置:填写个人档案

编辑 `data/profile/` 下的三个文件(每个文件顶部有注释说明该填什么):

| 文件 | 内容 |
|---|---|
| `resume-master.md` | 主简历:所有经历/项目/技能的超集,越详细越好 |
| `target.md` | 求职目标:方向、级别、地点、薪资、签证状态、一票否决条件 |
| `preferences.md` | 简历和 cover letter 的风格偏好 |

## 日常使用(全程浏览器,不碰终端)

后台服务装好后一直在跑,日常流程就三步:

1. **抓取**:在招聘详情页点 Chrome 扩展图标 →「抓取此职位」。后台自动解析 + 打分,可连续抓多个(自动排队)。
2. **生成**:打开面板 http://127.0.0.1:8787/ → 选中职位 →「生成材料」→ 实时进度跑完,切 tab 看**匹配报告 / 简历 / Cover letter**(内嵌 PDF 预览,可下载 .docx)。
3. **投递**:下载 PDF/docx 去投,投完用面板里的状态下拉标记 `applied`(会自动重命名目录)。

Chrome 扩展安装(一次性):`chrome://extensions` → 开「开发者模式」→「加载已解压的扩展程序」→ 选 `extension/` 目录。

面板里还能:重新打分、生成外联建议(该联系谁 + 私信草稿,可编辑复制)、删除误抓的职位。

### 命令行(可选,给喜欢终端的时候用)

`安装.command` 装好了全局 `job` 命令,等价于面板里的所有操作:

```bash
# 在职位页面全选复制(Cmd+A, Cmd+C),然后:
pbpaste | job add - --url "https://职位链接"
#    → 自动解析 + 打分 + 写 match-report.md,输出分数/verdict/blockers/gaps

job gen 2026-07-04-acme     # 生成材料(job-id 支持前缀/子串模糊匹配)
job score <job-id>          # 改了 target/profile 后重新打分
job status <job-id> applied # 投递状态推进: new → to-apply → applied → interview → offer/rejected
job list                    # 所有职位:投递状态 + 分数 + 目录名
job show <job-id>           # 单个打分详情
job genall [--force]        # 批量生成所有已打分但缺材料的岗位
job export [job-id]         # 只重渲染 PDF/docx(手改 .md 后用)
job report [job-id]         # 只重生成 match-report.md
job outreach <job-id>       # 外联建议:该联系谁 + 连接备注 + 私信草稿
job rm <job-id>             # 删除误抓/重复的职位
```

命令一览:`add` · `score` · `status` · `gen` · `genall` · `export` · `report` · `outreach` · `list` · `show` · `rm` · `serve`
(job-id 支持模糊匹配:精确 → 唯一前缀 → 唯一子串;`node src/cli.js <命令>` 依旧可用,`job` 只是全局快捷方式)

**外联(投递后主动联系)**:`job outreach <job-id>` 或面板详情里点「生成外联建议」——给出**该联系谁 + 怎么找到 TA**(优先 JD 里的联系人;否则给 LinkedIn 搜索词、母校校友筛选思路、recruiter),并起草一条 **LinkedIn 连接备注(≤300 字)+ 私信/邮件正文**(英文、基于主简历、可在面板里直接编辑复制)。存在 `outreach.json`。

**打分理由**:每次打分会额外给一段 2–4 条的 bullet 摘要(`rationale`),直击「为什么是这个分数」,`list`/`show`/`match-report` 都能看到。

**事实核查**:简历和 cover letter 都会对照主简历自动查「关于我」的虚构/过度拉伸并修正(cover letter 只查关于我的陈述,忽略对公司/动机的描述);改不动的存疑项在 match-report 里标出。

**成本可见**:每次用到 API 的命令结束会打印本次调用次数、token 数和预估美元成本(单价在 `src/llm.js` 的 `PRICING` 里；未知模型不会用错误费率估算)。

**投递状态**:每个岗位目录名形如 `公司-岗位-状态`;状态即申请进度,`add` 后 skip 自动标 `skip`、其余为 `new`,用状态下拉或 `job status` 推进。可选值:`new`(待定) `to-apply`(待投) `applied`(已投) `interview`(面试) `offer` `rejected` `skip`(不投)。

## 后台服务管理

| 想做什么 | 怎么做 |
|---|---|
| 看服务是否在跑 | 扩展弹窗左上角绿点;或访问 http://127.0.0.1:8787/health |
| 重启服务(改了 src/ 代码后) | `launchctl kickstart -k gui/$UID/com.superjob.serve`,或重新双击 `安装.command` |
| 看日志 | `data/server.log` |
| 换端口 | `.zshrc` 里 export SUPERJOB_PORT 后重跑 `安装.command`;`extension/popup.js` 顶部 `PORT` 和 `manifest.json` 的 `host_permissions` 要一起改 |
| 彻底停掉 | 双击 `卸载.command`(数据不动) |

改 `data/prompts/`、`data/profile/`、`data/templates/` **不需要重启**——每次请求都现读文件。改 `src/` 代码才需要重启。

**安全**:服务只监听 `127.0.0.1`,API key 始终留在 `.env`,不进浏览器;`/capture` 需扩展来源或 token(`.capture-token`)鉴权。

## 调整打分、内容和排版(都不用改代码)

Prompt 在 `data/prompts/`:

- `score.md` — 打分权重和分数段(顶部注释有调整说明)
- `extract.md` — JD 字段提取规则
- `resume.md` / `cover-letter.md` — 生成规则(风格问题优先改 `data/profile/preferences.md`)
- `fact-check.md` / `resume-fix.md` — 事实核查与修正的判定标准
- `resume-condense.md` — 超一页时的压缩规则
- `interview.md` — 面试题预测(M4 启用)

PDF 排版在 `data/templates/`(xelatex 预设,pandoc 引入):

- `resume.tex` — 简历样式:字体(默认 Charter)、蓝色小节标题、边距、松紧
- `letter.tex` — cover letter 样式

## 数据目录

```
data/
├── profile/        你的档案(手动维护)
├── prompts/        Prompt 资产(手动调整)
├── templates/      PDF 排版预设(resume.tex / letter.tex)
├── server.log      后台服务日志
└── jobs/公司-岗位-状态/  每个职位一个目录(目录名带投递状态,随状态推进改名)
    ├── raw.txt           页面原文
    ├── job.json          结构化职位信息
    ├── score.json        匹配打分
    ├── match-report.md   人类可读的匹配报告
    ├── fact-check.json   简历事实核查结果(含页数、压缩轮数)
    ├── resume.md/.pdf/.docx        定制简历(三种格式)
    ├── cover-letter.md/.pdf/.docx  定制求职信(三种格式)
    └── outreach.json     外联建议(该联系谁 + 连接备注 + 私信草稿)
```

## Safari:书签(零安装)

Safari 装扩展要 Xcode 打包签名,太重,改用书签。打开 `http://127.0.0.1:8787/bookmarklet`,把蓝色「📋 抓取此职位」拖到书签栏,在招聘页点它即可。

> ⚠️ Safari 会拦截从 `https://` 页面访问 `http://localhost`。若点了没反应,用同页的**「📋 复制正文(兜底)」**书签:它只把正文复制到剪贴板(不发网络,必定能用),再到终端跑 `pbpaste | job add -`。

> 💡 **LinkedIn 抓取提示**:LinkedIn 是单页应用,会在隐藏 DOM 里残留你之前看过的职位,直接抓整页可能抓错。所以抓取会**优先抓你选中的文字**:在 LinkedIn 上先用鼠标**拖选中间那份职位描述**,再点扩展/书签,就只抓你选的那段,绝不串。干净的单职位页面则不用选,直接抓整页。误抓了用面板红色「删除」按钮或 `job rm <job-id>` 清掉。

## 后续里程碑

- **M3 Notion 同步**:投递状态追踪表
- **M4 面试准备**:`interview.md` 生成面试题预测

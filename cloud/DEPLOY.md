# 云端部署指南(Neon + Render + Vercel,全免费)

部署完成后的形态:

```
Chrome 扩展(抓取招聘页)──┐
                          ├──▶  Render 上的 API(解析/打分/生成/导出,API key 在这里)
Vercel 上的网页面板 ──────┘            │
(任何设备的浏览器都能开)          Neon Postgres(职位、材料、档案、成品 PDF/docx)
```

以后**任何电脑/手机打开面板网址**就能看抓取进度、投递看板、生成简历;Mac 关机也不影响。
本地版(`node src/cli.js` / launchd 服务)保留可用,两边数据互不影响。

---

## 第 0 步:把代码推上 GitHub(一次性)

```bash
cd ~/Documents/superjob
git init
git add -A
git commit -m "Job Copilot:本地版 + 云端版"
```

去 https://github.com/new 建一个仓库(公开或私有均可；本项目当前使用公开仓库),然后:

```bash
git remote add origin git@github.com:你的用户名/superjob.git
git branch -M main
git push -u origin main
```

> `.gitignore` 已经排除了 `.env`、`data/profile/`、`data/jobs/`、`node_modules/`,
> 个人数据不会进仓库(档案和职位数据走第 4 步的迁移脚本直接进数据库)。

**重要**:Render 的 Blueprint 要求配置文件在仓库根目录,把它挪过去再提交:

```bash
cp cloud/render.yaml render.yaml
git add render.yaml && git commit -m "render blueprint" && git push
```

## 第 1 步:Neon — 建数据库(~2 分钟)

1. https://neon.tech 用 GitHub 登录,「Create project」(区域选 US East 即可,和 Render 免费区同侧)。
2. 建好后首页有 **Connection string**,选「Pooled connection」,复制形如
   `postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require` 的整串。
3. 先存好,下一步要用。表结构不用管——服务启动时自动建。

## 第 2 步:Render — 部署 API(~10 分钟,大头是首次构建)

1. https://render.com 用 GitHub 登录 →「New +」→「**Blueprint**」→ 选你的 `superjob` 仓库。
2. Render 会读到根目录的 `render.yaml`,列出 `job-copilot-api` 服务。点「Apply」。
3. 在服务页的 Environment 设置下列变量:
   - `DATABASE_URL` → 粘贴第 1 步的 Neon 连接串
   - `LLM_PROVIDER` → `anthropic` 或 `openai`
   - `LLM_MODEL` → 与 provider 对应的模型 ID
   - 若 `LLM_PROVIDER=anthropic`：`ANTHROPIC_API_KEY` → Claude API key
   - 若 `LLM_PROVIDER=openai`：`OPENAI_API_KEY` → OpenAI API key
   - `APP_TOKEN` 会自动生成——这是你的**访问口令**,面板和扩展都要用它。
4. 等构建完成(镜像里装 TeX,首次约 5-10 分钟;之后每次 push 自动重新部署,快很多)。
5. 记下两样东西:
   - 服务地址,形如 `https://job-copilot-api-xxxx.onrender.com`
   - `APP_TOKEN` 的值:服务页 → Environment → 点开 APP_TOKEN 复制
6. 验证:浏览器开 `https://你的服务地址/health`,返回 `{"ok":true}` 即成。

> 💤 **免费版会休眠**:15 分钟没请求就睡,下次访问冷启动约 1 分钟。介意的话去
> https://uptimerobot.com(免费)建一个每 5 分钟 ping `/health` 的监控,基本就不睡了。
> (Render 免费额度每月 750 小时,单个服务 24×31=744 小时,够整月常驻。)

## 第 3 步:Vercel — 部署面板(~3 分钟)

1. https://vercel.com 用 GitHub 登录 →「Add New…」→「Project」→ Import 你的 `superjob` 仓库。
2. 关键一步:**Root Directory** 点「Edit」改成 `cloud/web`;Framework Preset 选「Other」。
   其它保持默认(纯静态,无构建命令),点 Deploy。
3. 得到面板网址,形如 `https://superjob-xxxx.vercel.app`。
4. 打开它,填入第 2 步的 **API 地址** 和 **APP_TOKEN**,点连接。看板出现即成功。
   (手机浏览器同样能开,收藏一下。)

## 第 4 步:迁移本地数据(一次性,~2 分钟)

在 Mac 上:

```bash
cd ~/Documents/superjob/cloud/migrate
npm install
DATABASE_URL="粘贴 Neon 连接串" node migrate.js
```

会把 `data/profile/` 三个档案 + `data/jobs/` 全部职位(含已生成的 PDF/docx)导入云库。
重复运行安全。完成后刷新面板就能看到所有职位。

## 第 5 步:换装云端版 Chrome 扩展(~2 分钟)

1. `chrome://extensions` → 移除旧的「Job Copilot 抓取」(本地版)→「加载已解压的扩展程序」→ 选 `cloud/extension/` 目录。
2. 右键扩展图标 →「选项」,填三样:
   - API 地址(Render)
   - 面板地址(Vercel)
   - 访问口令(APP_TOKEN)
   点「测试并保存」。
3. 到任意招聘页点扩展 →「抓取此职位」→ 到面板看结果。收工 🎉

---

## 日常使用

- **抓取**:招聘页点扩展(LinkedIn 记得先拖选职位描述再点)。
- **看板/生成/编辑**:开面板网址。生成材料约 2-4 分钟,进度实时显示;简历/CL 可在面板里直接**编辑并重新导出 PDF**。
- **改档案**:面板右上角「档案」,改完保存,下次打分/生成即生效。
- **不再需要本地服务**:可以双击项目里的 `卸载.command` 停掉 launchd(本地 CLI `job ...` 命令仍可用,操作的是本地 data/,与云端独立)。

## 常见问题

| 症状 | 处理 |
|---|---|
| 面板/扩展提示连不上 | 免费版冷启动约 1 分钟,稍等重试;仍不行看 Render 服务页的 Logs |
| 401 未授权 | 口令和 Render 环境变量 APP_TOKEN 不一致,重新复制 |
| PDF 字体不对 | Render 构建日志里搜 XCharter,若下载失败点「Manual Deploy → Clear build cache & deploy」重来 |
| 想换模型或 Provider | Render → Environment → 成对修改 `LLM_PROVIDER` 与 `LLM_MODEL`；确认对应的 provider key 已设置后保存自动重启 |
| 改了 prompts/ 或模板 | 提交并 push,Render 自动重新部署(prompts 打包在镜像里) |
| Neon 免费额度 | 0.5GB 存储;PDF 都存库里,几百个岗位没问题;不够就删旧岗位 |
| 安全性 | API 只认 APP_TOKEN;泄露了就在 Render 里改一个新值,面板/扩展同步更新 |

## 花费

- **Neon / Render / Vercel**:都在免费档内(单服务、低流量、<0.5GB 数据)。
- **Claude API**:与本地版相同,按用量计费,面板每次生成结束会显示本单成本。

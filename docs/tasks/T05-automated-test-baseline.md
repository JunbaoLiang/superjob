# T05 — 自动化测试基线

## 目标

建立一条稳定、无外部成本的测试命令，覆盖本地闭环与云端 API 最容易回归的纯逻辑和安全边界。测试必须只使用临时 fixtures，绝不读取或改写真实档案、岗位、历史材料、Neon 数据库或 LLM API。

## 当前事实

- 根项目已有 `npm test`，现有覆盖为 record-policy 迁移和 LLM adapter mock。
- 云端 `cloud/server` 已有独立 `npm test`，覆盖 LLM adapter mock。
- `src/jobs.js` 导出 slug、状态和文件操作；`src/prompts.js` 导出模板变量替换；这些是可直接测试的纯逻辑入口。
- 本地/云端 server 的部分鉴权、队列和数据库初始化逻辑尚未以可注入形式暴露给测试。

## 范围

1. 为 `jobs` 建立临时目录 fixture，测试：
   - slug 规范化与状态标签；
   - 合法状态转换、非法状态拒绝；
   - 文件白名单与路径越界防护；
   - `resolveJobId` 的唯一匹配与歧义失败。
2. 为 `prompts` 建立 fixture，测试变量完整替换、缺变量提示、无残余模板占位符。
3. 扩展 LLM 测试，覆盖 JSON 解析、OpenAI incomplete 响应与两类 Provider 错误映射；继续只用 fake client。
4. 为云端补充纯函数/可注入边界的测试：未授权请求为 401、错误输入为 400、队列状态不泄露机密。
5. 增加统一验收脚本：根目录与云端测试、Node 语法检查和零网络调用断言。

## 允许的最小重构

- 仅为测试导出纯函数，或将文件系统/HTTP/数据库依赖注入到测试边界。
- 不修改岗位数据结构、历史材料、模型 Prompt 或 Render/Neon 配置。

## 明确不做

- 不调用 Anthropic、OpenAI、Render、Neon 或浏览器。
- 不创建真实岗位、不生成材料、不发送投递或外联。
- 不读取 `data/profile/`、`data/jobs/` 的真实内容，也不将它们放进测试 fixture。
- 不顺带实现 T06、本地服务安装器、T07 质量闸门或云端迁移。

## 验收

```bash
npm run test:all
node --check src/server.js
node --check cloud/server/src/index.js
```

1. 两套测试均通过且不需要任何真实 API key。
2. 测试只创建系统临时目录，并在结束后清理。
3. 至少覆盖 slug/status、模板变量、JSON 解析、LLM provider 错误、文件白名单和云端未授权 401。
4. 新增测试不能改变真实 `data/` 或数据库的字节内容。
5. 输出测试总数、通过数、失败数与未覆盖的高风险路径。

## 需要的下一步授权

`授权执行 T05-A`：先为上述边界补测试，必要时做最小可测试性重构；不 push、部署或调用真实模型。

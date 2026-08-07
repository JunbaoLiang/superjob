# T06 — 本地零终端服务与安装器恢复

## 目标

让本地版在不手动打开终端的情况下可靠启动，并让安装、重复安装、重启、健康检查、日志与卸载具有可验证且不伤数据的行为。

## 已发现的问题

安装器在当前 shell 中读取 `SUPERJOB_PORT` 并用它轮询健康端点，但写入的 LaunchAgent plist 没有 `EnvironmentVariables`。launchd 启动的 Node 进程因此看不到自定义端口，服务会回退监听默认 `8787`；安装器却继续等待自定义端口。Chrome 扩展也固定请求 `8787`，三处没有单一端口来源。

当前工作区未发现仓库内 plist；是否存在已安装的用户 LaunchAgent 只能在实施时通过只读 `launchctl print` 与文件检查确认。

## 范围

1. 抽取并测试端口配置规则：只接受有效 TCP 端口，默认 `8787`。
2. 安装器写入显式 `EnvironmentVariables` 的 `SUPERJOB_PORT`，且 plist 中的端口、健康轮询地址、启动日志和用户提示完全一致。
3. 明确扩展端口策略：
   - 本任务默认将本地端口固定为 `8787`，避免扩展与 host permissions 的静态约束；或
   - 若用户明确要求自定义端口，再作为单独任务实现扩展/manifest 同步配置。
4. 改善安装器：依赖检查、plist 语法检查、重复安装、`launchctl bootstrap` 失败的明确退出、有限等待和安全日志摘要。
5. 改善卸载器：仅停止/删除 `com.superjob.serve`，仅删除确认指向本项目的 `job` wrapper，绝不删除 `data/`、`.env`、profile 或 jobs。
6. 添加不会加载真实 LaunchAgent 的脚本/配置测试；实施验证时再进行一次受控的真实安装—健康检查—卸载—数据完整性检查。

## 非范围

- 不改变默认端口（继续为 `8787`）。
- 不修改 Chrome 扩展权限、端口或 manifest。
- 不改 Render/Neon、云端代码、LLM Provider 或真实岗位材料。
- 不删除用户数据，不提交 `.env` 或 `.capture-token`。

## 实施前需确认的运行时授权

T06 会调用 `launchctl` 并写入 `~/Library/LaunchAgents/com.superjob.serve.plist`，属于用户机器服务状态变更。开始真实安装/卸载验证前，必须由用户明确授权；默认先完成脚本和离线测试，再展示将执行的精确命令与目标 plist。

## 验收

离线阶段：

```bash
npm run test:all
bash -n 安装.command
bash -n 卸载.command
```

受控运行时阶段（需要单独授权）：

1. 连续运行安装器两次，服务只存在一个 `com.superjob.serve`。
2. `http://127.0.0.1:8787/health` 返回 JSON，扩展可见服务在线。
3. 日志路径在项目 `data/server.log`，且不打印 API key。
4. 重启服务后仍可恢复健康。
5. 卸载后服务停止、plist 与本项目 `job` wrapper 消失；`.env`、`.capture-token` 与 `data/` 字节不变。

## 下一步授权

`授权执行 T06-A（离线）`：只修改和测试脚本/配置，不调用 launchctl。

`授权执行 T06-B（运行时验证）`：在先审阅的精确目标上安装、检查、重启、卸载并验证；不删除用户数据。

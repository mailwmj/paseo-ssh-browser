# 交接：让 Agent 通过 SSH Browser 自动打开远程网页

## 需求

用户在本机使用 Paseo Desktop，Agent 和开发服务器运行在远程主机。正常开发过程中，Agent 启动网页服务后，应能把远程地址（例如 `http://localhost:3000/dashboard?tab=home#details`）交给 SSH Browser，由插件在用户电脑上建立 SSH 隧道，并在**同一个远程工作区**打开网页，让用户直接看到页面。用户不应再手动进入 SSH Browser 面板、查找端口或点击打开。

Agent 后续应能使用 Paseo 的浏览器工具检查页面。一个可行方向是让 Agent 主动调用插件提供的工具；单纯把 URL 输出在聊天中不会触发工具。工具描述和 Agent 指引需要明确何时主动调用，并在真实开发任务中验证；仅注册工具不能保证模型一定会调用。这里不要求扫描所有 Agent 输出并自动打开每一个 URL。

完成标准是：从未建立隧道的状态开始，Agent 启动远程服务并调用工具后，用户电脑上的工作区浏览器显示正确的远程页面；工具返回实际结果，Agent 可以继续检查该页面。端口被占用时不能误打开本机已有服务。

## 当前状态（2026-10-27）

- 用户说两端都已安装最新 beta。当前远程端实测 `paseo --version` 和 `paseo status --json` 均为 **0.14.0-beta.1**；桌面端具体版本本次未独立读取。
- 远程端 `ssh-browser` 插件正在运行，安装路径是本仓库；检查时 Git 处于 `main`，HEAD 为 `445c36f`。本仓库的 `@getpaseo/plugin` 开发依赖仍是 **0.13.0**，`paseo-plugin.json` 声明 `>=0.13.0`。使用 beta API 前需同步更新依赖、锁文件及兼容版本声明，并确认两端插件版本匹配。
- 已核对 npm 的 `@getpaseo/plugin@0.14.0-beta.1` 类型：它导出 `defineAgentTool`，并在 `agent.session_open` 请求中提供 `tools`。`0.13.0` 和此前检查的稳定版 `0.13.2` 没有该导出。升级插件依赖本身不能代替升级 Paseo 宿主。
- **正式 Agent 工具及完整自动打开流程尚未实现。** 本次交接只核对了版本、接口和现有代码，没有在 beta 上做完整链路测试。

## 之前的测试结果

在旧的 `0.13.0` 环境中，用户已通过 SSH Browser 面板打开远程的 18765 测试页面。之后的临时探针模拟了远程请求：客户端收到请求后在用户电脑上为 18766 建立隧道，Agent 再用浏览器工具打开页面；建立前及关闭后访问该端口均被拒绝。临时探针、18766 隧道和对应测试服务已经清理。

这证明了“远程请求可以触发桌面建隧道”和“经隧道访问远程网页”可行，**不证明**正式 Agent 工具、自动创建并聚焦标签或多客户端选择已经完成。测试还遇到过多个客户端连接同一远程主机、SSH 主机映射不匹配的情况，正式实现要处理正确的客户端归属。

## 现有代码与可复用能力

| 文件 | 当前职责 |
| --- | --- |
| [index.server.ts](index.server.ts)、[shared/ports.ts](shared/ports.ts) | 注册扫描、隧道及 SSH 目标 RPC；每个插件服务端实例有自己的 `TunnelManager`。 |
| [server/tunnels.ts](server/tunnels.ts) | 用本机 `ssh -L` 建隧道；优先沿用远程端口，端口被占用时选其他本地端口；相同目标和端口的已有隧道可以复用，插件停止时清理。 |
| [index.client.tsx](index.client.tsx)、[client/bridge.ts](client/bridge.ts) | 在桌面客户端共享**本机 Paseo 宿主**插件的 RPC，使远程插件的客户端代码能调用本机插件。这个共享值依赖同一个客户端 JavaScript 环境，并非正式的跨进程或跨设备 API。 |
| [client/browser-panel.tsx](client/browser-panel.tsx)、[client/use-host-ports.ts](client/use-host-ports.ts) | 通过面板找到 SSH 目标、建隧道，并用 `navigation.openBrowser` 打开工作区浏览器。面板首次发现该工作区恰好一个页面时有自动打开逻辑，但仍需先打开面板。 |
| [client/web.ts](client/web.ts)、[client/format.ts](client/format.ts) | 从 Desktop 内部存储读取本机与 SSH 主机映射；也可通过本机插件保存的手动目标及远程 Paseo `serverId` 匹配。Desktop 存储格式不是公开插件 API。 |

当前 `parseAddress` 会丢失输入协议，`useHostPorts.open` 固定生成 `http://` 地址；不能直接将其当作完整 URL 转换器。新流程应保留路径、查询参数、片段和协议；如果暂不支持某种协议，必须明确返回错误，不能悄悄将 HTTPS 改为 HTTP。

## 建议实现顺序

1. 在远程端通过 `defineAgentTool` 定义如 `open_remote_url` 的工具，在 `server.before("agent.session_open")` 中附加到目标 Agent。输入为本地网页 URL；从工具上下文取得 Agent 和 `workspaceId`，不要由模型猜测工作区。校验协议、回环地址及端口；`workspaceId` 不存在时返回清楚的错误。Beta 工具的 `execute` 在远程插件进程运行，接收 `agent`、`paseo` 和取消信号 `signal`。
2. 将工具请求交给连接了该远程宿主的桌面客户端处理。可以从之前临时探针验证过的请求/结果回传思路出发，优先使用 Paseo 支持的客户端与服务端通信能力。请求应能在**未手动打开面板**时被处理，并带有可关联的请求 ID、远程宿主、工作区和 URL；工具等待实际结果，断线、取消或超时要返回错误，不能报告伪成功。
3. 桌面客户端按远程 `serverId` 找到对应 SSH 目标，复用现有本机 `LocalApi.open` 和 `TunnelManager`。使用返回的实际 `localPort` 生成本机 URL，同时保留原 URL 的路径、查询、片段和支持的协议。不要因本地同端口已被其他进程占用而直接打开它。
4. 在原远程工作区创建并聚焦浏览器标签，再将结果回传给工具。**这里要先验证 API：** `navigation.openBrowser` 是从客户端 surface/panel 的 props 获得的，`PluginClientContext` 和远程 Agent 工具上下文没有直接暴露它。可试验由客户端主动调用 `client.openPanel`，再由面板通过 `navigation.openBrowser` 完成打开；须确认它在无需用户操作时可行，以及额外面板的实际体验。若 beta 没有合适的无面板入口，应记录具体限制或寻求 Paseo API 支持，不要假设服务端可以直接调用该方法。
5. 验证 Agent 能继续控制**同一个**页面。`navigation.openBrowser` 返回 `void`，不直接返回 `browserId`；需要验证通过 `browser_list_tabs` 能否可靠定位新标签。另一条已验证的路径是建隧道后由 Agent 调用 `browser_new_tab`，但它在后台打开且选择最近连接的浏览器宿主，不能直接等同于聚焦正确桌面的完整需求，也不能在多客户端时假定浏览器和隧道属于同一台电脑。
6. 明确多客户端处理：只让具备对应 SSH 映射和本机隧道能力的目标桌面处理请求，避免多个客户端各自打开页面或由错误电脑接管。若现有上下文无法唯一确定目标，先返回可理解的失败或补充可靠的客户端绑定机制，不要任意选一个并声称成功。请求结束、取消或插件卸载后，不应有迟到的打开操作；不要因为清理本次请求而关闭其他地方仍在使用的已有隧道。

## 验证清单

- 更新并安装同一插件版本到两端，确认两端宿主兼容；重新加载插件并让 Agent 会话重新打开，确认目标 Agent 真正能看到并调用新工具。插件的 session-open 钩子变更在现有会话重新打开后生效。
- 使用远程唯一标记的测试页面，从没有隧道开始，验证无需手动打开插件面板即可在正确工作区看到并聚焦页面；检查路径、查询及片段，验证 Agent 能读取同一标签。确认浏览器标签创建与页面真正加载分别有证据。
- 在用户电脑上占用同名端口，确认选用实际空闲端口，并以页面标记证明打开的是远程服务。重复调用验证已有隧道的复用；测试 SSH 认证失败、无对应目标、桌面离线、请求取消/超时及多客户端连接时的行为。
- 根据最终支持的 URL 范围覆盖 `localhost`、`127.0.0.1`、`[::1]`、HTTP/HTTPS、路径与参数；无效地址或不支持的协议要有明确错误。使用浏览器检查需要时再验证 WebSocket/热更新。
- 运行 `npm run typecheck` 和 `npm test`，并增加能验证新增请求与回传行为的针对性测试。现有 `tests/tunnels.test.ts` 的真实 SSH 测试只在 `ssh localhost` 可无交互登录时运行；跳过不能算通过了真实 SSH 测试。

## 参考

- [Paseo 插件 Agent 工具](https://paseo.sh/docs/plugins/reference#attach-tools-to-agents)
- [Paseo 工作区浏览器](https://paseo.sh/docs/plugins/reference#open-a-workspace-browser)
- [Paseo 浏览器工具](https://paseo.sh/docs/browser-tools)
- [Paseo Agent 工具示例](https://github.com/getpaseo/paseo/tree/main/plugin-examples/agent-tools)

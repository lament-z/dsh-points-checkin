# dsh-points-checkin

[English](./README.md) | 简体中文

DSH 插件：在 DSH 侧边栏里完成 WorkBuddy 和 TRAE 的积分查看与每日签到。侧边栏底部
Settings 旁多一个入口，点开是一张可展开的卡片：显示两家当前积分、今日签到状态和一键签到
按钮。卡片的设置页展示各家凭据来源（自动获取，无需粘贴任何 token）、拉取失败时的具体上游
原因，以及每日自动签到时间。host 半区在 DSH 启动时执行补签，并在设定时间运行每日调度，
未签的服务无需手动操作即可领取。

上游 API（`api.trae.cn`、WorkBuddy 计量服务）都不返回 CORS 头，浏览器半区无法直连；
host 半区在 `127.0.0.1` 上起一个本地 bridge（端口 27182-27191），面板自动探测并调用。
当页面经由反向代理提供（例如
[dsh-bridge-gateway](https://github.com/lament-z/dsh-bridge-gateway) 的直连网关）时，
面板改走同源 `/points-checkin/*` 代理路径。token 由 host 存放在
`~/.dsh-points-checkin/credentials.json`（权限 0600，不写日志）。

## 功能

- **一个入口管两家。** 侧边栏底部一张可展开卡片，同时显示两家的积分余额、今日签到状态与
  各自的签到按钮。
- **凭据全自动。** 任何地方都不需要粘贴 token；两家都复用桌面 App 登录态，过期自动续期
  （见下文）。
- **一键签到。** 在卡片里直接领取，积分变动即时可见；领取失败时展示上游错误原文。
- **每日自动签到。** 在卡片设置页配置时间（HH:mm，默认 09:00）；host 调度每 30 秒
  检查一次，到点自动领取当天未签的服务。
- **启动补签。** host 启动时立即补领当天未签的服务，错过定时点也不会漏签。
- **支持远程访问。** 经 dsh-bridge-gateway 直连网关或任何转发 `/points-checkin/*`
  的反向代理访问时，面板走同源路径；本地环境自动回落到 127.0.0.1 bridge。
- **设置页透明。** 各家凭据来源、失败时的上游错误原文、每日签到时间，一处看全。

## 要求

- DSH `>=0.1.1-rc.1`（构建与测试基于 `0.1.5-rc.2`）。
- WorkBuddy 和/或 TRAE 桌面 App 处于登录状态（自动凭据来源），或已导出 TRAE 的
  token 文件。

## 安装

```sh
# 推荐：直接从 GitHub 安装（无需 clone，lib 预构建产物已入库）
dsh plugin --profile web add github:lament-z/dsh-points-checkin

# 备选：从 npm 安装
dsh plugin --profile web add @lament_z/dsh-points-checkin

# 从本地 clone / 工作副本安装
dsh plugin --profile web add link:<本目录>
```

然后重启 `dsh web` 并刷新页面。入口出现在侧边栏底部 Settings 旁；侧边栏收起时显示为
窄轨图标。

## 凭据（全自动）

无需粘贴任何 token。两家都复用桌面 App 的登录状态，过期后自动续期：

- **WorkBuddy**：读取 WorkBuddy 桌面端的明文凭据文件（与 dsh-workbuddy-connect 同源），
  通过官方端点自动刷新，`X-Refresh-Token` 自动轮转。
- **TRAE**：读取桌面端抓取的 ideToken（`<appDir>/trae-auth.json` 或
  `~/.dsh/.trae-auth.json`，与 dsh-trae-connect 同路径），通过 OAuth ExchangeToken
  自动刷新。

手动提供的 token 参与「新者胜」比较，而不是无条件优先——防止过期的网页 token 挡住新鲜的
桌面凭据。卡片的设置页会显示各家凭据来源；拉取失败时展示上游返回的具体错误。若两个来源都
不可用，登录对应桌面 App 后刷新即可。

## 使用方法

1. 安装并重启 `dsh web`（见上文）。
2. 点击侧边栏底部入口：卡片展开，显示两家的积分与签到状态。
3. 点击某家的签到按钮，立即领取当日奖励。
4. 打开卡片的设置页：查看凭据来源、失败时的上游错误原文，并配置每日自动签到时间
   （HH:mm，默认 09:00，存于 `~/.dsh-points-checkin/settings.json`）。

## 说明

- host 半区：签到编排（状态、领取、启动补签、每日调度）、token 存储、本地 bridge；
  上游接口细节全部隔离在 `src/host/trae.ts` 和 `src/host/workbuddy.ts`。
- client 半区：侧边栏底部入口 + 可展开卡片；请求优先走网关代理路径，否则走本地 bridge
  （端口探测带重试，CORS 与 Private-Network 预检由 host 处理），非 localhost 来源会被
  bridge 拒绝。
- WorkBuddy 积分为官方算法（各权益包 CycleCapacityRemain 求和）；TRAE 积分为积分账本的
  总额减去已消耗（与网页控制台一致）。
- 代码、注释、文档与提交信息不使用 emoji。

## 常见问题

- **某家显示凭据错误。** 登录对应桌面 App（WorkBuddy 或 TRAE）后刷新页面——凭据会自动
  重新读取。
- **签到报 10001 但积分到账了。** WorkBuddy 的 status 接口偶尔在领取成功后仍报「未签」，
  插件把 10001 当作成功并以领取结果为准。
- **远程访问时卡片连不上 bridge。** 页面必须经转发 `/points-checkin/*` 的代理提供
  （dsh-bridge-gateway 的直连网关可以）；普通局域网/隧道访问回落到 127.0.0.1 bridge，
  而它只存在于宿主机上。

## 许可

MIT

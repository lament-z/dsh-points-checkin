# dsh-points-checkin

DSH 插件：在 DSH 侧边栏里完成 WorkBuddy 和 TRAE 的积分查看与每日签到。侧边栏底部 Settings 旁多一个入口，点开是一张可展开的卡片：显示两家当前积分、今日签到状态和一键签到按钮。卡片的设置页展示各家凭据来源（自动获取，无需粘贴任何 token）、拉取失败时的具体上游原因，以及每日自动签到时间。host 半区在 DSH 启动时执行补签，并在设定时间运行每日调度，未签的服务无需手动操作即可领取。

上游 API（`api.trae.cn`、WorkBuddy 计量服务）都不返回 CORS 头，浏览器半区无法直连；host 半区在 127.0.0.1 上起一个本地 bridge（端口 27182-27191），面板自动探测并调用。token 由 host 存放在 `~/.dsh-points-checkin/credentials.json`（权限 0600，不写日志）。

## 要求

- DSH `>=0.1.1-rc.1`（构建与测试基于 0.1.1-rc.2）。
- TRAE 和/或 WorkBuddy 的 token（获取方式见下）。

## 安装

```sh
# 从 GitHub 安装（无需 clone，lib 预构建产物已入库）
dsh plugin --profile web add github:lament-z/dsh-points-checkin

# 或从本地目录安装
dsh plugin --profile web add link:<本目录>
```

然后重启 `dsh web` 并刷新页面。入口出现在侧边栏底部 Settings 旁；侧边栏收起时显示为窄轨图标。

## 凭据（全自动）

无需粘贴任何 token。两家都复用桌面 App 的登录状态，过期后自动续期：

- **WorkBuddy**：读取 WorkBuddy 桌面端的明文凭据文件（与 dsh-workbuddy-connect 同源），通过官方端点自动刷新。
- **TRAE**：读取桌面端抓取的 ideToken（`<appDir>/trae-auth.json` 或 `~/.dsh/.trae-auth.json`，与 dsh-trae-connect 同路径），通过 OAuth ExchangeToken 自动刷新。

卡片的设置页会显示各家凭据来源；拉取失败时展示上游返回的具体错误。若两个来源都不可用，登录对应桌面 App 后刷新即可。

## 说明

- host 半区：签到编排（状态、领取、启动补签）、token 存储、本地 bridge；上游接口细节全部隔离在 `src/host/trae.ts` 和 `src/host/workbuddy.ts`。
- client 半区：侧边栏底部入口 + 可展开卡片；所有请求走 host bridge（端口探测带重试，CORS 与 Private-Network 预检由 host 处理），非 localhost 来源会被 bridge 拒绝。
- WorkBuddy 积分为官方算法（各权益包 CycleCapacityRemain 求和）；TRAE 积分为积分账本的总额减去已消耗（与网页控制台一致）。
- 代码、注释、文档与提交信息不使用 emoji。

## 许可

MIT

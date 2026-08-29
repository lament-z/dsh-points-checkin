# dsh-points-checkin

DSH 插件：在 DSH 侧边栏里完成 WorkBuddy 和 TRAE 的积分查看与每日签到。侧边栏底部 Settings 旁多一个入口，点开是一张可展开的卡片：显示两家当前积分、今日签到状态和一键签到按钮，token 设置也在同一张卡片里。host 半区在 DSH 启动时执行补签，当天还没签的服务会自动领取。

上游 API（`api.trae.cn`、WorkBuddy 计量服务）都不返回 CORS 头，浏览器半区无法直连；host 半区在 127.0.0.1 上起一个本地 bridge（端口 27182-27191），面板自动探测并调用。token 由 host 存放在 `~/.dsh-points-checkin/credentials.json`（权限 0600，不写日志）。

## 要求

- DSH `>=0.1.1-rc.1`（构建与测试基于 0.1.1-rc.2）。
- TRAE 和/或 WorkBuddy 的 token（获取方式见下）。

## 安装

```sh
dsh plugin --profile web add link:<本目录>
```

然后重启 `dsh web` 并刷新页面。入口出现在侧边栏底部 Settings 旁；侧边栏收起时显示为窄轨图标。

## 获取 token

插件只保存 token，不实现第三方登录。

- **WorkBuddy**（Bearer token）：浏览器打开 `https://www.codebuddy.cn/profile/plan`，用与 WorkBuddy 客户端相同的腾讯账号登录，DevTools > Network 面板里找任意 `/billing/meter/...` 请求，复制 `Authorization: Bearer <token>` 请求头（如存在 `X-User-Id` 一并复制）。
- **TRAE**（Cloud-IDE-JWT token）：浏览器打开 `https://www.trae.cn` 并登录，DevTools > Network 面板里找发往 `api.trae.cn` 的请求，复制 `authorization: Cloud-IDE-JWT <token>` 头的值。

把两家 token 粘进卡片的设置区并保存，面板会立即探测并显示各自状态。token 过期时卡片会标记失效，重新复制一次即可。

## 说明

- host 半区：签到编排（状态、领取、启动补签）、token 存储、本地 bridge；上游接口细节全部隔离在 `src/host/trae.ts` 和 `src/host/workbuddy.ts`。
- client 半区：侧边栏底部入口 + 可展开卡片；所有请求走 host bridge（端口探测带重试，CORS 与 Private-Network 预检由 host 处理），非 localhost 来源会被 bridge 拒绝。
- WorkBuddy 的积分数字目前从计量响应中启发式解析（确切余额字段尚未确认）；解析失败时卡片显示占位符，原始数据仍可通过 `/state` 获取。
- 代码、注释、文档与提交信息不使用 emoji。

## 许可

MIT

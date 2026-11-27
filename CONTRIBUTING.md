# 参与贡献

谢谢来看。这是个个人项目，但 issue 和 PR 都欢迎。

## 提 issue

- **bug**：贴 Aurabot 日志里相关的那几行（模块启动行 + 报错），说清你的环境
  （Windows 版本、Aurabot / 插件版本、模块版本）。
- **功能建议**：说清想要的效果，以及现在用什么代替。
- **安全问题**：别开公开 issue，直接私下提。

## 提 PR

1. 一个 PR 只做一件事，标题写清「改了什么」。
2. 保持模块 `api: 1` 兼容，别改别人的模块 id。
3. **不要写死路径**：要用的路径走 `modules/voice/paths.mjs` 那套（配置 → 环境变量 → 自动探测）。
4. 别把密钥、cookie、token、个人路径、聊天记录带进仓库；提交前跑一遍敏感扫描。
5. 改动说明写进 `CHANGELOG.md` 的 `[Unreleased]`。

## 代码约定

- 模块是一个 ESM 文件（或一个目录 + `index.mjs`），导出 `default { id, name, version, api, setup(api) }`。
- 能用 `api.lazy()` / `api.use()` 就别在顶层 import 宿主内部模块。
- 日志用 `api.log.*`，别 `console.log`。
- 出错就 `return { ok: false, error }`，别让一个模块把整个宿主带崩。

## 提交前自检

```powershell
powershell -File install.ps1 -DryRun    # 依赖是否齐
git diff --cached                       # 有没有夹带私货
```

## 许可

提交的代码默认按 MIT 授权（`modules/douyin` 按它原有的 MIT，见 `NOTICE-douyin.md`）。

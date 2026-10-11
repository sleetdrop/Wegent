# Fork 专用：只构建 Linux 安装包做真机验证

这个分支只存在于个人 fork，**不要合入上游**。它把上游
`.github/workflows/wework-app.yml` 调整为：在没有 Release GitHub App 凭据、
没有 Apple/Windows 签名证书的 fork 上，也能跑出一条 Linux-only 的安装包构建。

相对上游的三处差异：

1. `Create release app token` 改用默认 `github.token`，不再调用
   `actions/create-github-app-token`。
2. `build` 矩阵只保留 `Linux x64`（`ubuntu-24.04`）和 `Linux arm64`
   （`ubuntu-24.04-arm`）。
3. 其余流程不动：`publish_release=false` 时不创建 Release、不推版本提交、
   不推进滚动更新通道，只上传 Actions artifact。

## 触发与取件

```bash
gh workflow run "Wework App" --repo <fork-owner>/Wegent \
  --ref chore/fork-linux-release-testing -f channel=beta -f publish_release=false
gh run watch --repo <fork-owner>/Wegent

gh run download <run-id> --repo <fork-owner>/Wegent \
  -n wework-<version>-linux-x64 -D dist-x64
gh run download <run-id> --repo <fork-owner>/Wegent \
  -n wework-<version>-linux-arm64 -D dist-arm64
```

## 注意事项

- fork 不复制上游 tag，版本号会从 `0.0.1-beta.1` 起算，只是测试包，不是真实版本。
- 每条 Linux 腿都会执行校验步骤：安装 deb、断言元数据与安装布局、图标集、
  AppArmor profile，再用真实 Electron 跑 `release-package-startup`。
  CI 绿了即等价于"能装、能启动"。
- 产物跟随上游 Linux 构建基线：Ubuntu 24.04（`wegent-executor` 需要
  `GLIBC_2.39`）。要在 Ubuntu 22.04 上验证，需要本机自建，或把矩阵钉到
  `ubuntu-22.04` / `ubuntu-22.04-arm`。
- Actions artifact 即使仓库公开也需要登录后才能下载。

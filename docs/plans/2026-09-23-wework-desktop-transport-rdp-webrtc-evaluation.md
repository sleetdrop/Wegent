---
sidebar_position: 1
created: 2026-09-23
---

# Wework 云桌面：更高上限协议的调研（暂缓）

> 状态：暂缓归档。结论：不在客户端侧解决，也不由平台强推重型镜像。恢复条件见文末。

## 结论

- 云桌面（noVNC + TigerVNC）的 lag 不在客户端：noVNC 解码在 Chromium 下通常不是瓶颈，开销在网络与编码（RFB 帧缓冲差分 + zlib/JPEG、WAN RTT、代理跳数）。客户端可调的量有界，PR #3456 已覆盖（quality/compression/DPR/resize/H.264 开关）。
- hypervisor 控制台层普遍仍停在 VNC/SPICE；RDP 不是 hypervisor 协议，更好的体验来自独立流化层或 guest 内。
- 由平台强推专有/更重的镜像，对自行构建工作流的自托管组织有侵入性。正确边界是默认 VNC + 能力位 + 扩展点。

## 已确认事实

### 仓库侧可复用的、与协议无关的抽象（PR #3456）

| 能力 | 位置 |
| --- | --- |
| 能力位 `desktop.protocol/transport/clipboard` | `RuntimeDesktopFeatures`（`protocol: Literal["rfb"]`、`transport: Literal["websocket"]`） |
| 会话 + 一次性 ticket + Redis 撤销 | `POST /api/devices/{id}/vnc`、`vnc_session_service`、`vnc_websocket_middleware` |
| 设备侧 WS→本地端口透明转发 | `executor/src/local/session_gateway.rs::proxy_vnc_websocket` |
| 隔离 surface + Electron `webview` 策略 | `isolated-surfaces.json`、`vnc-surface-preload` |
| 剪贴板 lease | `vncClipboard.*` |

换协议只需替换编码器/解码器并扩宽 `protocol`，鉴权与会话生命周期可复用。

### hypervisor 控制台现状（2026-09）

| 平台 | 图形控制台 |
| --- | --- |
| OpenStack | 默认 noVNC；SPICE 需显式关闭 VNC 才启用；CLI 有 spice/rdp/serial 类型，RDP 为驱动特例 |
| Proxmox VE 9.x | HTML5 控制台默认 noVNC；SPICE 需原生 Remote Viewer + `.vv`，浏览器不能直连 |
| Incus / LXD | VM 图形控制台为 SPICE over WebSocket（管理面代理），guest 无需 SPICE server |
| oVirt / RHV | SPICE + noVNC |
| KubeVirt | VNC |

- SPICE 浏览器端 `spice-html5` 官方标注为原型（缺音频/视频/agent）；H.264 仅在原生客户端且默认 MJPEG。
- KasmVNC 1.5.0（2026-07 发布说明）支持 H.264/H.265/AV1 + WebCodecs + WebRTC UDP；2026-04 Proxmox 与 Kasm 宣布合作，Kasm 作为 Proxmox 之上的流化层（非 Proxmox 原生）。

### 许可事实

- 当前设备镜像已安装 TigerVNC（GPL-2.0），XFCE 等为 GPL/LGPL：镜像包含 GPL-2.0 组件是现状。
- 许可：KasmVNC GPL-2.0；Selkies MPL-2.0；IronRDP MIT OR Apache-2.0；Guacamole Apache-2.0。
- GPL 义务绑定"分发含 GPL 二进制的产物"，与仓库 License、产物归属标签无关；容器内独立进程通常算聚合。

### 候选（仅列已确认的能力与限制）

| 方案 | 许可 | 已确认能力 | 已确认限制 |
| --- | --- | --- | --- |
| RDP + IronRDP(WASM) | MIT/Apache | 客户端支持 raw/RLE/RDP6/RemoteFX；可编 WASM | 未见客户端 AVC/H.264 解码（IronRDP issue #1158）；RDP 需凭据 |
| KasmVNC | GPL-2.0 | H.264/H.265/AV1、WebCodecs、WebRTC | 与现有 TigerVNC 同许可档 |
| Selkies | MPL-2.0 | WebSockets(WebCodecs) 与 WebRTC 两种传输；`PIXELFLUX_ENABLE_GPL=0` 用 OpenH264 去 GPL | 需在设备侧运行其服务 |
| Guacamole | Apache-2.0 | guacd + web client | 需 guacd(C/FreeRDP) + Java Web 应用；H.264 需自行 `--enable-h264` 编译 |

### 边界内、不碰镜像的已确认项

- TCP_NODELAY：PR #3456 的 executor 入站与上游、Backend `websockets` asyncio 均未设置（已作为评论提交）。
- 直连设备 gateway（与 #3702 "report reachable executor gateway endpoint" 协同）。
- #3456 的客户端档位（quality/DPR/resize/后台 suspend）。
- 分跳诊断（客户端 / 服务端编码 / 网络）。

## 未确认（需实测，本次未做）

- IronRDP 客户端解码 xrdp 的实际画质。
- 无 GPU 设备侧运行流化层的 CPU 预算。
- Web 端 Safari 的 WebCodecs H.264 兼容性。
- Nevis/云设备 Provider 是否提供 rdp 或流化能力。

## 恢复触发条件

- 开源 hypervisor/私有云控制台普遍原生提供优于 VNC 且默认好配的协议；
- 主流开源流化层的预置成本显著下降；
- AI agent 推动 hypervisor GUI 在 to C 场景普遍优化。

# Process manager for Wework (parked reference)

Status: **parked**. This branch is a working reference, not a change intended
for review or merge in its current form. It is kept so the work and the
findings below are not lost.

## Why it is parked

The first implementation proved the concept but is not the shape we want to
ship. It grew the application menu change and mixed three concerns in one
place: process collection, a bespoke window, and menu wiring. We want to
implement it properly, with its own design and tests, on its own branch.

## What is already established

- Electron exposes per-process metrics through `app.getAppMetrics()`
  (`pid`, `type`, `serviceName`/`name`, `cpu.percentCPUUsage`,
  `cpu.idleWakeupsPerSecond`, `memory`, `creationTime`, `sandboxed`).
- Electron has **no public API** to open Chromium's built-in Task Manager
  (electron/electron#45110 is still open). Any "Task Manager"-style window in
  an Electron app is a re-implementation on top of those metrics. VS Code and
  the Codex desktop app both do exactly that.
- This repository already collects a process tree at
  `wework/electron/src/host/process-diagnostics.ts`
  (`getElectronProcessSnapshot`): it runs `ps -axo pid=,ppid=,rss=,pcpu=,command=`
  on macOS, builds the descendant tree, and classifies each process
  (main / gpu / networking / renderer / executor / codex-app-server / child).
  That function is the reusable core; the UI and window are the thinner part.
- The current reference implementation only supports macOS (the collector
  throws elsewhere).

## Direction for the real implementation

Treat the process manager as a **standalone component** rather than an
application-specific screen:

- Ship it as a self-contained package with a small interface so that any
  Electron app can embed it, including apps that use Electron only for the UI
  while running several unrelated child processes.
- Let the host **inject its own processes** on top of the Electron metrics, so
  a product can group and label internal processes it knows about (for example
  an executor or an agent runtime) instead of showing raw command lines.
- Keep the safety rule: only disposable helper processes may be ended, the
  application process is rejected by the host as well as the UI, and ending a
  process that owns live user work is never offered.
- Prefer official Electron metrics over parsing `ps` where possible so the
  behaviour is portable; keep the `ps` path only as a fallback for the process
  metadata Electron does not report.

## What this branch contains

- `wework/electron/src/host/process-diagnostics.ts`: adds a `terminable` flag,
  `isTerminableProcessGroup`, and `endDiagnosticProcess` with the guard that
  refuses the application process and non-terminable groups.
- `wework/electron/src/main.ts`: a `process-manager` auxiliary window.
- `wework/electron/src/host/electron-capabilities.ts`: `diagnostics.processSnapshot`,
  `diagnostics.endProcess`, and `developer.openProcessManager` capabilities.
- `wework/src/pages/ProcessManagerPage.tsx`: a table with CPU, memory, and PID,
  and an "End Task" action only for terminable processes.
- Application menu entry under Help → Developer tools.

It builds on top of `feature/wework-application-menu` because it reuses that
branch's application menu and capability plumbing.

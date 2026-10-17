import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ProcessDiagnosticsProcess {
  pid: number
  ppid: number
  group: string
  rss_kib: number
  physical_footprint_kib: number
  cpu_percent: number
  command: string
  /**
   * Whether the process manager may offer "End Task" for this process.
   * Only disposable Chromium helper processes qualify; the application's own
   * browser process and renderer (window) processes never do, because ending
   * them would terminate the app or discard a window's live work.
   */
  terminable: boolean
}

export interface ProcessDiagnosticsGroup {
  group: string
  process_count: number
  rss_kib: number
  physical_footprint_kib: number
  cpu_percent: number
  pids: number[]
}

export interface ProcessDiagnosticsSnapshot {
  timestamp_ms: number
  main_pid: number
  groups: ProcessDiagnosticsGroup[]
  processes: ProcessDiagnosticsProcess[]
}

interface RawProcessInfo {
  pid: number
  ppid: number
  rss_kib: number
  cpu_percent: number
  command: string
}

export function parseProcessSnapshotLine(line: string): RawProcessInfo | null {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/)
  if (!match) return null
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    rss_kib: Number(match[3]),
    cpu_percent: Number(match[4]),
    command: match[5],
  }
}

export function collectDescendantProcessIds(
  processes: RawProcessInfo[],
  roots: number[]
): Set<number> {
  const childrenByParent = new Map<number, number[]>()
  for (const processInfo of processes) {
    const children = childrenByParent.get(processInfo.ppid) ?? []
    children.push(processInfo.pid)
    childrenByParent.set(processInfo.ppid, children)
  }

  const descendants = new Set<number>()
  const pending = [...roots]
  while (pending.length > 0) {
    const pid = pending.pop()
    if (pid === undefined || descendants.has(pid)) continue
    descendants.add(pid)
    pending.push(...(childrenByParent.get(pid) ?? []))
  }
  return descendants
}

export function classifyElectronProcess(processInfo: RawProcessInfo, mainPid: number): string {
  if (processInfo.pid === mainPid) return 'main'
  if (processInfo.command.includes('wegent-executor')) return 'executor'
  if (processInfo.command.includes('codex') && processInfo.command.includes('app-server')) {
    return 'codex-app-server'
  }
  if (processInfo.command.includes('--type=renderer')) return 'webkit-webcontent'
  if (processInfo.command.includes('--type=gpu-process')) return 'webkit-gpu'
  if (processInfo.command.includes('network.mojom.NetworkService')) {
    return 'webkit-networking'
  }
  if (processInfo.command.includes('--type=utility')) return 'webkit-other'
  return 'child'
}

/**
 * Only disposable Chromium helpers can be ended from the process manager.
 * Web content (window) processes are excluded even though they are technically
 * killable: each one owns a live workbench window, so ending it would discard
 * unsaved work and interrupt any running task.
 */
const TERMINABLE_GROUPS = new Set(['webkit-gpu', 'webkit-networking', 'webkit-other'])

export function isTerminableProcessGroup(group: string): boolean {
  return TERMINABLE_GROUPS.has(group)
}

export interface EndProcessResult {
  pid: number
  terminated: boolean
}

/**
 * Ends a single, disposable helper process. The main process pid is rejected
 * here as a second line of defence so a stale or spoofed request can never
 * terminate the application itself.
 */
export async function endDiagnosticProcess(
  pid: number,
  group: string,
  mainPid = process.pid
): Promise<EndProcessResult> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('Invalid process id')
  }
  if (pid === mainPid) {
    throw new Error('The application process cannot be ended')
  }
  if (!isTerminableProcessGroup(group)) {
    throw new Error('This process cannot be ended from the process manager')
  }
  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'])
  } else {
    process.kill(pid, 'SIGKILL')
  }
  return { pid, terminated: true }
}

export async function getElectronProcessSnapshot(
  mainPid = process.pid
): Promise<ProcessDiagnosticsSnapshot> {
  if (process.platform !== 'darwin') {
    throw new Error('Process diagnostics are currently available only on macOS')
  }
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,command='])
  const allProcesses = stdout
    .split('\n')
    .map(parseProcessSnapshotLine)
    .filter((value): value is RawProcessInfo => value !== null)
  const relatedProcessIds = collectDescendantProcessIds(allProcesses, [mainPid])
  const processes = allProcesses
    .filter(processInfo => relatedProcessIds.has(processInfo.pid))
    .map(processInfo => {
      const group = classifyElectronProcess(processInfo, mainPid)
      return {
        ...processInfo,
        group,
        physical_footprint_kib: processInfo.rss_kib,
        terminable: isTerminableProcessGroup(group),
      }
    })
    .sort((left, right) => right.physical_footprint_kib - left.physical_footprint_kib)

  const groupsByName = new Map<string, ProcessDiagnosticsGroup>()
  for (const processInfo of processes) {
    const group = groupsByName.get(processInfo.group) ?? {
      group: processInfo.group,
      process_count: 0,
      rss_kib: 0,
      physical_footprint_kib: 0,
      cpu_percent: 0,
      pids: [],
    }
    group.process_count += 1
    group.rss_kib += processInfo.rss_kib
    group.physical_footprint_kib += processInfo.physical_footprint_kib
    group.cpu_percent += processInfo.cpu_percent
    group.pids.push(processInfo.pid)
    groupsByName.set(processInfo.group, group)
  }

  return {
    timestamp_ms: Date.now(),
    main_pid: mainPid,
    groups: [...groupsByName.values()].sort(
      (left, right) => right.physical_footprint_kib - left.physical_footprint_kib
    ),
    processes,
  }
}

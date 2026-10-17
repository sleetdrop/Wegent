import { describe, expect, it } from 'vitest'
import {
  classifyElectronProcess,
  collectDescendantProcessIds,
  endDiagnosticProcess,
  isTerminableProcessGroup,
  parseProcessSnapshotLine,
} from './process-diagnostics.js'

describe('Electron process diagnostics', () => {
  it('parses ps output without losing command arguments', () => {
    expect(
      parseProcessSnapshotLine(
        ' 123  45 6789  12.5 /Applications/WeWork.app/Contents/MacOS/WeWork --flag value'
      )
    ).toEqual({
      pid: 123,
      ppid: 45,
      rss_kib: 6789,
      cpu_percent: 12.5,
      command: '/Applications/WeWork.app/Contents/MacOS/WeWork --flag value',
    })
  })

  it('collects the complete Electron process tree', () => {
    const processes = [
      { pid: 10, ppid: 1, rss_kib: 1, cpu_percent: 0, command: 'main' },
      { pid: 11, ppid: 10, rss_kib: 1, cpu_percent: 0, command: 'renderer' },
      { pid: 12, ppid: 11, rss_kib: 1, cpu_percent: 0, command: 'worker' },
      { pid: 20, ppid: 1, rss_kib: 1, cpu_percent: 0, command: 'unrelated' },
    ]

    expect([...collectDescendantProcessIds(processes, [10])].sort()).toEqual([10, 11, 12])
  })

  it('preserves the established desktop E2E process group names', () => {
    const processInfo = (pid: number, command: string) => ({
      pid,
      ppid: 10,
      rss_kib: 1,
      cpu_percent: 0,
      command,
    })

    expect(classifyElectronProcess(processInfo(10, 'WeWork'), 10)).toBe('main')
    expect(classifyElectronProcess(processInfo(11, 'Electron Helper --type=renderer'), 10)).toBe(
      'webkit-webcontent'
    )
    expect(
      classifyElectronProcess(
        processInfo(12, 'Electron Helper --utility-sub-type=network.mojom.NetworkService'),
        10
      )
    ).toBe('webkit-networking')
    expect(classifyElectronProcess(processInfo(13, '/bin/wegent-executor'), 10)).toBe('executor')
  })

  it('only marks disposable Chromium helpers as terminable', () => {
    expect(isTerminableProcessGroup('webkit-gpu')).toBe(true)
    expect(isTerminableProcessGroup('webkit-networking')).toBe(true)
    expect(isTerminableProcessGroup('webkit-other')).toBe(true)
    expect(isTerminableProcessGroup('main')).toBe(false)
    expect(isTerminableProcessGroup('webkit-webcontent')).toBe(false)
    expect(isTerminableProcessGroup('executor')).toBe(false)
    expect(isTerminableProcessGroup('codex-app-server')).toBe(false)
  })

  it('refuses to end the application process or a non-terminable group', async () => {
    await expect(endDiagnosticProcess(10, 'main', 10)).rejects.toThrow(
      'The application process cannot be ended'
    )
    await expect(endDiagnosticProcess(11, 'webkit-webcontent', 10)).rejects.toThrow(
      'This process cannot be ended from the process manager'
    )
    await expect(endDiagnosticProcess(0, 'webkit-gpu', 10)).rejects.toThrow('Invalid process id')
  })
})

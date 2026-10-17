import { useCallback, useEffect, useRef, useState } from 'react'
import { invokeDesktopHost } from '@/api/dsh/desktopHost'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

interface ProcessSnapshotProcess {
  pid: number
  ppid: number
  group: string
  rss_kib: number
  physical_footprint_kib: number
  cpu_percent: number
  command: string
  terminable: boolean
}

interface ProcessSnapshot {
  timestamp_ms: number
  main_pid: number
  processes: ProcessSnapshotProcess[]
}

const REFRESH_INTERVAL_MS = 2000

function formatMemory(kib: number): string {
  if (kib >= 1024 * 1024) return `${(kib / (1024 * 1024)).toFixed(1)} GB`
  if (kib >= 1024) return `${(kib / 1024).toFixed(1)} MB`
  return `${kib} KB`
}

function processTestId(pid: number): string {
  return `process-manager-row-${pid}`
}

/**
 * Standalone process manager window. It mirrors the process tree Electron
 * exposes for this application and only offers "End Task" for disposable
 * helper processes; the host rejects anything else.
 */
export function ProcessManagerPage() {
  const { t } = useTranslation('common')
  const [snapshot, setSnapshot] = useState<ProcessSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingPid, setPendingPid] = useState<number | null>(null)
  const [confirmPid, setConfirmPid] = useState<number | null>(null)
  const loadSequence = useRef(0)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    try {
      const next = await invokeDesktopHost<ProcessSnapshot>('diagnostics.processSnapshot')
      if (loadSequence.current !== sequence) return
      setSnapshot(next)
      setError(null)
    } catch (loadError) {
      if (loadSequence.current !== sequence) return
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [load])

  const endProcess = useCallback(
    async (process: ProcessSnapshotProcess) => {
      setConfirmPid(null)
      setPendingPid(process.pid)
      try {
        await invokeDesktopHost('diagnostics.endProcess', {
          pid: process.pid,
          group: process.group,
        })
      } catch (endError) {
        setError(endError instanceof Error ? endError.message : String(endError))
      } finally {
        setPendingPid(null)
        void load()
      }
    },
    [load]
  )

  const processes = [...(snapshot?.processes ?? [])].sort(
    (left, right) => right.physical_footprint_kib - left.physical_footprint_kib
  )

  return (
    <div
      data-testid="process-manager-window"
      className="flex h-screen flex-col bg-background text-text-primary"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold">{t('process_manager.title')}</div>
          <div className="mt-0.5 text-xs text-text-muted">{t('process_manager.subtitle')}</div>
        </div>
        <button
          type="button"
          data-testid="process-manager-refresh"
          onClick={() => void load()}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
        >
          {t('process_manager.refresh')}
        </button>
      </header>

      {error ? (
        <div
          data-testid="process-manager-error"
          className="border-b border-border bg-surface px-4 py-2 text-xs text-text-secondary"
        >
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto" data-testid="process-manager-list">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-surface text-xs text-text-secondary">
            <tr>
              <th className="px-4 py-2 text-left font-medium">
                {t('process_manager.column_task')}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t('process_manager.column_cpu')}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t('process_manager.column_memory')}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t('process_manager.column_pid')}
              </th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {processes.map(process => (
              <tr
                key={process.pid}
                data-testid={processTestId(process.pid)}
                className="border-b border-border/60"
              >
                <td className="px-4 py-2">
                  <span className="font-medium">{t(`process_manager.group.${process.group}`)}</span>
                  {process.pid === snapshot?.main_pid ? (
                    <span className="ml-2 text-xs text-text-muted">
                      {t('process_manager.application_process')}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {process.cpu_percent.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMemory(process.physical_footprint_kib)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{process.pid}</td>
                <td className="px-4 py-2 text-right">
                  {process.terminable ? (
                    confirmPid === process.pid ? (
                      <span className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          data-testid={`process-manager-confirm-${process.pid}`}
                          onClick={() => void endProcess(process)}
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                        >
                          {t('process_manager.confirm')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmPid(null)}
                          className="rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-muted"
                        >
                          {t('common.cancel')}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        data-testid={`process-manager-end-${process.pid}`}
                        disabled={pendingPid !== null}
                        onClick={() => setConfirmPid(process.pid)}
                        className={cn(
                          'rounded-md border border-border px-2 py-1 text-xs hover:bg-muted',
                          pendingPid === process.pid && 'opacity-50'
                        )}
                      >
                        {t('process_manager.end_task')}
                      </button>
                    )
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

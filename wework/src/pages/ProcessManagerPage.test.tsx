import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ProcessManagerPage } from './ProcessManagerPage'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))
vi.mock('@/api/dsh/desktopHost', () => ({ invokeDesktopHost: mocks.invoke }))
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function snapshot() {
  return {
    timestamp_ms: 1,
    main_pid: 100,
    processes: [
      {
        pid: 100,
        ppid: 1,
        group: 'main',
        rss_kib: 2048,
        physical_footprint_kib: 2048,
        cpu_percent: 1.2,
        command: 'Wework',
        terminable: false,
      },
      {
        pid: 200,
        ppid: 100,
        group: 'webkit-gpu',
        rss_kib: 1024,
        physical_footprint_kib: 1024,
        cpu_percent: 5.5,
        command: 'Electron Helper --type=gpu-process',
        terminable: true,
      },
      {
        pid: 300,
        ppid: 100,
        group: 'webkit-webcontent',
        rss_kib: 512,
        physical_footprint_kib: 512,
        cpu_percent: 0.4,
        command: 'Electron Helper --type=renderer',
        terminable: false,
      },
    ],
  }
}

describe('ProcessManagerPage', () => {
  beforeEach(() => vi.clearAllMocks())

  test('renders each process with memory and CPU', async () => {
    mocks.invoke.mockResolvedValue(snapshot())
    render(<ProcessManagerPage />)

    expect(await screen.findByTestId('process-manager-row-200')).toBeTruthy()
    expect(screen.getByTestId('process-manager-row-100')).toBeTruthy()
    expect(screen.getByTestId('process-manager-row-300')).toBeTruthy()
    expect(mocks.invoke).toHaveBeenCalledWith('diagnostics.processSnapshot')
  })

  test('offers End Task only for terminable processes', async () => {
    mocks.invoke.mockResolvedValue(snapshot())
    render(<ProcessManagerPage />)

    expect(await screen.findByTestId('process-manager-end-200')).toBeTruthy()
    expect(screen.queryByTestId('process-manager-end-100')).toBeNull()
    expect(screen.queryByTestId('process-manager-end-300')).toBeNull()
  })

  test('requires confirmation before ending a process', async () => {
    mocks.invoke.mockResolvedValue(snapshot())
    render(<ProcessManagerPage />)

    const endButton = await screen.findByTestId('process-manager-end-200')
    endButton.click()
    expect(mocks.invoke).not.toHaveBeenCalledWith('diagnostics.endProcess', expect.anything())

    const confirmButton = await screen.findByTestId('process-manager-confirm-200')
    confirmButton.click()
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('diagnostics.endProcess', {
        pid: 200,
        group: 'webkit-gpu',
      })
    )
  })

  test('surfaces a snapshot failure', async () => {
    mocks.invoke.mockRejectedValue(new Error('Process diagnostics require macOS'))
    render(<ProcessManagerPage />)
    expect(await screen.findByTestId('process-manager-error')).toBeTruthy()
  })
})

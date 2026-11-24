import { useCallback, useEffect, useState } from 'react'
import { Text } from '@mantine/core'
import { HelpTip } from '../help/HelpTip'
import { benchData, type BenchCall } from './benchCall'

// From gateware v65 the emulation image has no SWD, JTAG, SPI master or I2C master. The pod
// switches to the loop image by itself when no digital sensor runs; with I2C, SPI or UART
// sensors running it refuses (BP0059). These controls disable themselves in that state.

/** FPGA_FEATURES bit: the image has the bus masters (v65+: loop and deep). */
export const FPGA_FEATURE_BUS_MASTERS = 0x20
/** The first gateware without bus masters in the emulation image. */
export const BUS_MASTERS_SPLIT_MIN_GW = 65

type ImageInfo = { image?: number; name?: string; version?: number; features?: number }
type SensorStatus = { instances?: { instance?: string; kind?: string; running?: boolean }[] }

/** True when the running image is emulation without the bus masters (gateware 65 or later). */
export function emulationWithoutMasters(img: ImageInfo | undefined): boolean {
  if (!img || (img.image !== 2 && img.name !== 'emulation' && img.name !== 'emu')) return false
  if ((img.features ?? 0) & FPGA_FEATURE_BUS_MASTERS) return false
  return (img.version ?? 0) >= BUS_MASTERS_SPLIT_MIN_GW
}

/** The names of the running I2C, SPI and UART (digital) sensors. */
export function runningDigitalSensors(st: SensorStatus | undefined): string[] {
  return (st?.instances ?? []).filter((i) => i.running && i.kind !== 'analog').map((i) => i.instance ?? i.kind ?? 'sensor')
}

export type BusMasterGate = {
  /** The pod runs the emulation image and digital sensors run: SWD and the bus masters are refused. */
  blocked: boolean
  /** The sensors that block. */
  sensors: string[]
  /** Look again (after a sensor start or stop). */
  refresh: () => void
}

/**
 * Whether SWD flashing, the I2C and SPI masters, SPI flash and the expanders can start now. Pods
 * without fpga_image or sensor_status are never blocked. Re-checks every few seconds.
 */
export function useBusMasterGate(call: BenchCall, every = 5000): BusMasterGate {
  const [sensors, setSensors] = useState<string[]>([])
  const refresh = useCallback(() => {
    void (async () => {
      try {
        const img = benchData<ImageInfo>(await call('fpga_image', {}, { poll: true }))
        if (!emulationWithoutMasters(img)) return setSensors([])
        setSensors(runningDigitalSensors(benchData<SensorStatus>(await call('sensor_status', {}, { poll: true }))))
      } catch {
        setSensors([])
      }
    })()
  }, [call])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, every)
    return () => clearInterval(t)
  }, [refresh, every])
  return { blocked: sensors.length > 0, sensors, refresh }
}

/** The status line shown beside a disabled action: a label and a HelpTip, no paragraph. */
export function BusMasterNote({ gate, feature = 'SWD and the bus masters' }: { gate: BusMasterGate; feature?: string }) {
  if (!gate.blocked) return null
  return (
    <Text size="xs" c="orange" data-testid="bus-master-note">
      Stop the sensors first{' '}
      <HelpTip label="emulation image" docs="/docs/benchpod-sensors#emulation-image">
        {feature} are not in the emulation image, which runs while I2C, SPI or UART sensors do ({gate.sensors.join(', ')}). Stop the
        sensors and the pod switches to the loop image by itself (2 to 3 s). To flash and emulate, flash first, then start the sensors.
      </HelpTip>
    </Text>
  )
}

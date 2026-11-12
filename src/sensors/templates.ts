// Starting points for "New sensor": one small, valid definition per kind, and a stimulus. Each
// one compiles in the engine (templates.test.ts).
import type { DefinitionKind } from './engine'

export const TEMPLATES: Record<DefinitionKind, string> = {
  i2c: `format: 1
kind: i2c
name: my_i2c_sensor
label: "My I2C sensor: temperature"
description: |
  A starting point: a 16-bit temperature in hundredths of a degree, a config register the DUT
  can write, and an ID register.
version: 0.1.0

params:
  - { key: temperature_c, unit: C, min: -40, max: 125, default: 25, label: Temperature }

i2c:
  address: 0x48
  alt_addresses: [0x49]

let:
  - raw: "sat_s16(temperature_c * 100)"

registers:
  - { at: 0x00, s16be: "raw", name: TEMP }
  - { at: 0x02, u8: 0x00, name: CONFIG }
  - { at: 0x0F, u8: 0xA5, name: WHO_AM_I, writable: false }
`,
  spi: `format: 1
kind: spi
name: my_spi_sensor
label: "My SPI sensor: pressure"
description: |
  A starting point: a 24-bit pressure reading and an ID register. The first byte's bit 7 selects
  a read, its low 7 bits are the register.
version: 0.1.0

params:
  - { key: pressure_pa, unit: Pa, min: 30000, max: 110000, default: 101325, label: Pressure }

spi:
  mode: 0
  read_bit: { bit: 7, value: 1 }
  address_mask: 0x7F

registers:
  - { at: 0x0F, u8: 0xBD, name: WHO_AM_I, writable: false }
  - { at: 0x28, u24le: "pressure_pa / 100 * 4096", name: PRESS_OUT }
`,
  uart: `format: 1
kind: uart
name: my_uart_sensor
label: "My UART sensor: CO2"
description: |
  A starting point: prints a reading every second and answers READ? with the same value.
version: 0.1.0

params:
  - { key: co2_ppm, unit: ppm, min: 0, max: 5000, default: 420, label: CO2 }
  - { key: rate_hz, unit: Hz, min: 1, max: 10, default: 1, label: Rate }

uart: { baud: 9600, format: 8N1 }

messages:
  - every_ms: "1000 / rate_hz"
    text: "CO2={co2_ppm:d}"
    end: crlf

requests:
  - match_line: "READ?"
    text: "+READ: {co2_ppm:d}"
    end: crlf
`,
  analog: `format: 1
kind: analog
name: my_ntc
label: "My NTC thermistor: 10k, B 3950"
description: |
  A starting point: a 10k NTC in a divider with 10k to 3.3 V, read by the DUT's ADC.
version: 0.1.0

params:
  - { key: temperature_c, unit: C, min: -40, max: 125, default: 25, label: Temperature }

output: voltage
let:
  - r_ntc: "10000 * exp(3950 * (1 / (temperature_c + 273.15) - 1 / 298.15))"
value: "3.3 * r_ntc / (r_ntc + 10000)"
range: { min: 0, max: 3.3 }
`,
  stimulus: `format: 1
kind: stimulus
name: my_stimulus
rate_hz: 50
repeat: false

signals:
  temperature_c:
    - { shape: hold, value: 22, duration_s: 5 }
    - { shape: ramp, end: 35, duration_s: 30 }
    - { shape: sine, offset: 35, amplitude: 1.5, period_s: 10, duration_s: 20 }
    - { shape: step, value: 25 }

faults:
  - { at_s: 40, duration_s: 5, type: stuck }
`,
}

/** The template for a kind with its name (and label) replaced. */
export function templateFor(kind: DefinitionKind, name?: string): string {
  const t = TEMPLATES[kind]
  return name ? renameSource(t, name) : t
}

/**
 * The source with its top-level `name` changed. YAML keeps its text (only the `name:` line
 * changes, as the server's duplicate does); JSON is re-encoded.
 */
export function renameSource(source: string, name: string): string {
  if (source.trimStart().startsWith('{')) {
    try {
      const doc = JSON.parse(source) as Record<string, unknown>
      doc.name = name
      return JSON.stringify(doc, null, 2) + '\n'
    } catch {
      return source
    }
  }
  if (/^name:.*$/m.test(source)) return source.replace(/^name:.*$/m, `name: ${name}`)
  return `name: ${name}\n${source}`
}

/** `bme280` -> `bme280_copy`, then `_copy2`, ... within 32 characters. */
export function copyName(name: string, n = 1): string {
  const suffix = n <= 1 ? '_copy' : `_copy${n}`
  return name.slice(0, 32 - suffix.length) + suffix
}

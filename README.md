# benchpod-ui

The shared BenchPod frontend: the agent chat (transcript, tool calls, confirmations, composer)
and the views that draw BenchPod results (UART logs, ADC envelopes, logic captures).

It is used by:

- [benchpod-desktop](https://github.com/embeddedci-com/benchpod-desktop), the open source desktop app
- the EmbeddedCI website, for its live demo and the BenchPod AI tab

Both link this source by path, as an `@bpui` alias in their Vite and TypeScript configs, rather
than installing a package. Check it out next to them:

```
embeddedci-com/
  benchpod-ui/
  benchpod-desktop/
```

React, React DOM and Mantine are peer dependencies: the host must dedupe them (Vite
`resolve.dedupe`) so the bundle has one copy of each.

The chat speaks the protocol of the `chat` Go package in benchpod-desktop
(`src/chat/protocol.ts` describes it).

The bench controls (`src/bench/`: power, a console terminal, the generator with a waveform library, flashing a file and an SPI flash chip, updating the pod's own firmware, the pod's settings and calibration; `src/capture/`: the capture view; `src/wiring/`: the wiring profile model and editor) drive the pod by hand beside the chat.
They take a `BenchCall`: `useBenchCall(base)` posts to the host's tool endpoint, which runs the
BenchPod MCP tool under the same policy as the agent and answers `confirm` for a call that needs
the user's yes (`src/bench/benchCall.tsx` describes the protocol). Pass them to `ChatView` as
`panelControls`. The console terminal also reads the host's console log, which holds the agent's
UART traffic as well (`src/bench/ConsoleTerminal.tsx`).

`src/capture/` is the EmbeddedCI web app's capture surface, moved here so the web app and the
desktop app draw the same thing: `CaptureCanvas` (ADC, LA and DAC lanes on one time axis, drag to
zoom, decode chips), the decode tables, and `CaptureView`, which runs captures and decodes by hand
and draws the last capture from the host's copy of the BenchPod MCP server's capture resources
(`benchpod://capture/la`, `/adc`, `/decode`).

`src/wiring/model.ts` is the web app's wiring profile model (schema v1: keys, defaults, checks,
the LA channel map), and `WiringEditor` edits a profile object and hands it to the host to apply.

## Bus console

`src/bus/BusDashboard` is one page to listen to the DUT's buses and drive them: the capture view on
top, the 14 LA pins in one row (`PinStrip`, from the `la_pins` tool: wiring name, owner, which way
the DUT signal goes, level, pull and the pod's warnings), and a dock with Console, I2C and GPIO
tabs over one transaction log. The I2C tab runs `i2c_open`, `i2c_transfer`, `i2c_scan` and
`i2c_close` (gateware v55 and later); the GPIO tab the `gpio_*` tools. Every call goes through the
host's `BenchCall`, so its confirmations apply, and a refusal shows the pod's own text. The host
passes its console terminal as `renderConsole(call)`, so the console's writes are logged too.

## Sensors

`src/sensors` is the Sensors page for user-defined sensors (the format is in
[benchpod-sensors](https://github.com/embeddedci-com/benchpod-sensors), `docs/format.md`): the
library, the user's sensors and stimuli, a YAML editor checked as you type, a preview of what the
DUT reads, the run panel and the stimulus editor. A host gives it two things:

- a `SensorStore` (definitions, stimuli, the library and its version): the website implements it
  over its HTTP API, the desktop app over its local API;
- a `SensorPod` (define, start, set, stimulus, fault, stop, status, regs): `commandSensorPod`
  builds one over any function that sends one pod command, and holds every command name and
  reply shape (benchpod-firmware `docs/API.md`, "Emulated sensors"). It reads every page of
  `sensor_status`, checks instance names (1 to 16 characters of `a-z`, `0-9`, `_`) and sends
  pins as LA channel numbers: hosts resolve wiring names first.

`SensorsPage` takes `libraryScope`: `'organization'` (the default, the web app) or `'computer'`
(the desktop app), for the sentence that says who a library version choice applies to.

`fakePod` and `MemorySensorStore` stand in for both in tests and while working on a host.

The page checks and previews definitions with the pod's own engine compiled to WebAssembly,
vendored in `src/sensors/engine` with the sha256 of each file in `SHA256SUMS`. Refresh it from a
benchpod-firmware checkout with `scripts/update-sensor-engine.sh [path]` (the website's server
vendors the same `.wasm`: keep both on one firmware commit). Hosts load it as an asset
(`new URL(..., import.meta.url)`), or call `setEngineSource` first to serve it from elsewhere.

## Development

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

Licensed under the Apache License, Version 2.0.

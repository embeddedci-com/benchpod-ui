// benchpod-ui: the BenchPod agent chat and capture views, shared by the desktop app and the
// EmbeddedCI server. Linked by path (an `@bpui` alias), not published.
export * from './chat/protocol'
export * from './chat/useChat'
export { ChatView, callSummary, type ChatViewProps } from './chat/ChatView'
export { Markdown } from './chat/Markdown'
export { ResultView, TerminalText } from './results/ResultView'
export { AdcEnvelope, isAdcCapture, fmtSi, type AdcCapture } from './results/AdcEnvelope'
export { LaSummary, isLaCapture, LA_PALETTE, type LaCapture } from './results/LaSummary'
export { ToolsList, useTools, groupTools, type ToolInfo } from './chat/ToolsList'
export { BenchPanel, benchOutputs, type PanelTab, type PanelControls, type ConsoleEntry, type CaptureEntry } from './chat/BenchPanel'
export { useBenchCall, benchData, benchError, type BenchCall, type BenchResult, type BenchCallOptions } from './bench/benchCall'
export { PowerControls, type PowerStatus } from './bench/PowerControls'
export { ConsoleTerminal, type ConsoleLogEntry } from './bench/ConsoleTerminal'
export { PodUpdate, newerVersion, type PodUpdater, type PodFirmwareInfo } from './bench/PodUpdate'
export { PodSettings } from './bench/PodSettings'
export { CalibrationControls, DMM_SET_POINTS } from './bench/CalibrationControls'
export { SpiFlashControls, parseSpiAddr, hexDump } from './bench/SpiFlashControls'
export { FlashControls, type FirmwareFile, type FirmwareStore } from './bench/FlashControls'
export { GeneratorControls, parseWaveformCsv, type WaveformLibrary, type WaveformMeta } from './bench/GeneratorControls'
export { FaultControls, SegmentControls, LoopControls } from './bench/GeneratorExtras'
export * from './bench/generatorMath'
export { CaptureCanvas, useCanvasColors, type LaEdge, type LaneAnnotation, type DacTrack, type CanvasColors } from './capture/CaptureCanvas'
export {
  DecodeTable,
  I2cTable,
  UartTable,
  SpiTable,
  DECODE_ACCENT,
  decodeAnnotations,
  type DecodeResult,
  type DecodeTransaction,
  type DecodeSegment,
  type UartFrame,
  type SpiFrame,
  type DecodeRowActions,
} from './capture/DecodeTables'
export { CaptureView, type FetchCapture, type LaCaptureData, type AdcCaptureData, type DecodeData } from './capture/CaptureView'
export { BusDashboard } from './bus/BusDashboard'
export { PinStrip, pinWarnings, warnBits, ownerLabel, WARN_PULL_UNDER_PUSH_PULL, WARN_UNPOWERED_DUT, type LaPin, type LaPins } from './bus/PinStrip'
export { I2cTab, parseI2cAddr, parseHexBytes } from './bus/I2cTab'
export { GpioTab } from './bus/GpioTab'
export { SpiTab, spiPinArgs } from './bus/SpiTab'
export { CanTab, parseCanId, canDataOk } from './bus/CanTab'
export { TransactionLog } from './bus/TransactionLog'
export { captureArgs, type SendSpec, type SendResult, type SendCapture, type SendCaptureOutcome } from './bus/sendCapture'
export { i2cSendAgain, spiBursts, type SendAgain, type SendAgainRequest } from './bus/sendAgain'
export { logRow, logRows, loggedCall, canFrameText, nackWhere, type BusLogRow, type BusProto, type BusStatus } from './bus/busLog'
export { WiringEditor, WiringChannelMap } from './wiring/WiringEditor'
export {
  effectiveWiring,
  validateWiring,
  laChannelMap,
  laChannelLabel,
  WIRING_DEFAULTS,
  WIRING_ROLES,
  type Wiring,
  type WiringSignal,
  type WiringFieldIssue,
} from './wiring/model'
// Sensors: import from '@bpui/sensors'; the root re-exports them as a namespace (several names, e.g.
// FaultSpec and SegmentShape, are also generator types).
export * as sensors from './sensors'

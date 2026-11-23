// benchpod-ui: the BenchPod agent chat and capture views, shared by the desktop app and the
// EmbeddedCI server. Linked by path (an `@bpui` alias), not published.
export * from './chat/protocol'
export * from './chat/useChat'
export { ChatView, callSummary, type ChatViewProps } from './chat/ChatView'
export { Markdown } from './chat/Markdown'
export { HelpTip, docsUrl, DOCS_ORIGIN } from './help/HelpTip'
export { ResultView, TerminalText } from './results/ResultView'
export { AdcEnvelope, isAdcCapture, fmtSi, type AdcCapture } from './results/AdcEnvelope'
export { LaSummary, isLaCapture, LA_PALETTE, type LaCapture } from './results/LaSummary'
export { ToolsList, useTools, groupTools, type ToolInfo } from './chat/ToolsList'
export { BenchPanel, benchOutputs, type PanelTab, type PanelControls, type ConsoleEntry, type CaptureEntry } from './chat/BenchPanel'
export { useBenchCall, benchData, benchError, confirmLines, createConfirmStore, ConfirmDialog, type ConfirmStore, type BenchCall, type BenchResult, type BenchCallOptions } from './bench/benchCall'
export { PowerControls, type PowerStatus } from './bench/PowerControls'
export { ConsoleTerminal, type ConsoleLogEntry } from './bench/ConsoleTerminal'
export { PodUpdate, newerVersion, type PodUpdater, type PodFirmwareInfo } from './bench/PodUpdate'
export { PodSettings } from './bench/PodSettings'
export { CalibrationControls, DMM_SET_POINTS } from './bench/CalibrationControls'
export { SpiFlashControls, parseSpiAddr, hexDump } from './bench/SpiFlashControls'
export { FlashControls, type FirmwareFile, type FirmwareStore } from './bench/FlashControls'
export { EspFlashControls, FlashModes, ESP_CHIPS, espBootPin, type FlashMode } from './bench/EspFlashControls'
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
  UsbTable,
  usbChip,
  decodeRateNeed,
  type DecodeRateOptions,
  ModbusTable,
  CanTable,
  PwmTable,
  OneWireTable,
  SmbusTable,
  type ModbusFrame,
  type CanFrame,
  type PwmChannel,
  type PwmPeriod,
  type PwmStat,
  type OneWireTransaction,
  type SmbusTransaction,
  type UsbDecode,
  type UsbPacket,
  type UsbTransaction,
  type UsbTransfer,
  type DecodeResult,
  type DecodeTransaction,
  type DecodeSegment,
  type UartFrame,
  type SpiFrame,
  type DecodeRowActions,
} from './capture/DecodeTables'
export { CaptureView, type FetchCapture, type LaCaptureData, type AdcCaptureData, type DecodeData } from './capture/CaptureView'
export { BusDashboard } from './bus/BusDashboard'
export { PinStrip, useLaPins, pinWarningCount, type LaPinsState, pinWarnings, pinWarningLines, dirLabel, pullLabel, warnBits, ownerLabel, WARN_PULL_UNDER_PUSH_PULL, WARN_UNPOWERED_DUT, type LaPin, type LaPins } from './bus/PinStrip'
export { I2cTab, parseI2cAddr, parseHexBytes } from './bus/I2cTab'
export { GpioTab } from './bus/GpioTab'
export { SpiTab, spiPinArgs } from './bus/SpiTab'
export { CanTab, parseCanId, canDataOk } from './bus/CanTab'
export { TransactionLog } from './bus/TransactionLog'
export { logRow, loggedCall, nackWhere, type BusLogRow, type BusProto, type BusStatus } from './bus/busLog'
export { PinsEditor, PIN_KIND_COLORS } from './wiring/PinsEditor'
export { pinViews, assignPin, updateSignal, setPinPull, pinPullDirs, pullSwitchLabel, signalUse, nextSignalName, type PinView, type PinKind, type SignalUse } from './wiring/pins'
export { debugTransport, jtagOnlyTarget, swdWired, jtagWired, type DebugTransport } from './wiring/transport'
export { WiringDiagram, changedChannels } from './wiring/WiringDiagram'
export { BoardView, BoardViewModal } from './wiring/BoardView'
export { boardSheet, boardSvg, boardSheetHtml, sheetRows, boardHeaderFromStatus, detectBoardHeader, type PodReply, BOARD_HEADER_LABELS, HEADER_PINS, type BoardHeader, type HeaderPin, type HeaderPinKind, type BoardSheet, type SheetPin, type SheetRow } from './wiring/boardSheet'
export { WiringProfilePicker, WIRING_PROFILE_NAME_RE, MAX_WIRING_PROFILES, type WiringProfileItem, type NewProfileFrom } from './wiring/WiringProfilePicker'
export {
  effectiveWiring,
  validateWiring,
  coerceStoredWiring,
  wiringFieldErrors,
  wiringProfileJson,
  PULL_CHANNELS,
  LA_PULLS,
  pullDirections,
  canonicalPulls,
  pullSupports,
  laChannelMap,
  laChannelLabel,
  WIRING_DEFAULTS,
  WIRING_UNDEFINED,
  WIRING_VERSION,
  WIRING_ROLES,
  WIRING_DUT_DIRS,
  WIRING_DUT_DIR_LABELS,
  ROLE_DUT_DIRS,
  SIGNAL_DUT_DIRS,
  wiringDutDir,
  defaultDutDir,
  dutDirOverride,
  pinDutDirs,
  withDutDir,
  type Wiring,
  type WiringSignal,
  type UartParity,
  type WiringDutDir,
  type WiringFieldIssue,
  type PullDir,
  type WiringPulls,
  type LaPull,
} from './wiring/model'
// Sensors: import from '@bpui/sensors'; the root re-exports them as a namespace (several names, e.g.
// FaultSpec and SegmentShape, are also generator types).
export * as sensors from './sensors'
export * from './bus/sequences'

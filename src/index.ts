// benchpod-ui: the BenchPod agent chat and capture views, shared by the desktop app and the
// EmbeddedCI server. Linked by path (an `@bpui` alias), not published.
export * from './chat/protocol'
export * from './chat/useChat'
export { ChatView, callSummary, type ChatViewProps } from './chat/ChatView'
export { Markdown } from './chat/Markdown'
export { ResultView, TerminalText } from './results/ResultView'
export { AdcEnvelope, isAdcCapture, fmtSi, type AdcCapture } from './results/AdcEnvelope'
export { LaSummary, isLaCapture, LA_PALETTE, type LaCapture } from './results/LaSummary'

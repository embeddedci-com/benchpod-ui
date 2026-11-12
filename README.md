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

The bench controls (`src/bench/`: power, a console terminal, and more to come) drive the pod by hand beside the chat.
They take a `BenchCall`: `useBenchCall(base)` posts to the host's tool endpoint, which runs the
BenchPod MCP tool under the same policy as the agent and answers `confirm` for a call that needs
the user's yes (`src/bench/benchCall.tsx` describes the protocol). Pass them to `ChatView` as
`panelControls`. The console terminal also reads the host's console log, which holds the agent's
UART traffic as well (`src/bench/ConsoleTerminal.tsx`).

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

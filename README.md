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

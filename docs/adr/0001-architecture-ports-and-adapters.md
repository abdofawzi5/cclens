# ADR 0001: Ports and adapters, enforced by lint

- Status: accepted
- Date: 2026-11-19

## Context

cclens integrates with many things that change independently: Claude Code's files and hooks, ccusage, and three or more skill registries. We want to swap or add any of them without touching business logic, and to test that logic without network or disk.

## Decision

- `src/core`: domain types, port interfaces, pure logic. No I/O, no Node built-ins, no third-party SDKs (zod is allowed for validation).
- `src/app`: use-case services depending only on core ports.
- `src/adapters`: the only code allowed to touch fs, network, subprocesses, ccusage.
- `src/interfaces`: CLI, hook entry, renderers.
- `src/composition-root.ts`: the single place adapters are constructed (manual dependency injection, no container library).
- ESLint `no-restricted-imports` enforces the direction `interfaces → app → core ← adapters`. A deliberate violation was tested and is rejected.

## Consequences

More files and interfaces up front. In return, each integration is one adapter plus one contract test, and core coverage stays above 90%.

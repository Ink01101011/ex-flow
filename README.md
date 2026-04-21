# ex-flow

Priority-aware DAG execution planner for TypeScript based on Kahn's Algorithm.

`ex-flow` helps you model task dependencies and produce:

- `batches`: execution levels where nodes in the same batch can run in parallel
- `fullSequence`: flattened ordered list across all batches

Within each batch, tasks are sorted by priority (higher first).

## Features

- Deterministic topological execution planning with cycle detection
- Priority-aware ordering inside each batch
- Explicit error codes for common graph/config issues
- Configurable output cloning strategy: `shallow`, `deep`, or `custom`
- External tie-breaker support for equal priorities
- Optional scheduling constraints: concurrency caps, resource caps, deadline and weight strategies
- Scheduler telemetry via `resolveExecutionDetails()`
- Structured diagnostics via `ExFlowRuntimeError`
- Fairness controls (`aging`, `maxDeferralRounds`) for constrained throughput scheduling
- Preset profiles for enterprise-ready defaults

## Installation

```bash
pnpm add ex-flow
```

or

```bash
npm install ex-flow
```

## Quick Start

```ts
import { ExFlow, type ExNode } from "ex-flow";

type TaskData = { name: string };

const data: ExNode<TaskData>[] = [
  { id: "A", dependsOn: [], data: { name: "Task A" }, priority: 2 },
  { id: "B", dependsOn: ["A"], data: { name: "Task B" }, priority: 1 },
  { id: "C", dependsOn: ["A"], data: { name: "Task C" }, priority: 3 },
  { id: "D", dependsOn: ["B", "C"], data: { name: "Task D" }, priority: 2 },
];

const flow = new ExFlow<TaskData>();
for (const node of data) {
  flow.addEntity(node);
}

const plan = flow.resolveExecutionPlan();
console.log(plan.batches);
console.log(plan.fullSequence);
```

## API

### `new ExFlow<T>(options?)`

Creates an execution planner.

Options:

- `cloneMode?: "shallow" | "deep" | "custom"`
- `cloneFn?: (data: T) => T` (required when `cloneMode` is `custom`)
- `priorityAscending?: boolean` (default: `false`, so higher priority runs first)
- `tieBreaker?: (a, b) => number` (used when priority values are equal)
- `concurrencyCap?: number`
- `resourceCaps?: Record<string, number>`
- `deadlineStrategy?: "earliest-first" | "latest-first"`
- `weightStrategy?: "higher-first" | "lower-first"`
- `schedulerMode?: "level" | "throughput"` (default: `level`)
- `tieFallbackPolicy?: "insertion" | "id-asc" | "id-desc"` (default: `insertion`)
- `fairnessPolicy?: "none" | "aging"` (default: `none`)
- `maxDeferralRounds?: number`
- `requireResourceCapForAllClasses?: boolean`
- `presetName?: "stable-enterprise" | "high-throughput" | "strict-fairness"`

### `createExFlowConfigBuilder<T>()`

Builds `ExFlow` options with a fluent API.

Example:

```ts
import { ExFlow, createExFlowConfigBuilder } from "ex-flow";

type Task = { name: string; meta: { tags: string[] } };

const options = createExFlowConfigBuilder<Task>()
  .withPreset("high-throughput")
  .withSchedulerMode("throughput")
  .withPriorityAscending(true)
  .withTieFallbackPolicy("id-asc")
  .withFairnessPolicy("aging")
  .withMaxDeferralRounds(2)
  .withConcurrencyCap(2)
  .withResourceCaps({ cpu: 1 })
  .requireResourceCapForAllClasses()
  .withDeadlineStrategy("earliest-first")
  .withWeightStrategy("higher-first")
  .useCustomClone((data) => ({
    ...data,
    meta: { ...data.meta, tags: [...data.meta.tags] },
  }))
  .build();

const flow = new ExFlow<Task>(options);
```

`throughput` mode allows newly-ready nodes to be scheduled between constrained sub-batches,
which can improve total throughput while preserving dependency correctness.

### `resolveExecutionDetails()`

Returns both plan and scheduler metrics:

- `plan`: same shape as `resolveExecutionPlan()`
- `metrics`:
  - `schedulerMode`
  - `rounds`
  - `emittedNodes`
  - `deferredNodes`
  - `maxReadyQueueSize`
  - `constraintHits.concurrencyCap`
  - `constraintHits.resourceCaps`

### `addEntity(node)`

Adds a graph node.

- TypeScript enforces that input `data` must not declare `exFlowPriority`.
- Throws `[EXFLOW_DUPLICATE_NODE]` when `id` already exists.
- Throws `[EXFLOW_RESERVED_FIELD]` when input `data` already contains `exFlowPriority`.

You can model this explicitly with the exported `SafeTask<T>` helper type.

### `resolveExecutionPlan()`

Builds the execution plan.

- Throws `[EXFLOW_UNKNOWN_DEPENDENCY]` when a dependency id does not exist.
- Throws `[EXFLOW_CYCLE_DETECTED]` when the graph has a cycle.

Cycle errors now include a detected cycle path in the message when available.

Structured diagnostics are available through `ExFlowRuntimeError.diagnostics`.

Returns:

- `batches: ExFlowResultItem<T>[][]`
- `fullSequence: ExFlowResultItem<T>[]`

## Clone Modes and Immutability

### `shallow` (default)

Fastest mode. Top-level object is cloned, but nested references are shared.

### `deep`

Uses `structuredClone` to isolate nested references.

- Throws `[EXFLOW_DEEP_CLONE_UNAVAILABLE]` when runtime does not support `structuredClone`.

### `custom`

Uses your custom clone function.

- Throws `[EXFLOW_CUSTOM_CLONE_FN_REQUIRED]` if `cloneFn` is missing.

Example:

```ts
type Task = { name: string; meta: { tags: string[] } };

const flow = new ExFlow<Task>({
  cloneMode: "custom",
  cloneFn: (data) => ({
    ...data,
    meta: {
      ...data.meta,
      tags: [...data.meta.tags],
    },
  }),
});
```

## Error Codes

Exported as `EXFLOW_ERROR`:

- `EXFLOW_DUPLICATE_NODE`
- `EXFLOW_RESERVED_FIELD`
- `EXFLOW_UNKNOWN_DEPENDENCY`
- `EXFLOW_CYCLE_DETECTED`
- `EXFLOW_CUSTOM_CLONE_FN_REQUIRED`
- `EXFLOW_DEEP_CLONE_UNAVAILABLE`
- `EXFLOW_INVALID_OPTION`

## Compatibility Matrix

Ordering determinism and scheduling behavior by mode:

| Mode         | Ready-node release                 | Tie fallback default | Throughput profile            |
| ------------ | ---------------------------------- | -------------------- | ----------------------------- |
| `level`      | strict level-by-level              | insertion order      | predictable phase boundaries  |
| `throughput` | unlocks between constrained rounds | insertion order      | higher utilization under caps |

Tie resolution priority chain:

1. `priorityAscending` / priority value
2. `deadlineStrategy` (if set)
3. `weightStrategy` (if set)
4. `tieBreaker` (if set)
5. `tieFallbackPolicy`

## Migration Notes

Suggested upgrade path for existing consumers:

1. Preserve old behavior:

- keep `schedulerMode: "level"`
- keep `tieFallbackPolicy: "insertion"`

2. Adopt deterministic id-based fallback (optional):

- set `tieFallbackPolicy: "id-asc"`

3. Adopt throughput mode safely:

- start with `schedulerMode: "throughput"`
- add `concurrencyCap` and `resourceCaps`
- consider `fairnessPolicy: "aging"` + `maxDeferralRounds`

4. Enforce resource governance in production:

- enable `requireResourceCapForAllClasses: true`

## License

MIT

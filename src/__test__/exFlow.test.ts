import assert from "node:assert/strict";
import test from "node:test";

import { createExFlowConfigBuilder } from "../core/configBuilder";
import { getExFlowPreset } from "../core/presets";
import ExFlow from "../core/exFlow";
import ExFlowRuntimeError from "../errors/exFlowRuntimeError";
import { serializeExFlowError, toDatadogLogFields, toOpenTelemetryAttributes } from "../utils";

type Task = { name: string };

test("resolves DAG into priority-sorted batches", () => {
  const flow = new ExFlow<Task>();

  flow.addEntity({ id: "A", dependsOn: [], data: { name: "Task A" }, priority: 2 });
  flow.addEntity({ id: "B", dependsOn: ["A"], data: { name: "Task B" }, priority: 1 });
  flow.addEntity({ id: "C", dependsOn: ["A"], data: { name: "Task C" }, priority: 3 });

  const plan = flow.resolveExecutionPlan();

  assert.equal(plan.batches.length, 2);
  assert.deepEqual(
    plan.fullSequence.map((item) => item.name),
    ["Task A", "Task C", "Task B"],
  );
});

test("resolves DAG with ascending priority when priorityAscending=true", () => {
  const flow = new ExFlow<Task>({ priorityAscending: true });

  flow.addEntity({ id: "A", dependsOn: [], data: { name: "Task A" }, priority: 2 });
  flow.addEntity({ id: "B", dependsOn: ["A"], data: { name: "Task B" }, priority: 1 });
  flow.addEntity({ id: "C", dependsOn: ["A"], data: { name: "Task C" }, priority: 3 });

  const plan = flow.resolveExecutionPlan();

  assert.deepEqual(
    plan.fullSequence.map((item) => item.name),
    ["Task A", "Task B", "Task C"],
  );
});

test("resolves DAG with descending priority when priorityAscending=false", () => {
  const flow = new ExFlow<Task>({ priorityAscending: false });

  flow.addEntity({ id: "A", dependsOn: [], data: { name: "Task A" }, priority: 2 });
  flow.addEntity({ id: "B", dependsOn: ["A"], data: { name: "Task B" }, priority: 1 });
  flow.addEntity({ id: "C", dependsOn: ["A"], data: { name: "Task C" }, priority: 3 });

  const plan = flow.resolveExecutionPlan();

  assert.deepEqual(
    plan.fullSequence.map((item) => item.name),
    ["Task A", "Task C", "Task B"],
  );
});

test("applies custom tie-breaker when priorities are equal", () => {
  const flow = new ExFlow<Task>({
    tieBreaker: (a, b) => a.data.name.localeCompare(b.data.name),
  });

  flow.addEntity({ id: "B", dependsOn: [], data: { name: "Task B" }, priority: 1 });
  flow.addEntity({ id: "A", dependsOn: [], data: { name: "Task A" }, priority: 1 });

  const plan = flow.resolveExecutionPlan();

  assert.deepEqual(
    plan.fullSequence.map((item) => item.name),
    ["Task A", "Task B"],
  );
});

test("applies tie fallback policy id-asc when priorities are equal", () => {
  const flow = new ExFlow<Task>({ tieFallbackPolicy: "id-asc" });

  flow.addEntity({ id: "B", dependsOn: [], data: { name: "Task B" }, priority: 1 });
  flow.addEntity({ id: "A", dependsOn: [], data: { name: "Task A" }, priority: 1 });

  const plan = flow.resolveExecutionPlan();

  assert.deepEqual(
    plan.fullSequence.map((item) => item.name),
    ["Task A", "Task B"],
  );
});

test("throughput mode unlocks nodes between constrained sub-batches", () => {
  const flow = new ExFlow<Task>({
    schedulerMode: "throughput",
    concurrencyCap: 1,
  });

  flow.addEntity({ id: "A", dependsOn: [], data: { name: "Task A" }, priority: 2 });
  flow.addEntity({ id: "B", dependsOn: [], data: { name: "Task B" }, priority: 1 });
  flow.addEntity({ id: "C", dependsOn: ["A"], data: { name: "Task C" }, priority: 100 });
  flow.addEntity({ id: "D", dependsOn: ["B"], data: { name: "Task D" }, priority: 50 });

  const plan = flow.resolveExecutionPlan();

  assert.deepEqual(
    plan.fullSequence.map((item) => item.name),
    ["Task A", "Task C", "Task B", "Task D"],
  );
});

test("splits level by concurrency cap", () => {
  const flow = new ExFlow<Task>({ concurrencyCap: 2 });

  flow.addEntity({ id: "A", dependsOn: [], data: { name: "Task A" }, priority: 3 });
  flow.addEntity({ id: "B", dependsOn: [], data: { name: "Task B" }, priority: 2 });
  flow.addEntity({ id: "C", dependsOn: [], data: { name: "Task C" }, priority: 1 });

  const plan = flow.resolveExecutionPlan();

  assert.equal(plan.batches.length, 2);
  assert.deepEqual(
    plan.batches.map((batch) => batch.length),
    [2, 1],
  );
  assert.deepEqual(
    plan.fullSequence.map((item) => item.name),
    ["Task A", "Task B", "Task C"],
  );
});

test("splits level by resource caps", () => {
  const flow = new ExFlow<Task>({ resourceCaps: { cpu: 1 } });

  flow.addEntity({
    id: "A",
    dependsOn: [],
    data: { name: "Task A" },
    priority: 2,
    resourceClass: "cpu",
  });
  flow.addEntity({
    id: "B",
    dependsOn: [],
    data: { name: "Task B" },
    priority: 1,
    resourceClass: "cpu",
  });

  const plan = flow.resolveExecutionPlan();

  assert.equal(plan.batches.length, 2);
  assert.deepEqual(
    plan.batches.map((batch) => batch.length),
    [1, 1],
  );
});

test("orders equal priority nodes by deadline then weight strategy", () => {
  const flow = new ExFlow<Task>({
    deadlineStrategy: "earliest-first",
    weightStrategy: "higher-first",
  });

  flow.addEntity({
    id: "A",
    dependsOn: [],
    data: { name: "Task A" },
    priority: 1,
    deadline: 10,
    weight: 1,
  });
  flow.addEntity({
    id: "B",
    dependsOn: [],
    data: { name: "Task B" },
    priority: 1,
    deadline: 5,
    weight: 1,
  });
  flow.addEntity({
    id: "C",
    dependsOn: [],
    data: { name: "Task C" },
    priority: 1,
    deadline: 5,
    weight: 3,
  });

  const plan = flow.resolveExecutionPlan();

  assert.deepEqual(
    plan.fullSequence.map((item) => item.name),
    ["Task C", "Task B", "Task A"],
  );
});

test("throws invalid option error code for invalid concurrencyCap", () => {
  const flow = new ExFlow<Task>({ concurrencyCap: 0 });

  flow.addEntity({ id: "A", dependsOn: [], data: { name: "Task A" }, priority: 1 });

  assert.throws(() => flow.resolveExecutionPlan(), /\[EXFLOW_INVALID_OPTION\]/);
});

test("throws duplicate node error code", () => {
  const flow = new ExFlow<Task>();

  flow.addEntity({ id: "A", dependsOn: [], data: { name: "Task A" } });

  assert.throws(
    () => flow.addEntity({ id: "A", dependsOn: [], data: { name: "Task A2" } }),
    /\[EXFLOW_DUPLICATE_NODE\]/,
  );
});

test("throws unknown dependency error code", () => {
  const flow = new ExFlow<Task>();

  flow.addEntity({
    id: "A",
    dependsOn: ["missing"],
    data: { name: "Task A" },
  });

  assert.throws(() => flow.resolveExecutionPlan(), /\[EXFLOW_UNKNOWN_DEPENDENCY\]/);
});

test("throws reserved field error code", () => {
  const flow = new ExFlow<Task>();

  assert.throws(
    () =>
      flow.addEntity({
        id: "A",
        dependsOn: [],
        data: { name: "Task A", exFlowPriority: 999 } as unknown as Task,
        priority: 2,
      }),
    /\[EXFLOW_RESERVED_FIELD\]/,
  );
});

test("throws cycle error code for real cycles", () => {
  const flow = new ExFlow<Task>();

  flow.addEntity({ id: "A", dependsOn: ["B"], data: { name: "Task A" } });
  flow.addEntity({ id: "B", dependsOn: ["A"], data: { name: "Task B" } });

  assert.throws(() => flow.resolveExecutionPlan(), /\[EXFLOW_CYCLE_DETECTED\]/);
});

test("cycle diagnostics includes cycle path", () => {
  const flow = new ExFlow<Task>();

  flow.addEntity({ id: "A", dependsOn: ["B"], data: { name: "Task A" } });
  flow.addEntity({ id: "B", dependsOn: ["A"], data: { name: "Task B" } });

  assert.throws(() => flow.resolveExecutionPlan(), /Cycle detected in the graph: .*->.*/);
});

test("default shallow clone keeps nested references", () => {
  type NestedTask = { name: string; meta: { tags: string[] } };
  const flow = new ExFlow<NestedTask>();
  const originalData: NestedTask = { name: "Task A", meta: { tags: ["a"] } };

  flow.addEntity({ id: "A", dependsOn: [], data: originalData, priority: 1 });

  const plan = flow.resolveExecutionPlan();
  plan.fullSequence[0].meta.tags.push("b");

  assert.deepEqual(originalData.meta.tags, ["a", "b"]);
});

test("deep clone mode isolates nested references", () => {
  type NestedTask = { name: string; meta: { tags: string[] } };
  const flow = new ExFlow<NestedTask>({ cloneMode: "deep" });
  const originalData: NestedTask = { name: "Task A", meta: { tags: ["a"] } };

  flow.addEntity({ id: "A", dependsOn: [], data: originalData, priority: 1 });

  const plan = flow.resolveExecutionPlan();
  plan.fullSequence[0].meta.tags.push("b");

  assert.deepEqual(originalData.meta.tags, ["a"]);
});

test("custom clone mode uses cloneFn", () => {
  type NestedTask = { name: string; meta: { tags: string[] } };
  let cloneFnCalls = 0;
  const flow = new ExFlow<NestedTask>({
    cloneMode: "custom",
    cloneFn: (data) => {
      cloneFnCalls += 1;
      return {
        ...data,
        meta: {
          ...data.meta,
          tags: [...data.meta.tags],
        },
      };
    },
  });
  const originalData: NestedTask = { name: "Task A", meta: { tags: ["a"] } };

  flow.addEntity({ id: "A", dependsOn: [], data: originalData, priority: 1 });

  const plan = flow.resolveExecutionPlan();
  plan.fullSequence[0].meta.tags.push("b");

  assert.equal(cloneFnCalls, 1);
  assert.deepEqual(originalData.meta.tags, ["a"]);
});

test("custom clone mode without cloneFn throws error code", () => {
  type NestedTask = { name: string; meta: { tags: string[] } };
  const flow = new ExFlow<NestedTask>({ cloneMode: "custom" });

  flow.addEntity({
    id: "A",
    dependsOn: [],
    data: { name: "Task A", meta: { tags: ["a"] } },
    priority: 1,
  });

  assert.throws(() => flow.resolveExecutionPlan(), /\[EXFLOW_CUSTOM_CLONE_FN_REQUIRED\]/);
});

test("config builder creates deep clone options", () => {
  const options = createExFlowConfigBuilder<{ name: string }>().useDeepClone().build();

  assert.deepEqual(options, { cloneMode: "deep" });
});

test("config builder creates custom clone options", () => {
  const options = createExFlowConfigBuilder<{ name: string; meta: { x: number } }>()
    .useCustomClone((data) => ({
      ...data,
      meta: { ...data.meta },
    }))
    .build();

  assert.equal(options.cloneMode, "custom");
  assert.equal(typeof options.cloneFn, "function");
});

test("config builder sets priorityAscending option", () => {
  const options = createExFlowConfigBuilder<{ name: string }>().withPriorityAscending(true).build();

  assert.deepEqual(options, { priorityAscending: true });
});

test("config builder sets scheduling constraints", () => {
  const options = createExFlowConfigBuilder<{ name: string }>()
    .withConcurrencyCap(2)
    .withResourceCaps({ cpu: 1 })
    .withDeadlineStrategy("earliest-first")
    .withWeightStrategy("higher-first")
    .build();

  assert.deepEqual(options, {
    concurrencyCap: 2,
    resourceCaps: { cpu: 1 },
    deadlineStrategy: "earliest-first",
    weightStrategy: "higher-first",
  });
});

test("config builder sets scheduler mode and tie fallback policy", () => {
  const options = createExFlowConfigBuilder<{ name: string }>()
    .withSchedulerMode("throughput")
    .withTieFallbackPolicy("id-asc")
    .build();

  assert.deepEqual(options, {
    schedulerMode: "throughput",
    tieFallbackPolicy: "id-asc",
  });
});

test("resolveExecutionDetails returns metrics", () => {
  const flow = new ExFlow<Task>({ schedulerMode: "throughput", concurrencyCap: 1 });

  flow.addEntity({ id: "A", dependsOn: [], data: { name: "Task A" }, priority: 2 });
  flow.addEntity({ id: "B", dependsOn: [], data: { name: "Task B" }, priority: 1 });

  const details = flow.resolveExecutionDetails();

  assert.equal(details.plan.fullSequence.length, 2);
  assert.equal(details.metrics.schedulerMode, "throughput");
  assert.equal(details.metrics.emittedNodes, 2);
  assert.equal(details.metrics.rounds, 2);
  assert.equal(details.metrics.maxReadyQueueSize, 2);
});

test("structured diagnostics expose cycle path and unresolved nodes", () => {
  const flow = new ExFlow<Task>();

  flow.addEntity({ id: "A", dependsOn: ["B"], data: { name: "Task A" } });
  flow.addEntity({ id: "B", dependsOn: ["A"], data: { name: "Task B" } });

  try {
    flow.resolveExecutionPlan();
    assert.fail("expected cycle error");
  } catch (error) {
    assert.equal(error instanceof ExFlowRuntimeError, true);
    const exError = error as ExFlowRuntimeError;
    assert.equal(exError.code, "EXFLOW_CYCLE_DETECTED");
    assert.deepEqual(exError.diagnostics?.cyclePath, ["A", "B", "A"]);
    assert.deepEqual(exError.diagnostics?.unresolvedNodeIds?.sort(), ["A", "B"]);
  }
});

test("preflight resource cap validation catches missing class cap", () => {
  const flow = new ExFlow<Task>({
    requireResourceCapForAllClasses: true,
    resourceCaps: { io: 1 },
  });

  flow.addEntity({
    id: "A",
    dependsOn: [],
    data: { name: "Task A" },
    resourceClass: "cpu",
  });

  assert.throws(() => flow.resolveExecutionPlan(), /\[EXFLOW_INVALID_OPTION\]/);
});

test("fairness aging with maxDeferralRounds prevents starvation", () => {
  const flow = new ExFlow<Task>({
    schedulerMode: "throughput",
    concurrencyCap: 1,
    fairnessPolicy: "aging",
    maxDeferralRounds: 1,
  });

  flow.addEntity({ id: "A", dependsOn: [], data: { name: "Task A" }, priority: 10 });
  flow.addEntity({ id: "B", dependsOn: [], data: { name: "Task B" }, priority: 1 });
  flow.addEntity({ id: "C", dependsOn: ["A"], data: { name: "Task C" }, priority: 10 });

  const plan = flow.resolveExecutionPlan();

  assert.deepEqual(
    plan.fullSequence.map((item) => item.name),
    ["Task A", "Task B", "Task C"],
  );
});

test("preset helper returns expected defaults", () => {
  const preset = getExFlowPreset("high-throughput");

  assert.equal(preset.schedulerMode, "throughput");
  assert.equal(preset.fairnessPolicy, "aging");
});

test("config builder applies preset", () => {
  const options = createExFlowConfigBuilder<{ name: string }>()
    .withPreset("strict-fairness")
    .build();

  assert.equal(options.schedulerMode, "throughput");
  assert.equal(options.fairnessPolicy, "aging");
  assert.equal(options.maxDeferralRounds, 1);
});

test("property: random DAG always respects topological order and deterministic output", () => {
  const createSeededRandom = (seed: number): (() => number) => {
    let current = seed;
    return () => {
      current = (current * 1664525 + 1013904223) % 4294967296;
      return current / 4294967296;
    };
  };

  for (let iteration = 0; iteration < 40; iteration += 1) {
    const nodeCount = 12;
    const nodeIds = Array.from({ length: nodeCount }, (_, idx) => `N${idx}`);

    const buildFlow = (seedOffset: number) => {
      const random = createSeededRandom(1000 + iteration + seedOffset);
      const flow = new ExFlow<{ name: string }>({
        schedulerMode: "throughput",
        concurrencyCap: 3,
        tieFallbackPolicy: "id-asc",
      });
      const edges: Array<{ id: string; dependsOn: string[] }> = [];

      for (let idx = 0; idx < nodeCount; idx += 1) {
        const id = nodeIds[idx];
        const dependsOn: string[] = [];

        for (let depIdx = 0; depIdx < idx; depIdx += 1) {
          if (random() < 0.18) {
            dependsOn.push(nodeIds[depIdx]);
          }
        }

        flow.addEntity({
          id,
          dependsOn,
          data: { name: id },
          priority: Math.floor(random() * 4),
        });
        edges.push({ id, dependsOn });
      }

      return { flow, edges };
    };

    const case1 = buildFlow(0);
    const case2 = buildFlow(0);
    const flow1 = case1.flow;
    const flow2 = case2.flow;
    const plan1 = flow1.resolveExecutionPlan();
    const plan2 = flow2.resolveExecutionPlan();
    const order1 = plan1.fullSequence.map((item) => item.name);
    const order2 = plan2.fullSequence.map((item) => item.name);

    assert.deepEqual(order1, order2);

    const indexById = new Map(order1.map((id, idx) => [id, idx]));
    for (const edge of case1.edges) {
      for (const depId of edge.dependsOn) {
        const position = indexById.get(edge.id);
        const depPosition = indexById.get(depId);
        if (position === undefined || depPosition === undefined) {
          continue;
        }
        assert.equal(depPosition <= position, true);
      }
    }
  }
});

test("serializeExFlowError returns structured payload for ExFlowRuntimeError", () => {
  const error = new ExFlowRuntimeError("EXFLOW_INVALID_OPTION", "invalid option", {
    invalidOptionField: "concurrencyCap",
    invalidOptionValue: 0,
  });

  const serialized = serializeExFlowError(error, "2026-04-21T00:00:00.000Z");

  assert.deepEqual(serialized, {
    source: "ex-flow",
    code: "EXFLOW_INVALID_OPTION",
    message: "[EXFLOW_INVALID_OPTION] invalid option",
    name: "ExFlowRuntimeError",
    diagnostics: {
      invalidOptionField: "concurrencyCap",
      invalidOptionValue: 0,
    },
    timestamp: "2026-04-21T00:00:00.000Z",
  });
});

test("serializeExFlowError returns fallback payload for unknown errors", () => {
  const serialized = serializeExFlowError("boom", "2026-04-21T00:00:00.000Z");

  assert.deepEqual(serialized, {
    source: "ex-flow",
    message: "boom",
    name: "UnknownError",
    timestamp: "2026-04-21T00:00:00.000Z",
  });
});

test("toOpenTelemetryAttributes maps diagnostics payload", () => {
  const event = serializeExFlowError(
    new ExFlowRuntimeError("EXFLOW_CYCLE_DETECTED", "cycle", {
      cyclePath: ["A", "B", "A"],
      unresolvedNodeIds: ["A", "B"],
      invalidOptionField: "resourceCaps.cpu",
      invalidOptionValue: 0,
      details: "invalid resource cap",
    }),
    "2026-04-21T00:00:00.000Z",
  );

  const attrs = toOpenTelemetryAttributes(event);

  assert.deepEqual(attrs, {
    "exflow.source": "ex-flow",
    "exflow.name": "ExFlowRuntimeError",
    "exflow.message": "[EXFLOW_CYCLE_DETECTED] cycle",
    "exflow.timestamp": "2026-04-21T00:00:00.000Z",
    "exflow.code": "EXFLOW_CYCLE_DETECTED",
    "exflow.cycle_path": "A->B->A",
    "exflow.unresolved_nodes": "A,B",
    "exflow.invalid_option_field": "resourceCaps.cpu",
    "exflow.invalid_option_value": "0",
    "exflow.details": "invalid resource cap",
  });
});

test("toDatadogLogFields maps diagnostics payload", () => {
  const event = serializeExFlowError(
    new ExFlowRuntimeError("EXFLOW_INVALID_OPTION", "bad option", {
      invalidOptionField: "concurrencyCap",
      invalidOptionValue: 0,
    }),
    "2026-04-21T00:00:00.000Z",
  );

  const fields = toDatadogLogFields(event);

  assert.deepEqual(fields, {
    source: "ex-flow",
    service: "ex-flow",
    status: "error",
    error_code: "EXFLOW_INVALID_OPTION",
    error_name: "ExFlowRuntimeError",
    message: "[EXFLOW_INVALID_OPTION] bad option",
    timestamp: "2026-04-21T00:00:00.000Z",
    diagnostics_cycle_path: null,
    diagnostics_unresolved_nodes: null,
    diagnostics_invalid_option_field: "concurrencyCap",
    diagnostics_invalid_option_value: "0",
    diagnostics_details: null,
  });
});

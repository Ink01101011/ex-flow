import assert from "node:assert/strict";
import test from "node:test";

import { createExFlowConfigBuilder } from "../core/configBuilder";
import ExFlow from "../core/exFlow";

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

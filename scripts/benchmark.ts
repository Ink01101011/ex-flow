import { ExFlow, type ExNode } from "../src";

type TaskData = { name: string };

const createBenchmarkGraph = (nodeCount: number): ExNode<TaskData>[] => {
  const nodes: ExNode<TaskData>[] = [];

  for (let index = 0; index < nodeCount; index += 1) {
    const id = `N${index}`;
    const dependsOn: string[] = [];

    if (index > 0) {
      dependsOn.push(`N${index - 1}`);
    }
    if (index > 2 && index % 3 === 0) {
      dependsOn.push(`N${index - 3}`);
    }

    nodes.push({
      id,
      dependsOn,
      data: { name: id },
      priority: (index * 7) % 9,
      resourceClass: index % 2 === 0 ? "cpu" : "io",
    });
  }

  return nodes;
};

const runOne = (label: string, schedulerMode: "level" | "throughput") => {
  const flow = new ExFlow<TaskData>({
    schedulerMode,
    concurrencyCap: 8,
    resourceCaps: { cpu: 4, io: 4 },
    fairnessPolicy: "aging",
    maxDeferralRounds: 2,
    tieFallbackPolicy: "id-asc",
  });

  const nodes = createBenchmarkGraph(500);
  for (const node of nodes) {
    flow.addEntity(node);
  }

  const started = performance.now();
  const details = flow.resolveExecutionDetails();
  const durationMs = performance.now() - started;

  console.log(`${label}`);
  console.log(`  schedulerMode: ${schedulerMode}`);
  console.log(`  durationMs: ${durationMs.toFixed(2)}`);
  console.log(`  rounds: ${details.metrics.rounds}`);
  console.log(`  emittedNodes: ${details.metrics.emittedNodes}`);
  console.log(`  deferredNodes: ${details.metrics.deferredNodes}`);
  console.log(`  maxReadyQueueSize: ${details.metrics.maxReadyQueueSize}`);
  console.log(
    `  constraintHits: concurrency=${details.metrics.constraintHits.concurrencyCap}, resource=${details.metrics.constraintHits.resourceCaps}`,
  );
};

runOne("Level Mode", "level");
runOne("Throughput Mode", "throughput");

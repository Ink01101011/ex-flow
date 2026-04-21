import { mergeSort } from "exsorted/base";
import { radixSort } from "exsorted/non-compare";

import { EXFLOW_ERROR } from "../constants";
import ExFlowRuntimeError from "../errors/exFlowRuntimeError";
import {
  ExecutionPlan,
  ExFlowDiagnostics,
  ExFlowExecutionDetails,
  ExFlowMetrics,
  ExFlowOptions,
  ExFlowResultItem,
  ExFlowSafeData,
  ExNode,
} from "../types";
import { getExFlowPreset, resolveFairnessPolicy } from "./presets";

type PlannedNode<T extends object & ExFlowSafeData> = {
  id: string;
  exFlowPriority: number;
  resourceClass?: string;
  deadline?: number;
  weight?: number;
  sourceNode: ExNode<T>;
};

type GraphState = {
  inDegree: Map<string, number>;
  adjacencyList: Map<string, string[]>;
};

type BatchSelection<T extends object & ExFlowSafeData> = {
  batch: PlannedNode<T>[];
  deferredNodeIds: Set<string>;
  resourceConstraintSkips: number;
  concurrencyConstraintSkips: number;
};

/**
 * Priority-aware DAG execution planner based on Kahn's Algorithm.
 */
class ExFlow<T extends object & ExFlowSafeData> {
  private readonly options: ExFlowOptions<T>;
  private nodes: Map<string, ExNode<T>> = new Map();
  private nodeOrder: Map<string, number> = new Map();
  private nextNodeOrder = 0;
  private lastMetrics: ExFlowMetrics | null = null;

  /**
   * @param options Runtime options that control output cloning behavior.
   */
  constructor(options: ExFlowOptions<T> = {}) {
    this.options = options.presetName
      ? { ...getExFlowPreset<T>(options.presetName), ...options }
      : options;
  }

  /**
   * Adds a node into the graph.
   * @throws Error if the node id already exists.
   * @throws Error if `data` contains the reserved `exFlowPriority` field.
   */
  addEntity(node: ExNode<T>): void {
    if (this.nodes.has(node.id)) {
      this.raiseError(EXFLOW_ERROR.DUPLICATE_NODE, `Node with id ${node.id} already exists.`, {
        details: `Duplicate node id: ${node.id}`,
      });
    }

    if (Object.prototype.hasOwnProperty.call(node.data, "exFlowPriority")) {
      this.raiseError(
        EXFLOW_ERROR.RESERVED_FIELD,
        `Node ${node.id} contains reserved field 'exFlowPriority' in data.`,
      );
    }

    this.nodes.set(node.id, node);
    this.nodeOrder.set(node.id, this.nextNodeOrder);
    this.nextNodeOrder += 1;
  }

  /**
   * Resolves the graph into execution batches and a flattened full sequence.
   * @throws Error if a dependency id does not exist.
   * @throws Error if the graph contains a cycle.
   */
  resolveExecutionPlan(): ExecutionPlan<T> {
    return this.resolveExecutionDetails().plan;
  }

  /**
   * Resolves the graph and returns plan with execution metrics.
   */
  resolveExecutionDetails(): ExFlowExecutionDetails<T> {
    this.validateOptions();
    const graphState = this.buildGraphState();
    const metrics = this.createMetrics();
    const details =
      this.options.schedulerMode === "throughput"
        ? this.calculateThroughputPlan(graphState, metrics)
        : this.calculateLevelPlan(graphState, metrics);

    this.lastMetrics = details.metrics;
    return details;
  }

  getLastMetrics(): ExFlowMetrics | null {
    return this.lastMetrics
      ? { ...this.lastMetrics, constraintHits: { ...this.lastMetrics.constraintHits } }
      : null;
  }

  private buildGraphState(): GraphState {
    const inDegree: Map<string, number> = new Map();
    const adjacencyList: Map<string, string[]> = new Map();
    const nodeIds = new Set(this.nodes.keys());

    for (const node of this.nodes.values()) {
      inDegree.set(node.id, node.dependsOn.length);

      for (const depId of node.dependsOn) {
        if (!nodeIds.has(depId)) {
          this.raiseError(
            EXFLOW_ERROR.UNKNOWN_DEPENDENCY,
            `Node ${node.id} depends on unknown node id ${depId}.`,
            { details: `Unknown dependency: ${depId}` },
          );
        }

        const neighbors = adjacencyList.get(depId);
        if (neighbors) {
          neighbors.push(node.id);
        } else {
          adjacencyList.set(depId, [node.id]);
        }
      }
    }

    return { inDegree, adjacencyList };
  }

  private calculateLevelPlan(
    graphState: GraphState,
    metrics: ExFlowMetrics,
  ): ExFlowExecutionDetails<T> {
    const deferralCounts: Map<string, number> = new Map();
    const batches: ExFlowResultItem<T>[][] = [];
    const fullSequence: ExFlowResultItem<T>[] = [];
    const inDegree = graphState.inDegree;
    const adjacencyList = graphState.adjacencyList;
    let queue: string[] = [];

    inDegree.forEach((degree, id) => {
      if (degree === 0) {
        queue.push(id);
      }
    });

    while (queue.length > 0) {
      this.recordReadyQueueSize(metrics, queue.length);
      const currentBatch: PlannedNode<T>[] = [];
      const nextQueue: string[] = [];

      for (const id of queue) {
        const node = this.nodes.get(id);
        if (!node) {
          continue;
        }

        currentBatch.push(this.toPlannedNode(id, node));

        const neighbors = adjacencyList.get(id) || [];
        for (const neighborId of neighbors) {
          const degree = inDegree.get(neighborId);
          if (degree === undefined) {
            continue;
          }

          const nextDegree = degree - 1;
          inDegree.set(neighborId, nextDegree);
          if (nextDegree === 0) {
            nextQueue.push(neighborId);
          }
        }
      }

      const sortedBatch = this.sortBatch(currentBatch);
      const constrainedBatches = this.applyBatchConstraints(sortedBatch, deferralCounts, metrics);

      for (const constrainedBatch of constrainedBatches) {
        const resultBatch = constrainedBatch.map((plannedNode) => this.toResultItem(plannedNode));
        batches.push(resultBatch);
        fullSequence.push(...resultBatch);
        metrics.rounds += 1;
        metrics.emittedNodes += resultBatch.length;
      }

      queue = nextQueue;
    }

    this.assertNoCycle(fullSequence.length, this.nodes.size, inDegree, adjacencyList);
    return {
      plan: { batches, fullSequence },
      metrics,
    };
  }

  private calculateThroughputPlan(
    graphState: GraphState,
    metrics: ExFlowMetrics,
  ): ExFlowExecutionDetails<T> {
    const deferralCounts: Map<string, number> = new Map();
    const batches: ExFlowResultItem<T>[][] = [];
    const fullSequence: ExFlowResultItem<T>[] = [];
    const inDegree = graphState.inDegree;
    const adjacencyList = graphState.adjacencyList;
    const readyNodeIds: Set<string> = new Set();

    inDegree.forEach((degree, id) => {
      if (degree === 0) {
        readyNodeIds.add(id);
      }
    });

    while (readyNodeIds.size > 0) {
      this.recordReadyQueueSize(metrics, readyNodeIds.size);
      const candidates: PlannedNode<T>[] = [];
      for (const id of readyNodeIds) {
        const node = this.nodes.get(id);
        if (!node) {
          continue;
        }

        candidates.push(this.toPlannedNode(id, node));
      }

      const sortedCandidates = this.sortBatch(candidates);
      const selection = this.selectConstrainedBatch(sortedCandidates, deferralCounts);
      this.recordConstraintHits(metrics, selection);
      this.applyDeferrals(deferralCounts, selection.deferredNodeIds, selection.batch, metrics);

      const resultBatch = selection.batch.map((plannedNode) => this.toResultItem(plannedNode));
      batches.push(resultBatch);
      fullSequence.push(...resultBatch);
      metrics.rounds += 1;
      metrics.emittedNodes += resultBatch.length;

      for (const plannedNode of selection.batch) {
        readyNodeIds.delete(plannedNode.id);
        const neighbors = adjacencyList.get(plannedNode.id) || [];
        for (const neighborId of neighbors) {
          const degree = inDegree.get(neighborId);
          if (degree === undefined) {
            continue;
          }

          const nextDegree = degree - 1;
          inDegree.set(neighborId, nextDegree);
          if (nextDegree === 0) {
            readyNodeIds.add(neighborId);
          }
        }
      }
    }

    this.assertNoCycle(fullSequence.length, this.nodes.size, inDegree, adjacencyList);
    return {
      plan: { batches, fullSequence },
      metrics,
    };
  }

  private toPlannedNode(id: string, node: ExNode<T>): PlannedNode<T> {
    return {
      id,
      exFlowPriority: node.priority ?? 0,
      resourceClass: node.resourceClass,
      deadline: node.deadline,
      weight: node.weight,
      sourceNode: node,
    };
  }

  private validateOptions(): void {
    const concurrencyCap = this.options.concurrencyCap;
    if (
      concurrencyCap !== undefined &&
      (!Number.isInteger(concurrencyCap) || concurrencyCap <= 0)
    ) {
      this.raiseError(
        EXFLOW_ERROR.INVALID_OPTION,
        "concurrencyCap must be a positive integer when provided.",
        {
          invalidOptionField: "concurrencyCap",
          invalidOptionValue: concurrencyCap,
        },
      );
    }

    const maxDeferralRounds = this.options.maxDeferralRounds;
    if (
      maxDeferralRounds !== undefined &&
      (!Number.isInteger(maxDeferralRounds) || maxDeferralRounds <= 0)
    ) {
      this.raiseError(
        EXFLOW_ERROR.INVALID_OPTION,
        "maxDeferralRounds must be a positive integer when provided.",
        {
          invalidOptionField: "maxDeferralRounds",
          invalidOptionValue: maxDeferralRounds,
        },
      );
    }

    const resourceCaps = this.options.resourceCaps;
    if (resourceCaps) {
      for (const [resourceClass, cap] of Object.entries(resourceCaps)) {
        if (!Number.isInteger(cap) || cap <= 0) {
          this.raiseError(
            EXFLOW_ERROR.INVALID_OPTION,
            `resourceCaps['${resourceClass}'] must be a positive integer.`,
            {
              invalidOptionField: `resourceCaps.${resourceClass}`,
              invalidOptionValue: cap,
            },
          );
        }
      }
    }

    if (this.options.requireResourceCapForAllClasses) {
      const missingCaps: string[] = [];
      const caps = this.options.resourceCaps ?? {};
      for (const node of this.nodes.values()) {
        if (node.resourceClass && caps[node.resourceClass] === undefined) {
          missingCaps.push(node.resourceClass);
        }
      }

      if (missingCaps.length > 0) {
        const uniqMissing = [...new Set(missingCaps)];
        this.raiseError(
          EXFLOW_ERROR.INVALID_OPTION,
          "Missing resourceCaps entries for one or more node resource classes.",
          {
            invalidOptionField: "resourceCaps",
            details: `Missing caps for classes: ${uniqMissing.join(", ")}`,
          },
        );
      }
    }
  }

  private sortBatch(batch: PlannedNode<T>[]): PlannedNode<T>[] {
    const requiresCompareSort =
      typeof this.options.tieBreaker === "function" ||
      this.options.deadlineStrategy !== undefined ||
      this.options.weightStrategy !== undefined ||
      (this.options.tieFallbackPolicy !== undefined &&
        this.options.tieFallbackPolicy !== "insertion");

    if (!requiresCompareSort) {
      let sortedBatch = radixSort(batch, (item) => item.exFlowPriority);
      if (this.options.priorityAscending !== true) {
        sortedBatch = sortedBatch.reverse();
      }
      return sortedBatch;
    }

    return mergeSort(batch, (a, b) => this.comparePlannedNodes(a, b));
  }

  private comparePlannedNodes(a: PlannedNode<T>, b: PlannedNode<T>): number {
    const priorityDiff =
      this.options.priorityAscending === true
        ? a.exFlowPriority - b.exFlowPriority
        : b.exFlowPriority - a.exFlowPriority;
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const deadlineDiff = this.compareByDeadline(a, b);
    if (deadlineDiff !== 0) {
      return deadlineDiff;
    }

    const weightDiff = this.compareByWeight(a, b);
    if (weightDiff !== 0) {
      return weightDiff;
    }

    if (this.options.tieBreaker) {
      const tieDiff = this.options.tieBreaker(a.sourceNode, b.sourceNode);
      if (tieDiff !== 0) {
        return tieDiff;
      }
    }

    return this.compareByTieFallbackPolicy(a.id, b.id);
  }

  private compareByTieFallbackPolicy(aId: string, bId: string): number {
    const policy = this.options.tieFallbackPolicy ?? "insertion";

    if (policy === "id-asc") {
      return aId.localeCompare(bId);
    }
    if (policy === "id-desc") {
      return bId.localeCompare(aId);
    }

    return this.getNodeOrder(aId) - this.getNodeOrder(bId);
  }

  private compareByDeadline(a: PlannedNode<T>, b: PlannedNode<T>): number {
    if (this.options.deadlineStrategy === undefined) {
      return 0;
    }

    if (a.deadline === undefined && b.deadline === undefined) {
      return 0;
    }
    if (a.deadline === undefined) {
      return 1;
    }
    if (b.deadline === undefined) {
      return -1;
    }

    return this.options.deadlineStrategy === "earliest-first"
      ? a.deadline - b.deadline
      : b.deadline - a.deadline;
  }

  private compareByWeight(a: PlannedNode<T>, b: PlannedNode<T>): number {
    if (this.options.weightStrategy === undefined) {
      return 0;
    }

    if (a.weight === undefined && b.weight === undefined) {
      return 0;
    }
    if (a.weight === undefined) {
      return 1;
    }
    if (b.weight === undefined) {
      return -1;
    }

    return this.options.weightStrategy === "higher-first"
      ? b.weight - a.weight
      : a.weight - b.weight;
  }

  private applyBatchConstraints(
    sortedBatch: PlannedNode<T>[],
    deferralCounts: Map<string, number>,
    metrics: ExFlowMetrics,
  ): PlannedNode<T>[][] {
    const concurrencyCap = this.options.concurrencyCap;
    const resourceCaps = this.options.resourceCaps;
    const hasResourceCaps = resourceCaps && Object.keys(resourceCaps).length > 0;

    if (concurrencyCap === undefined && !hasResourceCaps) {
      return [sortedBatch];
    }

    const remaining = [...sortedBatch];
    const constrainedBatches: PlannedNode<T>[][] = [];

    while (remaining.length > 0) {
      const selection = this.selectConstrainedBatch(remaining, deferralCounts);
      this.recordConstraintHits(metrics, selection);
      this.applyDeferrals(deferralCounts, selection.deferredNodeIds, selection.batch, metrics);

      const selectedIds = new Set(selection.batch.map((item) => item.id));
      const nextRemaining = remaining.filter((item) => !selectedIds.has(item.id));
      remaining.length = 0;
      remaining.push(...nextRemaining);
      constrainedBatches.push(selection.batch);
    }

    return constrainedBatches;
  }

  private selectConstrainedBatch(
    sortedNodes: PlannedNode<T>[],
    deferralCounts: Map<string, number>,
  ): BatchSelection<T> {
    const maxPerBatch = this.options.concurrencyCap ?? Number.POSITIVE_INFINITY;
    const resourceCaps = this.options.resourceCaps;
    const nextBatch: PlannedNode<T>[] = [];
    const resourceUsage: Record<string, number> = {};
    const deferredNodeIds: Set<string> = new Set();
    let resourceConstraintSkips = 0;

    const fairnessPolicy = resolveFairnessPolicy(this.options.fairnessPolicy);
    const fairnessSorted =
      fairnessPolicy === "none"
        ? sortedNodes
        : mergeSort([...sortedNodes], (a, b) => {
            const scoreDiff =
              this.getFairnessScore(b.id, deferralCounts) -
              this.getFairnessScore(a.id, deferralCounts);
            if (scoreDiff !== 0) {
              return scoreDiff;
            }
            return this.comparePlannedNodes(a, b);
          });

    for (let index = 0; index < fairnessSorted.length; index += 1) {
      const candidate = fairnessSorted[index];
      if (nextBatch.length >= maxPerBatch) {
        deferredNodeIds.add(candidate.id);
        continue;
      }

      if (!this.canUseResource(candidate, resourceUsage, resourceCaps)) {
        deferredNodeIds.add(candidate.id);
        resourceConstraintSkips += 1;
        continue;
      }

      nextBatch.push(candidate);
      if (candidate.resourceClass !== undefined) {
        resourceUsage[candidate.resourceClass] = (resourceUsage[candidate.resourceClass] ?? 0) + 1;
      }
    }

    if (nextBatch.length === 0 && sortedNodes.length > 0) {
      this.raiseError(
        EXFLOW_ERROR.INVALID_OPTION,
        "resourceCaps configuration prevents scheduling nodes in any batch.",
        {
          invalidOptionField: "resourceCaps",
          details: "No candidate can be scheduled under current constraints.",
        },
      );
    }

    return {
      batch: nextBatch,
      deferredNodeIds,
      resourceConstraintSkips,
      concurrencyConstraintSkips: Math.max(
        0,
        fairnessSorted.length - nextBatch.length - resourceConstraintSkips,
      ),
    };
  }

  private getFairnessScore(nodeId: string, deferralCounts: Map<string, number>): number {
    const fairnessPolicy = resolveFairnessPolicy(this.options.fairnessPolicy);
    if (fairnessPolicy === "none") {
      return 0;
    }

    const deferrals = deferralCounts.get(nodeId) ?? 0;
    const maxDeferralRounds = this.options.maxDeferralRounds;
    if (maxDeferralRounds !== undefined && deferrals >= maxDeferralRounds) {
      return Number.MAX_SAFE_INTEGER - 1;
    }

    return deferrals;
  }

  private applyDeferrals(
    deferralCounts: Map<string, number>,
    deferredNodeIds: Set<string>,
    selectedNodes: PlannedNode<T>[],
    metrics: ExFlowMetrics,
  ): void {
    for (const selected of selectedNodes) {
      deferralCounts.delete(selected.id);
    }

    for (const deferredId of deferredNodeIds) {
      const current = deferralCounts.get(deferredId) ?? 0;
      deferralCounts.set(deferredId, current + 1);
      metrics.deferredNodes += 1;
    }
  }

  private canUseResource(
    node: PlannedNode<T>,
    usage: Record<string, number>,
    resourceCaps?: Record<string, number>,
  ): boolean {
    if (!resourceCaps || node.resourceClass === undefined) {
      return true;
    }

    const cap = resourceCaps[node.resourceClass];
    if (cap === undefined) {
      return true;
    }

    return (usage[node.resourceClass] ?? 0) < cap;
  }

  private toResultItem(node: PlannedNode<T>): ExFlowResultItem<T> {
    return {
      ...(this.cloneData(node.sourceNode.data) as Omit<T, "exFlowPriority">),
      exFlowPriority: node.exFlowPriority,
    };
  }

  private getNodeOrder(id: string): number {
    return this.nodeOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
  }

  private assertNoCycle(
    resolvedCount: number,
    totalNodes: number,
    inDegree: Map<string, number>,
    adjacencyList: Map<string, string[]>,
  ): void {
    if (resolvedCount === totalNodes) {
      return;
    }

    const cyclePath = this.findCyclePath(inDegree, adjacencyList);
    const unresolvedNodeIds = [...inDegree.entries()]
      .filter(([, degree]) => degree > 0)
      .map(([id]) => id);
    const cycleMessage =
      cyclePath.length > 0
        ? `Cycle detected in the graph: ${cyclePath.join(" -> ")}.`
        : "Cycle detected in the graph.";

    this.raiseError(EXFLOW_ERROR.CYCLE_DETECTED, cycleMessage, {
      cyclePath: cyclePath.length > 0 ? cyclePath : undefined,
      unresolvedNodeIds,
    });
  }

  private findCyclePath(
    inDegree: Map<string, number>,
    adjacencyList: Map<string, string[]>,
  ): string[] {
    const unresolved = new Set<string>();
    for (const [id, degree] of inDegree.entries()) {
      if (degree > 0) {
        unresolved.add(id);
      }
    }

    const state: Map<string, 0 | 1 | 2> = new Map();
    const stack: string[] = [];
    const stackIndex: Map<string, number> = new Map();

    const walk = (nodeId: string): string[] | null => {
      state.set(nodeId, 1);
      stackIndex.set(nodeId, stack.length);
      stack.push(nodeId);

      const neighbors = adjacencyList.get(nodeId) || [];
      for (const neighborId of neighbors) {
        if (!unresolved.has(neighborId)) {
          continue;
        }

        const neighborState = state.get(neighborId) ?? 0;
        if (neighborState === 0) {
          const path = walk(neighborId);
          if (path) {
            return path;
          }
        } else if (neighborState === 1) {
          const start = stackIndex.get(neighborId);
          if (start !== undefined) {
            return [...stack.slice(start), neighborId];
          }
        }
      }

      stack.pop();
      stackIndex.delete(nodeId);
      state.set(nodeId, 2);
      return null;
    };

    for (const nodeId of unresolved) {
      if ((state.get(nodeId) ?? 0) !== 0) {
        continue;
      }

      const cyclePath = walk(nodeId);
      if (cyclePath) {
        return cyclePath;
      }
    }

    return [];
  }

  private createMetrics(): ExFlowMetrics {
    return {
      schedulerMode: this.options.schedulerMode ?? "level",
      rounds: 0,
      emittedNodes: 0,
      deferredNodes: 0,
      maxReadyQueueSize: 0,
      constraintHits: {
        concurrencyCap: 0,
        resourceCaps: 0,
      },
    };
  }

  private recordReadyQueueSize(metrics: ExFlowMetrics, size: number): void {
    if (size > metrics.maxReadyQueueSize) {
      metrics.maxReadyQueueSize = size;
    }
  }

  private recordConstraintHits(metrics: ExFlowMetrics, selection: BatchSelection<T>): void {
    metrics.constraintHits.resourceCaps += selection.resourceConstraintSkips;
    metrics.constraintHits.concurrencyCap += selection.concurrencyConstraintSkips;
  }

  private cloneData(data: T): T {
    const mode = this.options.cloneMode ?? "shallow";

    if (mode === "deep") {
      if (typeof globalThis.structuredClone !== "function") {
        this.raiseError(
          EXFLOW_ERROR.DEEP_CLONE_UNAVAILABLE,
          "Deep clone requested but structuredClone is unavailable in this runtime.",
        );
      }
      return globalThis.structuredClone(data) as T;
    }

    if (mode === "custom") {
      if (!this.options.cloneFn) {
        this.raiseError(
          EXFLOW_ERROR.CUSTOM_CLONE_FN_REQUIRED,
          "cloneFn is required when cloneMode is 'custom'.",
        );
      }
      return this.options.cloneFn(data);
    }

    return { ...data };
  }

  private raiseError(code: string, message: string, diagnostics?: ExFlowDiagnostics): never {
    throw new ExFlowRuntimeError(code, message, diagnostics);
  }
}

export default ExFlow;

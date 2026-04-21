import { radixSort } from "exsorted/non-compare";
import { mergeSort } from "exsorted/base";

import { ExecutionPlan, ExFlowOptions, ExFlowResultItem, ExFlowSafeData, ExNode } from "../types";
import { EXFLOW_ERROR } from "../constants";
import { formatExFlowError } from "../utils";

type PlannedNode<T extends object & ExFlowSafeData> = {
  id: string;
  exFlowPriority: number;
  resourceClass?: string;
  deadline?: number;
  weight?: number;
  sourceNode: ExNode<T>;
};

/**
 * Priority-aware DAG execution planner based on Kahn's Algorithm.
 */
class ExFlow<T extends object & ExFlowSafeData> {
  private nodes: Map<string, ExNode<T>> = new Map();
  private nodeOrder: Map<string, number> = new Map();
  private nextNodeOrder = 0;

  /**
   * @param options Runtime options that control output cloning behavior.
   */
  constructor(private readonly options: ExFlowOptions<T> = {}) {}

  /**
   * Adds a node into the graph.
   * @throws Error if the node id already exists.
   * @throws Error if `data` contains the reserved `exFlowPriority` field.
   */
  addEntity(node: ExNode<T>): void {
    if (this.nodes.has(node.id)) {
      throw new Error(
        formatExFlowError(EXFLOW_ERROR.DUPLICATE_NODE, `Node with id ${node.id} already exists.`),
      );
    }

    if (Object.prototype.hasOwnProperty.call(node.data, "exFlowPriority")) {
      throw new Error(
        formatExFlowError(
          EXFLOW_ERROR.RESERVED_FIELD,
          `Node ${node.id} contains reserved field 'exFlowPriority' in data.`,
        ),
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
    const inDegree: Map<string, number> = new Map();
    const adjacencyList: Map<string, string[]> = new Map();
    const nodeIds = new Set(this.nodes.keys());

    for (const node of this.nodes.values()) {
      inDegree.set(node.id, node.dependsOn.length);

      for (const depId of node.dependsOn) {
        if (!nodeIds.has(depId)) {
          throw new Error(
            formatExFlowError(
              EXFLOW_ERROR.UNKNOWN_DEPENDENCY,
              `Node ${node.id} depends on unknown node id ${depId}.`,
            ),
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

    return this.calculatePlan(inDegree, adjacencyList);
  }

  private calculatePlan(
    inDegree: Map<string, number>,
    adjacencyList: Map<string, string[]>,
  ): ExecutionPlan<T> {
    this.validateOptions();

    if (this.options.schedulerMode === "throughput") {
      return this.calculateThroughputPlan(inDegree, adjacencyList);
    }

    const batches: ExFlowResultItem<T>[][] = [];
    const fullSequence: ExFlowResultItem<T>[] = [];
    let queue: string[] = [];

    inDegree.forEach((degree, id) => {
      if (degree === 0) queue.push(id);
    });

    while (queue.length > 0) {
      const currentBatch: PlannedNode<T>[] = [];
      const nextQueue: string[] = [];

      for (const id of queue) {
        const node = this.nodes.get(id);
        if (node) {
          const plannedNode: PlannedNode<T> = {
            id,
            exFlowPriority: node.priority ?? 0,
            resourceClass: node.resourceClass,
            deadline: node.deadline,
            weight: node.weight,
            sourceNode: node,
          };

          currentBatch.push(plannedNode);

          const neighbors = adjacencyList.get(id) || [];
          neighbors.forEach((neighborId) => {
            const degree = inDegree.get(neighborId);
            if (degree !== undefined) {
              const nextDegree = degree - 1;
              inDegree.set(neighborId, nextDegree);
              if (nextDegree === 0) {
                nextQueue.push(neighborId);
              }
            }
          });
        }
      }

      const sortedBatch = this.sortBatch(currentBatch);
      const constrainedBatches = this.applyBatchConstraints(sortedBatch);

      for (const constrainedBatch of constrainedBatches) {
        const resultBatch = constrainedBatch.map((plannedNode) => this.toResultItem(plannedNode));
        batches.push(resultBatch);
        fullSequence.push(...resultBatch);
      }

      queue = nextQueue;
    }

    if (fullSequence.length !== this.nodes.size) {
      const cyclePath = this.findCyclePath(inDegree, adjacencyList);
      const cycleMessage =
        cyclePath.length > 0
          ? `Cycle detected in the graph: ${cyclePath.join(" -> ")}.`
          : "Cycle detected in the graph.";
      throw new Error(formatExFlowError(EXFLOW_ERROR.CYCLE_DETECTED, cycleMessage));
    }

    return { batches, fullSequence };
  }

  private calculateThroughputPlan(
    inDegree: Map<string, number>,
    adjacencyList: Map<string, string[]>,
  ): ExecutionPlan<T> {
    const batches: ExFlowResultItem<T>[][] = [];
    const fullSequence: ExFlowResultItem<T>[] = [];
    const readyNodeIds: Set<string> = new Set();

    inDegree.forEach((degree, id) => {
      if (degree === 0) {
        readyNodeIds.add(id);
      }
    });

    while (readyNodeIds.size > 0) {
      const candidates: PlannedNode<T>[] = [];
      for (const id of readyNodeIds) {
        const node = this.nodes.get(id);
        if (!node) {
          continue;
        }

        candidates.push({
          id,
          exFlowPriority: node.priority ?? 0,
          resourceClass: node.resourceClass,
          deadline: node.deadline,
          weight: node.weight,
          sourceNode: node,
        });
      }

      const sortedCandidates = this.sortBatch(candidates);
      const nextBatchNodes = this.selectConstrainedBatch(sortedCandidates);
      const resultBatch = nextBatchNodes.map((plannedNode) => this.toResultItem(plannedNode));

      batches.push(resultBatch);
      fullSequence.push(...resultBatch);

      for (const plannedNode of nextBatchNodes) {
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

    if (fullSequence.length !== this.nodes.size) {
      const cyclePath = this.findCyclePath(inDegree, adjacencyList);
      const cycleMessage =
        cyclePath.length > 0
          ? `Cycle detected in the graph: ${cyclePath.join(" -> ")}.`
          : "Cycle detected in the graph.";
      throw new Error(formatExFlowError(EXFLOW_ERROR.CYCLE_DETECTED, cycleMessage));
    }

    return { batches, fullSequence };
  }

  private validateOptions(): void {
    const concurrencyCap = this.options.concurrencyCap;
    if (
      concurrencyCap !== undefined &&
      (!Number.isInteger(concurrencyCap) || concurrencyCap <= 0)
    ) {
      throw new Error(
        formatExFlowError(
          EXFLOW_ERROR.INVALID_OPTION,
          "concurrencyCap must be a positive integer when provided.",
        ),
      );
    }

    const resourceCaps = this.options.resourceCaps;
    if (resourceCaps) {
      for (const [resourceClass, cap] of Object.entries(resourceCaps)) {
        if (!Number.isInteger(cap) || cap <= 0) {
          throw new Error(
            formatExFlowError(
              EXFLOW_ERROR.INVALID_OPTION,
              `resourceCaps['${resourceClass}'] must be a positive integer.`,
            ),
          );
        }
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

  private applyBatchConstraints(batch: PlannedNode<T>[]): PlannedNode<T>[][] {
    const concurrencyCap = this.options.concurrencyCap;
    const resourceCaps = this.options.resourceCaps;
    const hasResourceCaps = resourceCaps && Object.keys(resourceCaps).length > 0;

    if (concurrencyCap === undefined && !hasResourceCaps) {
      return [batch];
    }

    const maxPerBatch = concurrencyCap ?? Number.POSITIVE_INFINITY;
    const remaining = [...batch];
    const constrainedBatches: PlannedNode<T>[][] = [];

    while (remaining.length > 0) {
      const nextBatch = this.selectConstrainedBatch(remaining, maxPerBatch, resourceCaps);
      const selectedIds = new Set(nextBatch.map((item) => item.id));
      const nextRemaining = remaining.filter((item) => !selectedIds.has(item.id));

      remaining.length = 0;
      remaining.push(...nextRemaining);

      constrainedBatches.push(nextBatch);
    }

    return constrainedBatches;
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

  private selectConstrainedBatch(
    sortedNodes: PlannedNode<T>[],
    maxPerBatch = this.options.concurrencyCap ?? Number.POSITIVE_INFINITY,
    resourceCaps = this.options.resourceCaps,
  ): PlannedNode<T>[] {
    const nextBatch: PlannedNode<T>[] = [];
    const resourceUsage: Record<string, number> = {};

    for (let index = 0; index < sortedNodes.length; index += 1) {
      if (nextBatch.length >= maxPerBatch) {
        break;
      }

      const candidate = sortedNodes[index];
      if (!this.canUseResource(candidate, resourceUsage, resourceCaps)) {
        continue;
      }

      nextBatch.push(candidate);
      if (candidate.resourceClass !== undefined) {
        resourceUsage[candidate.resourceClass] = (resourceUsage[candidate.resourceClass] ?? 0) + 1;
      }
    }

    if (nextBatch.length === 0 && sortedNodes.length > 0) {
      throw new Error(
        formatExFlowError(
          EXFLOW_ERROR.INVALID_OPTION,
          "resourceCaps configuration prevents scheduling nodes in any batch.",
        ),
      );
    }

    return nextBatch;
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

  private cloneData(data: T): T {
    const mode = this.options.cloneMode ?? "shallow";

    if (mode === "deep") {
      if (typeof globalThis.structuredClone !== "function") {
        throw new Error(
          formatExFlowError(
            EXFLOW_ERROR.DEEP_CLONE_UNAVAILABLE,
            "Deep clone requested but structuredClone is unavailable in this runtime.",
          ),
        );
      }
      return globalThis.structuredClone(data) as T;
    }

    if (mode === "custom") {
      if (!this.options.cloneFn) {
        throw new Error(
          formatExFlowError(
            EXFLOW_ERROR.CUSTOM_CLONE_FN_REQUIRED,
            "cloneFn is required when cloneMode is 'custom'.",
          ),
        );
      }
      return this.options.cloneFn(data);
    }

    return { ...data };
  }
}

export default ExFlow;

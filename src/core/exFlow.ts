import { radixSort } from "exsorted/non-compare";

import { ExecutionPlan, ExFlowOptions, ExFlowResultItem, ExFlowSafeData, ExNode } from "../types";
import { EXFLOW_ERROR } from "../constants";
import { formatExFlowError } from "../utils";

/**
 * Priority-aware DAG execution planner based on Kahn's Algorithm.
 */
class ExFlow<T extends object & ExFlowSafeData> {
  private nodes: Map<string, ExNode<T>> = new Map();

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
    const batches: ExFlowResultItem<T>[][] = [];
    const fullSequence: ExFlowResultItem<T>[] = [];
    let queue: string[] = [];

    inDegree.forEach((degree, id) => {
      if (degree === 0) queue.push(id);
    });

    while (queue.length > 0) {
      const currentBatch: ExFlowResultItem<T>[] = [];
      const nextQueue: string[] = [];

      for (const id of queue) {
        const node = this.nodes.get(id);
        if (node) {
          const itemWithPriority: ExFlowResultItem<T> = {
            ...(this.cloneData(node.data) as Omit<T, "exFlowPriority">),
            exFlowPriority: node.priority ?? 0,
          };

          currentBatch.push(itemWithPriority);

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

      const sortedBatch = radixSort(currentBatch, (a) => a.exFlowPriority).reverse();

      batches.push(sortedBatch);
      fullSequence.push(...sortedBatch);

      queue = nextQueue;
    }

    if (fullSequence.length !== this.nodes.size) {
      throw new Error(
        formatExFlowError(EXFLOW_ERROR.CYCLE_DETECTED, "Cycle detected in the graph."),
      );
    }

    return { batches, fullSequence };
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

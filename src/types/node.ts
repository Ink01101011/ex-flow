/**
 * Graph node accepted by ExFlow.
 */
export type ExFlowSafeData = {
  /**
   * Reserved internal metadata field injected by ExFlow.
   * User data types must not declare it.
   */
  exFlowPriority?: never;
};

/**
 * Helper alias for consumer models that must remain compatible with ExFlow input constraints.
 */
export type SafeTask<T extends object> = T & ExFlowSafeData;

/**
 * Graph node accepted by ExFlow.
 */
export interface ExNode<T extends object & ExFlowSafeData> {
  /** Unique node id. */
  id: string;
  /** Task payload. */
  data: T;
  /** Node ids that must complete before this node can execute. */
  dependsOn: string[];
  /** Optional priority used for ordering inside the same execution batch. */
  priority?: number;
  /** Optional resource class used with resource cap constraints. */
  resourceClass?: string;
  /** Optional deadline score used by deadline ordering strategies. */
  deadline?: number;
  /** Optional weight score used by weight ordering strategies. */
  weight?: number;
}

/** Clone policy used when ExFlow creates result items. */
export type ExFlowCloneMode = "shallow" | "deep" | "custom";
export type ExFlowTieBreaker<T extends object & ExFlowSafeData> = (
  a: Readonly<ExNode<T>>,
  b: Readonly<ExNode<T>>,
) => number;
export type DeadlineStrategy = "earliest-first" | "latest-first";
export type WeightStrategy = "higher-first" | "lower-first";
export type ExFlowSchedulerMode = "level" | "throughput";
export type ExFlowTieFallbackPolicy = "insertion" | "id-asc" | "id-desc";

/**
 * Runtime options for ExFlow.
 */
export interface ExFlowOptions<T extends object & ExFlowSafeData> {
  /**
   * Clone behavior for output items.
   * Defaults to `shallow`.
   */
  cloneMode?: ExFlowCloneMode;
  /**
   * Custom clone function used only when cloneMode is `custom`.
   */
  cloneFn?: (data: T) => T;

  /**
   * If true, nodes with lower priority values are executed first.
   * Defaults to `false` (higher priority first).
   */
  priorityAscending?: boolean;
  /**
   * Optional tie-breaker used when two nodes have the same priority.
   * When provided, ExFlow switches to a compare-based sort implementation.
   */
  tieBreaker?: ExFlowTieBreaker<T>;
  /**
   * Optional maximum number of nodes allowed in a single emitted batch.
   */
  concurrencyCap?: number;
  /**
   * Optional per-resource-class caps for nodes emitted in the same batch.
   */
  resourceCaps?: Record<string, number>;
  /**
   * Optional strategy for ordering by node deadline.
   */
  deadlineStrategy?: DeadlineStrategy;
  /**
   * Optional strategy for ordering by node weight.
   */
  weightStrategy?: WeightStrategy;
  /**
   * Scheduler mode:
   * - `level` keeps strict level-by-level release.
   * - `throughput` can unlock and schedule newly-ready nodes between constrained sub-batches.
   */
  schedulerMode?: ExFlowSchedulerMode;
  /**
   * Fallback deterministic tie policy when priority/deadline/weight/tieBreaker are equal.
   * Defaults to `insertion`.
   */
  tieFallbackPolicy?: ExFlowTieFallbackPolicy;
}

/**
 * The resulting item shape returned by ExFlow.
 * `exFlowPriority` is metadata injected by ExFlow and must not exist in input data.
 */
export type ExFlowResultItem<T extends object & ExFlowSafeData> = Omit<T, "exFlowPriority"> & {
  exFlowPriority: number;
};

/**
 * Clone behavior depends on ExFlow options:
 * - shallow (default): nested objects inside `data` keep original references.
 * - deep: nested objects are fully cloned.
 * - custom: cloning behavior is controlled by user-provided cloneFn.
 */
export interface ExecutionPlan<T extends object & ExFlowSafeData> {
  batches: ExFlowResultItem<T>[][];
  fullSequence: ExFlowResultItem<T>[];
}

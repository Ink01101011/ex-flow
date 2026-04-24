import {
  ExFlowExecutionDetails,
  ExFlowMetrics,
  ExFlowOptions,
  ExFlowSafeData,
  ExNode,
  ExecutionPlan,
} from "../../types";

export type UseExFlowOptions<T extends object & ExFlowSafeData> = ExFlowOptions<T> & {
  log?: "debug" | "error";
};

export type UseExFlowNodeMapper<TSource, T extends object & ExFlowSafeData> = (
  item: TSource,
  index: number,
  allItems: readonly TSource[],
) => ExNode<T>;

export type UseExFlowResult<T extends object & ExFlowSafeData> = {
  resolvePlan: () => ExecutionPlan<T>;
  resolveDetails: () => ExFlowExecutionDetails<T>;
  getLastMetrics: () => ExFlowMetrics | null;
  addEntities: (entities: ExNode<T>[]) => void;
  mapDataToNodes: <TSource>(
    items: readonly TSource[],
    mapper: UseExFlowNodeMapper<TSource, T>,
  ) => ExNode<T>[];
  addFromData: <TSource>(
    items: readonly TSource[],
    mapper: UseExFlowNodeMapper<TSource, T>,
  ) => ExNode<T>[];
};

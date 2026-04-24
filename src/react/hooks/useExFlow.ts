import React from "react";

import ExFlow from "../../core/exFlow";
import { ExFlowSafeData, ExNode } from "../../types";
import { serializeExFlowError } from "../../utils";
import { UseExFlowNodeMapper, UseExFlowOptions, UseExFlowResult } from "../types";

export function useExFlow<T extends object & ExFlowSafeData>(
  options?: UseExFlowOptions<T>,
): UseExFlowResult<T> {
  const log = options?.log || "debug";
  const [exFlowInstance] = React.useState(() => new ExFlow(options));
  const isDebugMode = process.env.NODE_ENV !== "production";

  const logSerializedDiagnostics = React.useCallback(
    (error: unknown, context: string) => {
      if (!isDebugMode) {
        return;
      }

      const event = serializeExFlowError(error);
      console[log](`[ex-flow/react:${context}]`, event);
    },
    [isDebugMode, log],
  );

  const handleAddEntities = React.useCallback(
    (entities: ExNode<T>[]) => {
      try {
        entities.forEach((entity) => {
          exFlowInstance.addEntity(entity);
        });
      } catch (error) {
        logSerializedDiagnostics(error, "addEntities");
        throw error;
      }
    },
    [exFlowInstance, logSerializedDiagnostics],
  );

  const mapDataToNodes = React.useCallback(
    <TSource>(items: readonly TSource[], mapper: UseExFlowNodeMapper<TSource, T>): ExNode<T>[] => {
      return items.map((item, index) => mapper(item, index, items));
    },
    [],
  );

  const addFromData = React.useCallback(
    <TSource>(items: readonly TSource[], mapper: UseExFlowNodeMapper<TSource, T>): ExNode<T>[] => {
      try {
        const nodes = mapDataToNodes(items, mapper);
        handleAddEntities(nodes);
        return nodes;
      } catch (error) {
        logSerializedDiagnostics(error, "addFromData");
        throw error;
      }
    },
    [handleAddEntities, logSerializedDiagnostics, mapDataToNodes],
  );

  const resolvePlan = React.useCallback(() => {
    try {
      return exFlowInstance.resolveExecutionPlan();
    } catch (error) {
      logSerializedDiagnostics(error, "resolvePlan");
      throw error;
    }
  }, [exFlowInstance, logSerializedDiagnostics]);

  const resolveDetails = React.useCallback(() => {
    try {
      return exFlowInstance.resolveExecutionDetails();
    } catch (error) {
      logSerializedDiagnostics(error, "resolveDetails");
      throw error;
    }
  }, [exFlowInstance, logSerializedDiagnostics]);

  const getLastMetrics = React.useCallback(() => exFlowInstance.getLastMetrics(), [exFlowInstance]);

  return {
    resolvePlan,
    resolveDetails,
    getLastMetrics,
    addEntities: handleAddEntities,
    mapDataToNodes,
    addFromData,
  };
}

export default useExFlow;

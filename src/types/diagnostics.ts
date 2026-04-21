import { ExecutionPlan, ExFlowSafeData, ExFlowSchedulerMode } from "./node";

export interface ExFlowDiagnostics {
  cyclePath?: string[];
  unresolvedNodeIds?: string[];
  invalidOptionField?: string;
  invalidOptionValue?: unknown;
  details?: string;
}

export interface ExFlowMetrics {
  schedulerMode: ExFlowSchedulerMode;
  rounds: number;
  emittedNodes: number;
  deferredNodes: number;
  maxReadyQueueSize: number;
  constraintHits: {
    concurrencyCap: number;
    resourceCaps: number;
  };
}

export interface ExFlowExecutionDetails<T extends object & ExFlowSafeData> {
  plan: ExecutionPlan<T>;
  metrics: ExFlowMetrics;
}

export interface ExFlowObservabilityEvent {
  source: "ex-flow";
  code?: string;
  message: string;
  name: string;
  diagnostics?: ExFlowDiagnostics;
  timestamp: string;
}

export type ExFlowOpenTelemetryAttributes = Record<string, string | number | boolean>;
export type ExFlowDatadogLogFields = Record<string, string | number | boolean | null>;

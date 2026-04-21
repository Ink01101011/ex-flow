import ExFlowRuntimeError from "../errors/exFlowRuntimeError";
import { ExFlowObservabilityEvent } from "../types";

/**
 * Normalizes unknown errors into a consistent observability payload.
 */
export const serializeExFlowError = (
  error: unknown,
  timestamp = new Date().toISOString(),
): ExFlowObservabilityEvent => {
  if (error instanceof ExFlowRuntimeError) {
    return {
      source: "ex-flow",
      code: error.code,
      message: error.message,
      name: error.name,
      diagnostics: error.diagnostics,
      timestamp,
    };
  }

  if (error instanceof Error) {
    return {
      source: "ex-flow",
      message: error.message,
      name: error.name,
      timestamp,
    };
  }

  return {
    source: "ex-flow",
    message: typeof error === "string" ? error : "Unknown error",
    name: "UnknownError",
    timestamp,
  };
};

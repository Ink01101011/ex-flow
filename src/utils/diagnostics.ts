import ExFlowRuntimeError from "../errors/exFlowRuntimeError";
import {
  ExFlowDatadogLogFields,
  ExFlowObservabilityEvent,
  ExFlowOpenTelemetryAttributes,
} from "../types";

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

/**
 * Maps an observability payload to OpenTelemetry attributes.
 */
export const toOpenTelemetryAttributes = (
  event: ExFlowObservabilityEvent,
): ExFlowOpenTelemetryAttributes => {
  const attributes: ExFlowOpenTelemetryAttributes = {
    "exflow.source": event.source,
    "exflow.name": event.name,
    "exflow.message": event.message,
    "exflow.timestamp": event.timestamp,
  };

  if (event.code) {
    attributes["exflow.code"] = event.code;
  }

  if (event.diagnostics?.cyclePath) {
    attributes["exflow.cycle_path"] = event.diagnostics.cyclePath.join("->");
  }
  if (event.diagnostics?.unresolvedNodeIds) {
    attributes["exflow.unresolved_nodes"] = event.diagnostics.unresolvedNodeIds.join(",");
  }
  if (event.diagnostics?.invalidOptionField) {
    attributes["exflow.invalid_option_field"] = event.diagnostics.invalidOptionField;
  }
  if (event.diagnostics?.invalidOptionValue !== undefined) {
    attributes["exflow.invalid_option_value"] = String(event.diagnostics.invalidOptionValue);
  }
  if (event.diagnostics?.details) {
    attributes["exflow.details"] = event.diagnostics.details;
  }

  return attributes;
};

/**
 * Maps an observability payload to Datadog-style log fields.
 */
export const toDatadogLogFields = (event: ExFlowObservabilityEvent): ExFlowDatadogLogFields => ({
  source: event.source,
  service: "ex-flow",
  status: "error",
  error_code: event.code ?? null,
  error_name: event.name,
  message: event.message,
  timestamp: event.timestamp,
  diagnostics_cycle_path: event.diagnostics?.cyclePath?.join("->") ?? null,
  diagnostics_unresolved_nodes: event.diagnostics?.unresolvedNodeIds?.join(",") ?? null,
  diagnostics_invalid_option_field: event.diagnostics?.invalidOptionField ?? null,
  diagnostics_invalid_option_value:
    event.diagnostics?.invalidOptionValue !== undefined
      ? String(event.diagnostics.invalidOptionValue)
      : null,
  diagnostics_details: event.diagnostics?.details ?? null,
});

import ExFlowRuntimeError from "../errors/exFlowRuntimeError";
import {
  ExFlowCustomMappedFields,
  ExFlowDatadogLogFields,
  ExFlowDiagnosticsMapperOptions,
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

const normalizeValue = (value: unknown): string | number | boolean | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return String(value);
};

/**
 * Creates a configurable diagnostics field mapper.
 */
export const createDiagnosticsMapper = (
  options: ExFlowDiagnosticsMapperOptions = {},
): ((event: ExFlowObservabilityEvent) => ExFlowCustomMappedFields) => {
  const {
    keyPrefix,
    separator = ".",
    fieldNameMap = {},
    staticFields = {},
    includeNulls = false,
    valueTransform,
  } = options;

  const mapKey = (baseKey: keyof NonNullable<typeof fieldNameMap> | string): string => {
    const mapped = (fieldNameMap as Record<string, string>)[baseKey] ?? baseKey;
    return keyPrefix ? `${keyPrefix}${separator}${mapped}` : mapped;
  };

  const put = (
    target: ExFlowCustomMappedFields,
    event: ExFlowObservabilityEvent,
    key: string,
    baseKey: string,
    value: unknown,
  ): void => {
    const transformed = valueTransform ? valueTransform(value, baseKey, event) : value;
    const normalized = normalizeValue(transformed);
    if (normalized === null && !includeNulls) {
      return;
    }
    target[key] = normalized;
  };

  return (event: ExFlowObservabilityEvent): ExFlowCustomMappedFields => {
    const mapped: ExFlowCustomMappedFields = { ...staticFields };

    put(mapped, event, mapKey("source"), "source", event.source);
    put(mapped, event, mapKey("code"), "code", event.code);
    put(mapped, event, mapKey("message"), "message", event.message);
    put(mapped, event, mapKey("name"), "name", event.name);
    put(mapped, event, mapKey("timestamp"), "timestamp", event.timestamp);

    put(mapped, event, mapKey("cyclePath"), "cyclePath", event.diagnostics?.cyclePath?.join("->"));
    put(
      mapped,
      event,
      mapKey("unresolvedNodeIds"),
      "unresolvedNodeIds",
      event.diagnostics?.unresolvedNodeIds?.join(","),
    );
    put(
      mapped,
      event,
      mapKey("invalidOptionField"),
      "invalidOptionField",
      event.diagnostics?.invalidOptionField,
    );
    put(
      mapped,
      event,
      mapKey("invalidOptionValue"),
      "invalidOptionValue",
      event.diagnostics?.invalidOptionValue,
    );
    put(mapped, event, mapKey("details"), "details", event.diagnostics?.details);

    return mapped;
  };
};

/**
 * Maps an observability payload to OpenTelemetry attributes.
 */
export const toOpenTelemetryAttributes = (
  event: ExFlowObservabilityEvent,
): ExFlowOpenTelemetryAttributes => {
  const mapper = createDiagnosticsMapper({
    keyPrefix: "exflow",
    separator: ".",
    fieldNameMap: {
      cyclePath: "cycle_path",
      unresolvedNodeIds: "unresolved_nodes",
      invalidOptionField: "invalid_option_field",
      invalidOptionValue: "invalid_option_value",
    },
    valueTransform: (value, key) => {
      if (key === "invalidOptionValue" && value !== undefined && value !== null) {
        return String(value);
      }
      return value;
    },
  });
  return mapper(event) as ExFlowOpenTelemetryAttributes;
};

/**
 * Maps an observability payload to Datadog-style log fields.
 */
export const toDatadogLogFields = (event: ExFlowObservabilityEvent): ExFlowDatadogLogFields => {
  const mapper = createDiagnosticsMapper({
    separator: "_",
    includeNulls: true,
    fieldNameMap: {
      code: "error_code",
      name: "error_name",
      cyclePath: "diagnostics_cycle_path",
      unresolvedNodeIds: "diagnostics_unresolved_nodes",
      invalidOptionField: "diagnostics_invalid_option_field",
      invalidOptionValue: "diagnostics_invalid_option_value",
      details: "diagnostics_details",
    },
    staticFields: {
      service: "ex-flow",
      status: "error",
    },
    valueTransform: (value, key) => {
      if (key === "invalidOptionValue" && value !== undefined && value !== null) {
        return String(value);
      }
      return value;
    },
  });
  return mapper(event) as ExFlowDatadogLogFields;
};

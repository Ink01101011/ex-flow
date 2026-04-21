export const formatExFlowError = (code: string, message: string): string => `[${code}] ${message}`;
export {
  createDiagnosticsMapper,
  serializeExFlowError,
  toDatadogLogFields,
  toOpenTelemetryAttributes,
} from "./diagnostics";

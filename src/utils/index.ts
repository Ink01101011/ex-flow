export const formatExFlowError = (code: string, message: string): string => `[${code}] ${message}`;
export { serializeExFlowError, toDatadogLogFields, toOpenTelemetryAttributes } from "./diagnostics";

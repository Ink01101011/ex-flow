import { ExFlowDiagnostics } from "../types";
import { formatExFlowError } from "../utils";

class ExFlowRuntimeError extends Error {
  readonly code: string;
  readonly diagnostics?: ExFlowDiagnostics;

  constructor(code: string, message: string, diagnostics?: ExFlowDiagnostics) {
    super(formatExFlowError(code, message));
    this.name = "ExFlowRuntimeError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export default ExFlowRuntimeError;

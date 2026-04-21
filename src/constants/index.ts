/**
 * Standardized error codes emitted by ExFlow.
 */
export const EXFLOW_ERROR = {
  /** Node id already exists in the graph. */
  DUPLICATE_NODE: "EXFLOW_DUPLICATE_NODE",
  /** Input data contains reserved `exFlowPriority` field. */
  RESERVED_FIELD: "EXFLOW_RESERVED_FIELD",
  /** A dependency id does not exist in the graph. */
  UNKNOWN_DEPENDENCY: "EXFLOW_UNKNOWN_DEPENDENCY",
  /** Graph contains at least one cycle. */
  CYCLE_DETECTED: "EXFLOW_CYCLE_DETECTED",
  /** cloneMode is `custom` but cloneFn was not provided. */
  CUSTOM_CLONE_FN_REQUIRED: "EXFLOW_CUSTOM_CLONE_FN_REQUIRED",
  /** Deep clone was requested in a runtime without structuredClone. */
  DEEP_CLONE_UNAVAILABLE: "EXFLOW_DEEP_CLONE_UNAVAILABLE",
} as const;

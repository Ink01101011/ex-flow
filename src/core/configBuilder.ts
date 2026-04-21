import { EXFLOW_ERROR } from "../constants";
import { ExFlowOptions, ExFlowSafeData } from "../types";
import { formatExFlowError } from "../utils";

/**
 * Fluent builder for ExFlow runtime options.
 */
class ExFlowConfigBuilder<T extends object & ExFlowSafeData> {
  private options: ExFlowOptions<T> = {};

  useShallowClone(): this {
    const { cloneFn: _cloneFn, ...rest } = this.options;
    this.options = {
      ...rest,
      cloneMode: "shallow",
    };
    return this;
  }

  useDeepClone(): this {
    const { cloneFn: _cloneFn, ...rest } = this.options;
    this.options = {
      ...rest,
      cloneMode: "deep",
    };
    return this;
  }

  useCustomClone(cloneFn: (data: T) => T): this {
    this.options = {
      ...this.options,
      cloneMode: "custom",
      cloneFn,
    };
    return this;
  }

  withPriorityAscending(priorityAscending: boolean): this {
    this.options = {
      ...this.options,
      priorityAscending,
    };
    return this;
  }

  build(): ExFlowOptions<T> {
    if (this.options.cloneMode === "custom" && !this.options.cloneFn) {
      throw new Error(
        formatExFlowError(
          EXFLOW_ERROR.CUSTOM_CLONE_FN_REQUIRED,
          "cloneFn is required when cloneMode is 'custom'.",
        ),
      );
    }

    return { ...this.options };
  }
}

export const createExFlowConfigBuilder = <
  T extends object & ExFlowSafeData,
>(): ExFlowConfigBuilder<T> => new ExFlowConfigBuilder<T>();

export default ExFlowConfigBuilder;

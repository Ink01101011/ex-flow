import { EXFLOW_ERROR } from "../constants";
import { ExFlowOptions, ExFlowSafeData } from "../types";
import { formatExFlowError } from "../utils";
import { getExFlowPreset } from "./presets";

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

  withTieBreaker(tieBreaker: NonNullable<ExFlowOptions<T>["tieBreaker"]>): this {
    this.options = {
      ...this.options,
      tieBreaker,
    };
    return this;
  }

  withConcurrencyCap(concurrencyCap: number): this {
    this.options = {
      ...this.options,
      concurrencyCap,
    };
    return this;
  }

  withResourceCaps(resourceCaps: Record<string, number>): this {
    this.options = {
      ...this.options,
      resourceCaps: { ...resourceCaps },
    };
    return this;
  }

  withDeadlineStrategy(deadlineStrategy: NonNullable<ExFlowOptions<T>["deadlineStrategy"]>): this {
    this.options = {
      ...this.options,
      deadlineStrategy,
    };
    return this;
  }

  withWeightStrategy(weightStrategy: NonNullable<ExFlowOptions<T>["weightStrategy"]>): this {
    this.options = {
      ...this.options,
      weightStrategy,
    };
    return this;
  }

  withFairnessPolicy(fairnessPolicy: NonNullable<ExFlowOptions<T>["fairnessPolicy"]>): this {
    this.options = {
      ...this.options,
      fairnessPolicy,
    };
    return this;
  }

  withMaxDeferralRounds(maxDeferralRounds: number): this {
    this.options = {
      ...this.options,
      maxDeferralRounds,
    };
    return this;
  }

  requireResourceCapForAllClasses(requireResourceCapForAllClasses = true): this {
    this.options = {
      ...this.options,
      requireResourceCapForAllClasses,
    };
    return this;
  }

  withSchedulerMode(schedulerMode: NonNullable<ExFlowOptions<T>["schedulerMode"]>): this {
    this.options = {
      ...this.options,
      schedulerMode,
    };
    return this;
  }

  withTieFallbackPolicy(
    tieFallbackPolicy: NonNullable<ExFlowOptions<T>["tieFallbackPolicy"]>,
  ): this {
    this.options = {
      ...this.options,
      tieFallbackPolicy,
    };
    return this;
  }

  withPreset(presetName: NonNullable<ExFlowOptions<T>["presetName"]>): this {
    this.options = {
      ...this.options,
      ...getExFlowPreset<T>(presetName),
      presetName,
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

import { ExFlowFairnessPolicy, ExFlowOptions, ExFlowPresetName, ExFlowSafeData } from "../types";

type PresetOptions<T extends object & ExFlowSafeData> = Pick<
  ExFlowOptions<T>,
  | "schedulerMode"
  | "priorityAscending"
  | "tieFallbackPolicy"
  | "fairnessPolicy"
  | "maxDeferralRounds"
  | "concurrencyCap"
>;

type GenericPresetOptions = PresetOptions<Record<string, never> & ExFlowSafeData>;

const PRESET_CONFIG: Record<ExFlowPresetName, GenericPresetOptions> = {
  "stable-enterprise": {
    schedulerMode: "level",
    priorityAscending: false,
    tieFallbackPolicy: "insertion",
    fairnessPolicy: "none",
  },
  "high-throughput": {
    schedulerMode: "throughput",
    priorityAscending: false,
    tieFallbackPolicy: "id-asc",
    fairnessPolicy: "aging",
    maxDeferralRounds: 2,
  },
  "strict-fairness": {
    schedulerMode: "throughput",
    priorityAscending: false,
    tieFallbackPolicy: "insertion",
    fairnessPolicy: "aging",
    maxDeferralRounds: 1,
  },
};

export const getExFlowPreset = <T extends object & ExFlowSafeData>(
  preset: ExFlowPresetName,
): PresetOptions<T> => ({ ...PRESET_CONFIG[preset] });

export const resolveFairnessPolicy = (
  fairnessPolicy: ExFlowFairnessPolicy | undefined,
): ExFlowFairnessPolicy => fairnessPolicy ?? "none";

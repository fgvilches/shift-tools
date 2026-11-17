/** Display units and scale helpers for the speed test view. */

export type RateUnit = "mbps" | "mbytes";

export const RATE_UNIT_LABEL: Record<RateUnit, string> = {
  mbps: "Mbps",
  mbytes: "MB/s",
};

/** Speed samples arrive in megabits per second. MB/s is Mbps / 8 (one byte = eight bits). */
export function toRateUnit(mbps: number, unit: RateUnit): number {
  return unit === "mbytes" ? mbps / 8 : mbps;
}

export function rateParts(
  mbps: number | null | undefined,
  unit: RateUnit,
  digits = 1,
): { value: string; unit: string } {
  if (mbps === null || mbps === undefined || !Number.isFinite(mbps)) {
    return { value: "—", unit: RATE_UNIT_LABEL[unit] };
  }
  return { value: toRateUnit(mbps, unit).toFixed(digits), unit: RATE_UNIT_LABEL[unit] };
}

const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;

/** Smallest "round" number at or above the value (used for gauge and chart ceilings). */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 10;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const step = NICE_STEPS.find((candidate) => fraction <= candidate) ?? 10;
  return Number((step * base).toPrecision(6));
}

export function secondsLabel(elapsedMs: number | null | undefined): string {
  if (elapsedMs === null || elapsedMs === undefined || !Number.isFinite(elapsedMs)) return "—";
  return `${(Math.max(0, elapsedMs) / 1000).toFixed(2)}s`;
}

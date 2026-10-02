import type { FloorCalibration, FloorCalibrationPoint } from '@tickets/seating';

/** Две точки измеряют масштаб и не задают поворот или положение подложки. */
export function calibrationFromPoints(
  first: FloorCalibrationPoint,
  second: FloorCalibrationPoint,
  distanceMeters: number,
): FloorCalibration {
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return {
    point1: { x: round(first.x), y: round(first.y) },
    point2: { x: round(second.x), y: round(second.y) },
    distanceMeters: round(distanceMeters),
  };
}

export function distanceBySeats(count: number, stepMm: number): number | null {
  return Number.isSafeInteger(count) && count >= 2 && Number.isFinite(stepMm) && stepMm > 0
    ? (count - 1) * stepMm / 1_000
    : null;
}

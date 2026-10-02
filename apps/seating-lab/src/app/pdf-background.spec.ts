import { describe, expect, it } from 'vitest';
import type { PageViewport } from 'pdfjs-dist';
import { pdfCalibrationTransform } from './pdf-background';

describe('PDF calibration', () => {
  const viewport = {
    convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
  } as unknown as PageViewport;

  it('uses the explicit placement while calibration measures only scale', () => {
    const calibration = {
      point1: { x: 72, y: 72 },
      point2: { x: 72, y: 216 },
      distanceMeters: 4.5,
    };
    const transform = pdfCalibrationTransform(viewport, calibration,
      { originX: 400, originY: 600, rotationDegrees: 90 });
    if (!transform) throw new Error('Калибровка должна быть определена.');
    expect(transform.scale).toBeCloseTo(4_500 / 144);
    expect(transform.x).toBe(400);
    expect(transform.y).toBe(600);
    expect(transform.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('rejects non-finite calibration coordinates and distances', () => {
    const valid = {
      point1: { x: 0, y: 0 },
      point2: { x: 0, y: 100 },
      distanceMeters: 1,
    };

    expect(pdfCalibrationTransform(viewport, { ...valid, distanceMeters: Number.NaN })).toBeNull();
    expect(pdfCalibrationTransform(viewport, {
      ...valid,
      point1: { x: Number.POSITIVE_INFINITY, y: 0 },
    })).toBeNull();
  });
});

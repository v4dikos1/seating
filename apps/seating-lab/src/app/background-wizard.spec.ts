import { pdfCalibrationTransform, type RenderedPdfPage } from './pdf-background';
import { calibrationFromPoints, distanceBySeats } from './configurator-background';

const viewport = {
  convertToViewportPoint: (x: number, y: number) => [x, y],
  convertToPdfPoint: (x: number, y: number) => [x, y],
} as unknown as RenderedPdfPage['viewport'];

describe('Мастер подложки', () => {
  it('keeps the measured points independent of placement', () => {
    const calibration = calibrationFromPoints({ x: 20, y: 30 }, { x: 20, y: 130 }, 10);
    expect(calibration.point2).toEqual({ x: 20, y: 130 });
    const transform = pdfCalibrationTransform(viewport, calibration,
      { originX: 300, originY: 400, rotationDegrees: 0 });
    expect(transform).toMatchObject({ x: 300, y: 400, scale: 100 });
    expect(transform?.rotation).toBeCloseTo(0);
  });

  it('вычисляет масштаб по числу кресел и шагу', () => {
    expect(distanceBySeats(5, 500)).toBe(2);
    expect(distanceBySeats(1, 500)).toBeNull();
    const calibration = calibrationFromPoints({ x: 0, y: 0 }, { x: 80, y: 0 }, distanceBySeats(5, 500) ?? 0);
    expect(pdfCalibrationTransform(viewport, calibration)?.scale).toBe(25);
  });

  it('applies explicit rotation without changing measured points', () => {
    for (const angle of [-90, 90]) {
      const calibration = calibrationFromPoints({ x: 10, y: 10 }, { x: 10, y: 110 }, 5);
      expect(calibration.point2).toEqual({ x: 10, y: 110 });
      const transform = pdfCalibrationTransform(viewport, calibration,
        { originX: 0, originY: 0, rotationDegrees: angle });
      expect(transform?.rotation).toBeCloseTo(angle * Math.PI / 180, 4);
      expect(transform?.scale).toBeCloseTo(50, 4);
    }
  });
});

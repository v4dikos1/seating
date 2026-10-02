import { describe, expect, it } from 'vitest';
import { MILLIMETRES_PER_UNIT, SEATING_THEME } from './theme';

describe('theme', () => {
  it('defines consistent theme tokens for canvas and web', () => {
    expect(SEATING_THEME.canvas.background).toBe('#f4f6fa');
    expect(SEATING_THEME.canvas.selectionTint).toBe('#16305c');
    expect(SEATING_THEME.canvas.primary).toBe('#2563eb');
    expect(SEATING_THEME.seatLabel.fill).toBe('#ffffff');
    expect(SEATING_THEME.seatLabel.strokeColor).toBe('#0f172a');
    expect(SEATING_THEME.rowBadge.background).toBe('#1e293b');
  });

  it('keeps real hall dimensions and LOD thresholds ordered', () => {
    // Кресло 45 см, шаг полметра, ряды через 90 см — настоящие величины зала.
    expect(SEATING_THEME.geometry.seatDiameterMm).toBeLessThan(SEATING_THEME.geometry.seatPitchMm);
    expect(SEATING_THEME.geometry.seatPitchMm).toBeLessThan(SEATING_THEME.geometry.rowPitchMm);
    expect(SEATING_THEME.geometry.seatPitchMm).toBeLessThan(1_000);

    expect(SEATING_THEME.lod.seatDotMinPixels).toBeLessThan(SEATING_THEME.lod.seatSpriteMinPixels);
    expect(SEATING_THEME.lod.seatSpriteMinPixels).toBeLessThan(SEATING_THEME.lod.rowLabelMinPixels);
    expect(SEATING_THEME.lod.rowLabelMinPixels).toBeLessThan(SEATING_THEME.lod.seatLabelMinPixels);

    // Предельное приближение обязано показывать кресло читаемым.
    const seatUnits = SEATING_THEME.geometry.seatDiameterMm / MILLIMETRES_PER_UNIT;
    expect(SEATING_THEME.zoom.maxScale * seatUnits).toBeGreaterThan(40);
    expect(SEATING_THEME.zoom.fitMaxScale).toBeLessThan(SEATING_THEME.zoom.maxScale);
    expect(SEATING_THEME.zoom.minScale).toBeGreaterThan(0);
  });
});

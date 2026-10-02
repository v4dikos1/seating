import { describe, expect, it } from 'vitest';
import {
  MILLIMETRES_PER_UNIT, formatArea, formatLength, formatMetres,
  millimetresToUnits, parseLength, unitsToMillimetres,
} from './units';

describe('Units of the seating scene', () => {
  it('treats the scene unit as a metre and the contract integer as a millimetre', () => {
    expect(MILLIMETRES_PER_UNIT).toBe(1_000);
    expect(millimetresToUnits(500)).toBe(0.5);
    expect(unitsToMillimetres(1.5)).toBe(1_500);
    expect(unitsToMillimetres(millimetresToUnits(18_722))).toBe(18_722);
  });

  it('names a length the way a person would', () => {
    expect(formatLength(5)).toBe('5 мм');
    expect(formatLength(450)).toBe('45 см');
    expect(formatLength(500)).toBe('50 см');
    expect(formatLength(900)).toBe('90 см');
    expect(formatLength(1_000)).toBe('1 м');
    expect(formatLength(18_722)).toBe('18,72 м');
    expect(formatLength(245_952)).toBe('246 м');
    expect(formatLength(Number.NaN)).toBe('—');
  });

  it('keeps metres when the reader needs one scale for everything', () => {
    expect(formatMetres(18_722)).toBe('18,7 м');
    expect(formatMetres(500)).toBe('0,5 м');
    expect(formatMetres(2_000, 0)).toBe('2 м');
  });

  it('reports the area of a frame in square metres', () => {
    expect(formatArea(10_000, 5_000)).toBe('50 м²');
    expect(formatArea(245_952, 94_951)).toBe('23353 м²');
    expect(formatArea(0, 1_000)).toBe('—');
  });

  it('parses a length the way a person would type it, always back to millimetres', () => {
    expect(parseLength('450')).toBe(450);
    expect(parseLength('450 мм')).toBe(450);
    expect(parseLength('45 см')).toBe(450);
    expect(parseLength('0,45 м')).toBe(450);
    expect(parseLength('0.45 м')).toBe(450);
    expect(parseLength('18,7 м')).toBe(18_700);
    expect(parseLength('  600  мм  ')).toBe(600);
    expect(parseLength('600 ММ')).toBe(600);
  });

  it('rejects what it cannot honestly parse instead of guessing', () => {
    expect(parseLength('')).toBeNull();
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('см')).toBeNull();
    expect(parseLength('0')).toBeNull();
    expect(parseLength('-50')).toBeNull();
    expect(parseLength('450 футов')).toBeNull();
  });
});

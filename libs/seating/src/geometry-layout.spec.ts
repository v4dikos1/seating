import { describe, expect, it } from 'vitest';
import {
  computeHeaderCandidates,
  isZoneBigEnoughForHeader,
  isZoneVisibleInViewport,
  rectsOverlap,
  resolveHeaderPlacement,
  shouldPreferFullHeader,
  type PlacedRect,
} from './geometry-layout';

describe('geometry-layout', () => {
  describe('rectsOverlap', () => {
    it('detects intersecting rectangles', () => {
      const a: PlacedRect = { x: 0, y: 0, width: 10, height: 10 };
      const b: PlacedRect = { x: 5, y: 5, width: 10, height: 10 };
      expect(rectsOverlap(a, b)).toBe(true);
      expect(rectsOverlap(b, a)).toBe(true);
    });

    it('returns false for disjoint rectangles', () => {
      const a: PlacedRect = { x: 0, y: 0, width: 10, height: 10 };
      const b: PlacedRect = { x: 20, y: 20, width: 10, height: 10 };
      expect(rectsOverlap(a, b)).toBe(false);
    });

    it('returns false when touching edges only', () => {
      const a: PlacedRect = { x: 0, y: 0, width: 10, height: 10 };
      const b: PlacedRect = { x: 10, y: 0, width: 10, height: 10 };
      expect(rectsOverlap(a, b)).toBe(false);
    });

    it('detects containment', () => {
      const outer: PlacedRect = { x: 0, y: 0, width: 50, height: 50 };
      const inner: PlacedRect = { x: 10, y: 10, width: 20, height: 20 };
      expect(rectsOverlap(outer, inner)).toBe(true);
      expect(rectsOverlap(inner, outer)).toBe(true);
    });
  });

  describe('computeHeaderCandidates', () => {
    it('computes 4 candidate coordinates correctly', () => {
      const zx = 100;
      const zy = 50;
      const zw = 200;
      const zh = 100;
      const worldW = 40;
      const invScale = 1;

      const candidates = computeHeaderCandidates(zx, zy, zw, zh, worldW, invScale);
      expect(candidates).toHaveLength(4);

      // 1. Top-left inside: (zx + 10, zy + 8)
      expect(candidates[0]).toEqual({ cx: 110, cy: 58 });

      // 2. Above zone: (zx + 10, zy - 26)
      expect(candidates[1]).toEqual({ cx: 110, cy: 24 });

      // 3. Top-right inside: (zx + zw - worldW - 10, zy + 8)
      expect(candidates[2]).toEqual({ cx: 250, cy: 58 });

      // 4. Bottom-left inside: (zx + 10, zy + zh - 26)
      expect(candidates[3]).toEqual({ cx: 110, cy: 124 });
    });
  });

  describe('isZoneVisibleInViewport', () => {
    it('returns true when inside viewport', () => {
      expect(isZoneVisibleInViewport(10, 10, 100, 100, 800, 600)).toBe(true);
    });

    it('returns false when outside viewport bounds', () => {
      expect(isZoneVisibleInViewport(-200, 10, 100, 100, 800, 600)).toBe(false);
      expect(isZoneVisibleInViewport(900, 10, 100, 100, 800, 600)).toBe(false);
      expect(isZoneVisibleInViewport(10, -200, 100, 100, 800, 600)).toBe(false);
      expect(isZoneVisibleInViewport(10, 700, 100, 100, 800, 600)).toBe(false);
    });
  });

  describe('LOD helpers', () => {
    it('checks zone minimum screen dimensions for header', () => {
      expect(isZoneBigEnoughForHeader(32, 22)).toBe(true);
      expect(isZoneBigEnoughForHeader(31, 22)).toBe(false);
      expect(isZoneBigEnoughForHeader(32, 21)).toBe(false);
      expect(isZoneBigEnoughForHeader(100, 50)).toBe(true);
    });

    it('checks preference for full vs code-only header', () => {
      expect(shouldPreferFullHeader(110)).toBe(true);
      expect(shouldPreferFullHeader(109)).toBe(false);
      expect(shouldPreferFullHeader(200)).toBe(true);
    });
  });

  describe('resolveHeaderPlacement', () => {
    const defaultOptions = {
      zoneX: 100,
      zoneY: 100,
      zoneWidth: 300,
      zoneHeight: 200,
      worldX: 0,
      worldY: 0,
      scale: 1,
      fullWidth: 60,
      codeWidth: 20,
      viewportWidth: 1000,
      viewportHeight: 800,
      placedObstacles: [],
    };

    it('places first candidate when no obstacles exist', () => {
      const result = resolveHeaderPlacement(defaultOptions);
      expect(result).not.toBeNull();
      expect(result?.placed).toBe(true);
      expect(result?.useFull).toBe(true);
      expect(result?.screenRect.x).toBe(110);
      expect(result?.screenRect.y).toBe(108);
    });

    it('skips candidate colliding with placed obstacle and chooses next available', () => {
      // First candidate will be at (110, 108, width: 76, height: 22)
      const obstacle: PlacedRect = { x: 110, y: 108, width: 76, height: 22 };
      const result = resolveHeaderPlacement({
        ...defaultOptions,
        placedObstacles: [obstacle],
      });

      expect(result).not.toBeNull();
      expect(result?.placed).toBe(true);
      // Candidate 2 is above zone: (110, 74)
      expect(result?.screenRect.x).toBe(110);
      expect(result?.screenRect.y).toBe(74);
    });

    it('returns null if zone is outside viewport', () => {
      const result = resolveHeaderPlacement({
        ...defaultOptions,
        worldX: -2000,
      });
      expect(result).toBeNull();
    });

    it('returns null if zone is smaller than minimum LOD on screen', () => {
      const result = resolveHeaderPlacement({
        ...defaultOptions,
        scale: 0.05, // 300 * 0.05 = 15px < 32px
      });
      expect(result).toBeNull();
    });

    it('falls back to codeOnly when full name candidates collide or width is small', () => {
      // With width 80px (80 * 1 = 80 < 110), only codeOnly is tried
      const result = resolveHeaderPlacement({
        ...defaultOptions,
        zoneWidth: 80,
      });
      expect(result).not.toBeNull();
      expect(result?.useFull).toBe(false);
    });

    it('respects seat collision callback', () => {
      const result = resolveHeaderPlacement({
        ...defaultOptions,
        checkSeatCollision: (cand) => cand.cy === 108, // Reject first candidate
      });
      expect(result).not.toBeNull();
      // Should pick candidate 2 above zone
      expect(result?.candidate.cy).toBe(74);
    });
  });
});

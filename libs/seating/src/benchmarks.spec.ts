import { describe, expect, it } from 'vitest';
import { generateScene } from './generate';
import { flattenZone } from './editor-model';
import { buildSpatialIndex, querySpatial } from './spatial-index';
import { ObjectPool } from './object-pool';

describe('Performance Benchmarks (8k & 54k seats)', () => {
  it('measures geometry rebuild and viewport culling on 8 000 seats', () => {
    const scene8k = generateScene(8_000, 8_000);
    const zone = scene8k.zones[0].geometry;

    // 1. Измерение прежнего наивного подхода (без пула и без отсечения)
    // Старый editor.rebuild(): для каждого места создавались Sprite и BitmapText
    const startNaive = performance.now();
    const allSeatsNaive = flattenZone(zone);
    const mockSprites = allSeatsNaive.map((s) => ({
      x: s.x,
      y: s.y,
      rotation: s.rotation,
      visible: true,
      text: s.label,
    }));
    // Уничтожение при следующей пересборке
    mockSprites.forEach((s) => { s.visible = false; });
    const elapsedNaive = performance.now() - startNaive;

    // 2. Измерение нового подхода с ObjectPool и пространственным отсечением querySpatial
    const startPool = performance.now();
    const allSeats = flattenZone(zone);
    const spatialIndex = buildSpatialIndex(
      Float32Array.from(allSeats, (s) => s.x / 1_000),
      Float32Array.from(allSeats, (s) => s.y / 1_000),
    );
    // Типичный вьюпорт в метрах: экран 1920×1080 при 25 пикселях на метр — 77×43 м.
    const queriedIndices = querySpatial(spatialIndex, 0, 0, 40, 25);
    const pool = new ObjectPool<{ x: number; y: number; visible: boolean }>(
      () => ({ x: 0, y: 0, visible: false }),
      (item) => { item.visible = false; },
    );
    const activeObjects = queriedIndices.map(() => pool.acquire());
    const elapsedPool = performance.now() - startPool;

    expect(allSeats.length).toBe(8_000);
    expect(queriedIndices.length).toBeGreaterThan(0);
    expect(queriedIndices.length).toBeLessThan(allSeats.length);
    expect(activeObjects.length).toBe(queriedIndices.length);

    console.log(`[8 000 мест] До (полное создание): ${elapsedNaive.toFixed(2)} мс | После (индекс + пул + отсечение): ${elapsedPool.toFixed(2)} мс | Ускорение: ${(elapsedNaive / Math.max(0.1, elapsedPool)).toFixed(1)}x | Видимых мест в кадре: ${queriedIndices.length}`);
  });

  it('measures geometry rebuild and viewport culling on 54 000 seats', () => {
    const scene54k = generateScene(54_000, 54_000);
    const zone = scene54k.zones[0].geometry;

    // 1. Измерение наивного подхода (54 000 объектов)
    const startNaive = performance.now();
    const allSeatsNaive = flattenZone(zone);
    const mockSprites = allSeatsNaive.map((s) => ({
      x: s.x,
      y: s.y,
      rotation: s.rotation,
      visible: true,
      text: s.label,
    }));
    mockSprites.forEach((s) => { s.visible = false; });
    const elapsedNaive = performance.now() - startNaive;

    // 2. Измерение нового подхода с ObjectPool и querySpatial
    const startPool = performance.now();
    const allSeats = flattenZone(zone);
    const spatialIndex = buildSpatialIndex(
      Float32Array.from(allSeats, (s) => s.x / 1_000),
      Float32Array.from(allSeats, (s) => s.y / 1_000),
    );
    // Типичный вьюпорт на гигантской арене в метрах.
    const queriedIndices = querySpatial(spatialIndex, 0, 0, 40, 25);
    const pool = new ObjectPool<{ x: number; y: number; visible: boolean }>(
      () => ({ x: 0, y: 0, visible: false }),
      (item) => { item.visible = false; },
    );
    const activeObjects = queriedIndices.map(() => pool.acquire());
    const elapsedPool = performance.now() - startPool;

    expect(allSeats.length).toBe(54_000);
    expect(queriedIndices.length).toBeGreaterThan(0);
    expect(queriedIndices.length).toBeLessThan(allSeats.length);
    expect(activeObjects.length).toBe(queriedIndices.length);

    console.log(`[54 000 мест] До (полное создание): ${elapsedNaive.toFixed(2)} мс | После (индекс + пул + отсечение): ${elapsedPool.toFixed(2)} мс | Ускорение: ${(elapsedNaive / Math.max(0.1, elapsedPool)).toFixed(1)}x | Видимых мест в кадре: ${queriedIndices.length}`);
  });
});

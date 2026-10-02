import { generateScene } from './generate';
import {
  SEAT_SPRITE_LOD_SCALE, applySalesStatus, createRenderGeometry, packText, readSalesStatus, readText,
  renderTransferables, resolveRenderResolution, seatDotPixels, seatScreenPixels, selectedHaloPixels,
  zoneLabelText,
  seatMagnification,
  SEAT_DIAMETER_UNITS,
} from './render-model';
import { SEATING_THEME } from './theme';
import { buildSpatialIndex, querySpatial } from './spatial-index';

describe('Worker render representation', () => {
  it('keeps Unicode labels and checks bounds', () => {
    const values = ['', 'Ряд А', 'Հայերեն', '🎫'];
    const packed = packText(values);
    expect(values.map((_, index) => readText(packed, index))).toEqual(values);
    for (const index of [-1, 4, 0.5]) expect(() => readText(packed, index)).toThrow();
  });

  it('indexes a large single zone without scanning all its places for a click', () => {
    const geometry = createRenderGeometry(generateScene(54_000, 54_000));
    // Небольшое окно у левого верхнего угла зоны: индекс отдаёт кандидатов ячеек,
    // а не все 54 000 мест.
    const candidates = querySpatial(geometry.spatial, 1, 1, 6, 5);
    expect(candidates).toContain(0);
    expect(candidates.length).toBeLessThan(500);
    expect(geometry.zoneSlots.length).toBe(54_000);
    expect(geometry.zones[0].count).toBe(54_000);
    expect(new Set(renderTransferables(geometry)).size).toBe(14);
  });

  it('carries the zone kind and keeps a free zone out of the position buffers', () => {
    const geometry = createRenderGeometry(generateScene(10, 10, { freeZoneCapacity: 500 }));
    expect(geometry.zones.map((zone) => zone.kind)).toEqual(['Numbered', 'Free']);
    expect(geometry.zones[1].count).toBe(0);
    expect(geometry.zones[1].capacity).toBe(500);
    expect(geometry.x.length).toBe(10);
  });

  it('handles negative coordinates, exact cell boundaries and empty scenes', () => {
    const index = buildSpatialIndex(new Float32Array([-128, 0, 128]), new Float32Array([0, 0, 0]));
    expect(querySpatial(index, -128, 0, -128, 0)).toEqual([0]);
    expect(querySpatial(index, 128, 0, 128, 0)).toEqual([2]);
    expect(querySpatial(index, -1_000, -1_000, 1_000, 1_000).sort()).toEqual([0, 1, 2]);
    expect(querySpatial(buildSpatialIndex(new Float32Array(), new Float32Array()), 0, 0, 1, 1)).toEqual([]);
    expect(() => buildSpatialIndex(new Float32Array([NaN]), new Float32Array([0]))).toThrow();
  });

  it('populates rowHeaders for populated rows and ignores empty rows', () => {
    const scene = generateScene(10, 10);
    // Add an empty row to the first zone
    scene.zones[0].geometry.rows.push({
      id: 'empty-row',
      label: 'Пустой',
      positions: [],
    });
    const geometry = createRenderGeometry(scene);
    const zone = geometry.zones[0];
    expect(zone.rowHeaders).toBeDefined();
    // Only the row with positions should have a rowHeader
    expect(zone.rowHeaders?.length).toBe(1);
    const header = zone.rowHeaders?.[0];
    expect(header).toBeDefined();
    if (!header) return;
    expect(header.label).toBe('1');
    expect(header.count).toBe(10);
    expect(header.startX).toBe(scene.zones[0].geometry.rows[0].positions[0].x / 1_000);
    expect(header.startY).toBe(scene.zones[0].geometry.rows[0].positions[0].y / 1_000);
    expect(header.endX).toBe(scene.zones[0].geometry.rows[0].positions[9].x / 1_000);
    expect(header.endY).toBe(scene.zones[0].geometry.rows[0].positions[9].y / 1_000);

  });

  it('derives LOD thresholds from the real seat size, in screen pixels', async () => {
    const { SEAT_DIAMETER_UNITS, isSeatLabelVisible, isRowLabelVisible, isSeatSpriteVisible, seatScreenPixels } =
      await import('./render-model');
    const { SEATING_THEME } = await import('./theme');

    // Порог назван в пикселях на место, поэтому смена размера кресла его не ломает.
    expect(SEAT_DIAMETER_UNITS).toBe(SEATING_THEME.geometry.seatDiameterMm / 1_000);
    const atPixels = (pixels: number) => pixels / SEAT_DIAMETER_UNITS;
    expect(seatScreenPixels(atPixels(12))).toBeCloseTo(12);

    for (const [visible, minPixels] of [
      [isSeatLabelVisible, SEATING_THEME.lod.seatLabelMinPixels],
      [isRowLabelVisible, SEATING_THEME.lod.rowLabelMinPixels],
      [isSeatSpriteVisible, SEATING_THEME.lod.seatSpriteMinPixels],
    ] as const) {
      expect(visible(atPixels(minPixels))).toBe(true);
      expect(visible(atPixels(minPixels * 2))).toBe(true);
      expect(visible(atPixels(minPixels * 0.99))).toBe(false);
    }
  });

  describe('sales status overlay (applied after decoding, in the main thread)', () => {
    it('returns null before any overlay has been applied', () => {
      const geometry = createRenderGeometry(generateScene(10, 10));
      expect(readSalesStatus(geometry, 0)).toBeNull();
    });

    it('carries the status of a known position inside a saleable zone', () => {
      const geometry = createRenderGeometry(generateScene(10, 10));
      const zoneId = geometry.zones[0].zoneId;
      const heldPositionId = readText(geometry.positionIds, 0);
      applySalesStatus(geometry, {
        statusByPosition: new Map([[heldPositionId, 'Held']]),
        saleableZoneIds: new Set([zoneId]),
      });

      expect(readSalesStatus(geometry, 0)).toBe('Held');
      // Продаваемая зона, но у этой позиции нет записи о продаже: служебная, вне продажи.
      expect(readSalesStatus(geometry, 1)).toBe('NotForSale');
    });

    it('marks every position of a zone outside the saleable set as not for sale', () => {
      const geometry = createRenderGeometry(generateScene(10, 10));
      const zoneId = geometry.zones[0].zoneId;
      const positionId = readText(geometry.positionIds, 0);
      applySalesStatus(geometry, {
        statusByPosition: new Map([[positionId, 'Sold']]),
        saleableZoneIds: new Set(), // зона не входит в набор продаваемых
      });

      expect(readSalesStatus(geometry, 0)).toBe('NotForSale');
      expect(geometry.zones[0].zoneId).toBe(zoneId);
    });
  });

  describe('overview rendering and sales labels', () => {
    it('keeps a seat visible as a dot of a minimum screen size below the sprite threshold', () => {
      const overview = SEAT_SPRITE_LOD_SCALE / 20;
      expect(seatScreenPixels(overview)).toBeLessThan(SEATING_THEME.lod.seatDotMinPixels);
      expect(seatDotPixels(overview)).toBe(SEATING_THEME.lod.seatDotMinPixels);
      expect(seatDotPixels(SEAT_SPRITE_LOD_SCALE * 4)).toBeCloseTo(seatScreenPixels(SEAT_SPRITE_LOD_SCALE * 4));
    });

    it('draws the selection halo noticeably larger than the seat at every scale', () => {
      for (const scale of [0.2, 1, SEAT_SPRITE_LOD_SCALE, 50]) {
        expect(selectedHaloPixels(scale)).toBeGreaterThan(seatDotPixels(scale));
        expect(selectedHaloPixels(scale)).toBeGreaterThanOrEqual(SEATING_THEME.lod.selectedMinPixels);
      }
    });

    it('keeps a fractional device pixel ratio instead of rounding it', () => {
      expect(resolveRenderResolution(1)).toBe(1);
      expect(resolveRenderResolution(1.1)).toBe(1.1);
      expect(resolveRenderResolution(1.25)).toBe(1.25);
      expect(resolveRenderResolution(2)).toBe(2);
      expect(resolveRenderResolution(5)).toBe(3);
      expect(resolveRenderResolution(0)).toBe(1);
      expect(resolveRenderResolution(Number.NaN)).toBe(1);
    });

    it('counts free seats per saleable zone and marks the others as not sold online', () => {
      const geometry = createRenderGeometry(generateScene(10, 5));
      const [first, second] = geometry.zones;
      const statuses = new Map<string, 'Available' | 'Held' | 'Sold'>();
      for (let i = 0; i < geometry.x.length; i++) {
        statuses.set(readText(geometry.positionIds, i), i === 0 ? 'Held' : i === 1 ? 'Sold' : 'Available');
      }
      applySalesStatus(geometry, { statusByPosition: statuses, saleableZoneIds: new Set([first.zoneId]) });

      expect(first.saleable).toBe(true);
      expect(first.availableCount).toBe(3);
      expect(second.saleable).toBe(false);
      expect(second.availableCount).toBe(0);
      expect(zoneLabelText(first)).toBe(first.code + ' ' + first.name + ' · свободно 3');
      expect(zoneLabelText(second)).toBe(second.code + ' ' + second.name + ' · не продаётся онлайн');
    });

    it('falls back to the capacity label outside a sales context', () => {
      const geometry = createRenderGeometry(generateScene(10, 10, { freeZoneCapacity: 500 }));
      expect(zoneLabelText(geometry.zones[0])).toContain(' · 10');
      expect(zoneLabelText(geometry.zones[1])).toContain(' · лимит 500');
    });
  });
});

describe('seatMagnification', () => {
  function grid(pitch: number, columns = 10, rows = 4) {
    const x = new Float32Array(columns * rows)
    const y = new Float32Array(columns * rows)
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        x[row * columns + column] = column * pitch
        y[row * columns + column] = row * pitch
      }
    }
    return { x, y, spatial: buildSpatialIndex(x, y) }
  }

  it('keeps the physical seat size for a dense calibrated layout', () => {
    expect(seatMagnification(grid(0.55))).toBe(1)
  })

  it('draws seats of a sparse layout as a share of the seat pitch', () => {
    const magnified = seatMagnification(grid(20)) * SEAT_DIAMETER_UNITS
    expect(magnified).toBeCloseTo(12, 5)
  })

  it('does not magnify a single seat', () => {
    const x = new Float32Array([5])
    const y = new Float32Array([5])
    expect(seatMagnification({ x, y, spatial: buildSpatialIndex(x, y) })).toBe(1)
  })
})

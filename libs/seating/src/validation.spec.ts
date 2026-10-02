import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { generateStraightRows } from './generate-rows';
import type { SeatingZoneGeometry } from './model';
import { hasCritical, inspectZones, warningSignature, type InspectedZone } from './validation';

const sharedCases = JSON.parse(readFileSync('src/testing/seating-validation-cases.json', 'utf8')) as Array<{
  name: string;
  expectedCodes: string[];
  zones: Array<{
    zoneId: string; floorId: string; code: string;
    x: number; y: number; width: number; height: number;
    rows: Array<{ label: string; positions: Array<{ label: string; x: number; y: number }> }>;
  }>;
}>;

/** Зона 1500 × 900 мм: два ряда по четыре места, построенных от указанного угла. */
function zone(
  overrides: Partial<SeatingZoneGeometry> = {},
  code = 'A',
  origin: { x: number; y: number } = { x: 0, y: 0 },
): SeatingZoneGeometry {
  const generated = generateStraightRows({
    rowCount: 2,
    positionsPerRow: 4,
    originX: origin.x,
    originY: origin.y,
    rowSpacing: 900,
    positionSpacing: 500,
  });
  return {
    code,
    name: 'Сектор ' + code,
    color: '#4275DB',
    kind: 'Numbered',
    capacity: null,
    ...generated,
    ...overrides,
  };
}

function at(geometry: SeatingZoneGeometry, zoneId = geometry.code): InspectedZone {
  return { zoneId, geometry };
}

function codes(findings: ReturnType<typeof inspectZones>): string[] {
  return findings.map((finding) => finding.code).sort();
}

describe('Проверка схемы (CFG-17, артефакт 14 §11)', () => {
  it('не находит замечаний у ровной схемы', () => {
    const left = zone();
    const right = zone({}, 'B', { x: 10_000, y: 0 });
    const findings = inspectZones([at(left), at(right)]);

    expect(findings).toEqual([]);
    expect(hasCritical(findings)).toBe(false);
  });

  it('находит два места с одним адресом и сообщает о паре один раз', () => {
    const geometry = zone();
    geometry.rows[0].positions[1].label = geometry.rows[0].positions[0].label;
    const findings = inspectZones([at(geometry)]);

    expect(codes(findings)).toEqual(['PositionAddressDuplicated']);
    expect(findings[0].level).toBe('critical');
    expect(findings[0].message).toContain('занят двумя местами');
  });

  it('не считает дублем одинаковые номера в разных рядах', () => {
    // Место «1» есть в каждом ряду: адрес состоит из подписи ряда и подписи места.
    expect(inspectZones([at(zone())])).toEqual([]);
  });

  it('находит место за контуром зоны', () => {
    const geometry = zone();
    geometry.rows[0].positions[0].x = geometry.x + geometry.width + 1_000;
    const findings = inspectZones([at(geometry)]);

    expect(codes(findings)).toEqual(['PositionOutsideZone']);
    expect(findings[0].message).toContain('вне контура зоны');
  });

  it('находит наложение двух зон и сообщает о каждой паре один раз', () => {
    const first = zone();
    const second = zone({}, 'B', { x: 500, y: 450 });
    const third = zone({}, 'C', { x: 700, y: 450 });
    const findings = inspectZones([at(first), at(second), at(third)]);

    expect(findings.filter((finding) => finding.code === 'ZonesOverlap')).toHaveLength(3);
    expect(findings[0].relatedZoneId).toBeDefined();
    expect(hasCritical(findings)).toBe(true);
  });

  it('не считает наложением соприкосновение зон встык', () => {
    const first = zone();
    const second = zone({}, 'B', { x: first.width + 500, y: 0 });
    second.x = first.width;
    second.width += 500;
    expect(inspectZones([at(first), at(second)])).toEqual([]);
  });

  it('находит пересечение рядов крест-накрест без близких мест', () => {
    const geometry = zone();
    geometry.rows = [
      { label: '2', positions: [
        { label: '1', x: 100, y: 100, rotation: 0 },
        { label: '2', x: 1_900, y: 1_900, rotation: 0 },
      ] },
      { label: '3', positions: [
        { label: '1', x: 100, y: 1_900, rotation: 0 },
        { label: '2', x: 1_900, y: 100, rotation: 0 },
      ] },
    ];
    geometry.width = 2_000;
    geometry.height = 2_000;

    const findings = inspectZones([at(geometry)]);
    expect(codes(findings)).toEqual(['RowsCross']);
    expect(findings[0].message).toContain('Ряд «2» и ряд «3»');
    expect(hasCritical(findings)).toBe(true);
  });

  it('группирует совпавшие места и наложенные ломаные по паре рядов', () => {
    const geometry = zone();
    geometry.rows[1].positions = geometry.rows[0].positions.map((position) => ({ ...position }));

    const findings = inspectZones([at(geometry)]);
    expect(codes(findings)).toEqual(['RowsCross', 'SeatsOverlap']);
    const overlap = findings.find((finding) => finding.code === 'SeatsOverlap');
    expect(overlap?.message).toContain('4 пересекающихся мест');
    expect(overlap?.message).toContain('в координатах схемы');
    expect(overlap?.firstPairCoordinates).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }]);
    expect(hasCritical(findings)).toBe(true);
  });

  it('не находит пересечений при обычном шаге 900/500 мм', () => {
    const geometry = zone();
    expect(inspectZones([at(geometry)])).toEqual([]);
  });

  it('не считает близость 450 мм наложением места стола и места ряда', () => {
    const geometry = zone();
    geometry.tables = [{
      label: 'T1', x: 0, y: 450, rotation: 0, capacity: 1, saleMode: 'Individual',
      positions: [{ label: '1', x: 0, y: 450, rotation: 0 }],
    }];
    expect(inspectZones([at(geometry)])).toEqual([]);
  });

  it('находит близкие места разных зон одного этажа', () => {
    const first = zone();
    const second = zone({}, 'B', { x: 300, y: 300 });
    const overlaps = inspectZones([at(first), at(second)]).filter((finding) => finding.code === 'SeatsOverlap');

    expect(overlaps).toHaveLength(2);
    expect(overlaps.every((finding) => finding.level === 'critical' && finding.relatedZoneId === 'B')).toBe(true);
  });

  it('проверяет 20 000 мест быстрее 500 мс', () => {
    const geometry = zone(generateStraightRows({
      rowCount: 100, positionsPerRow: 200, originX: 0, originY: 0,
      rowSpacing: 900, positionSpacing: 500,
    }));
    const started = performance.now();
    const findings = inspectZones([at(geometry)]);

    expect(findings).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('пропускает зоны без рамки: их на схеме нет', () => {
    const bare = zone({ x: 0, y: 0, width: 0, height: 0, kind: 'Free', capacity: 100, rows: [] }, 'FAN');
    const normal = zone();
    const findings = inspectZones([at(bare), at(normal)]);

    expect(findings.filter((finding) => finding.code === 'ZonesOverlap')).toEqual([]);
  });

  it('находит стол без мест', () => {
    const geometry = zone({
      kind: 'Tables',
      rows: [],
      tables: [{ id: null, label: 'T1', x: 100, y: 100, rotation: 0, capacity: 0, saleMode: 'Individual', positions: [] }],
    });
    const findings = inspectZones([at(geometry)]);

    expect(codes(findings)).toContain('TableWithoutCapacity');
    expect(hasCritical(findings)).toBe(true);
  });

  it('предупреждает о разрыве нумерации, но не о постоянном шаге', () => {
    const gap = zone();
    gap.rows[0].positions = gap.rows[0].positions.map((position, index) =>
      ({ ...position, label: ['1', '2', '4', '5'][index] }));
    expect(codes(inspectZones([at(gap)]))).toEqual(['NumberingGap']);
    expect(hasCritical(inspectZones([at(gap)]))).toBe(false);

    const odd = zone();
    odd.rows[0].positions = odd.rows[0].positions.map((position, index) =>
      ({ ...position, label: ['1', '3', '5', '7'][index] }));
    expect(inspectZones([at(odd)])).toEqual([]);

    const fromAisle = zone();
    fromAisle.rows[0].positions = fromAisle.rows[0].positions.map((position, index) =>
      ({ ...position, label: ['4', '2', '1', '3'][index] }));
    expect(inspectZones([at(fromAisle)])).toEqual([]);

    const letters = zone();
    letters.rows[0].positions = letters.rows[0].positions.map((position, index) =>
      ({ ...position, label: ['A', 'B', 'D', 'E'][index] }));
    expect(inspectZones([at(letters)])).toEqual([]);
  });

  it('предупреждает о пустой зоне: без мест и без лимита вместимости', () => {
    const numbered = zone({ rows: [] });
    expect(codes(inspectZones([at(numbered)]))).toEqual(['EmptyZone']);

    const free = zone({ kind: 'Free', capacity: null, rows: [] }, 'F');
    expect(codes(inspectZones([at(free)]))).toEqual(['EmptyZone']);

    const filled = zone({ kind: 'Free', capacity: 100, rows: [] }, 'F');
    expect(inspectZones([at(filled)])).toEqual([]);
  });

  it('подпись предупреждений не зависит от порядка и меняется вместе с набором', () => {
    const first = zone({ rows: [] });
    const second = zone({ rows: [] }, 'B');
    const direct = warningSignature(inspectZones([at(first), at(second)]));
    const reversed = warningSignature(inspectZones([at(second), at(first)]));

    expect(direct).toBe(reversed);
    expect(direct).not.toBe(warningSignature(inspectZones([at(first)])));
    expect(warningSignature(inspectZones([at(zone())]))).toBe('');
  });
});
describe('shared validation cases', () => {
  for (const testCase of sharedCases) {
    it(testCase.name, () => {
      const zones = testCase.zones.map((zone) => ({
        zoneId: zone.zoneId,
        geometry: {
          code: zone.code, name: zone.code, color: '#336699', kind: 'Numbered',
          floorId: zone.floorId, x: zone.x, y: zone.y, width: zone.width, height: zone.height,
          rows: zone.rows.map((row) => ({
            id: null, label: row.label,
            positions: row.positions.map((position) => ({
              id: null, label: position.label, x: position.x, y: position.y, rotation: 0,
            })),
          })),
          tables: [],
        } as SeatingZoneGeometry,
      }));
      const actual = [...new Set(inspectZones(zones).map((finding) => finding.code))].sort();
      expect(actual).toEqual([...testCase.expectedCodes].sort());
    });
  }
});

import { describe, expect, it } from 'vitest';
import { canonicalScene, decodeScene, encodeScene } from './codec';
import { generateScene, newIdentity } from './generate';
import {
  applyAvailability, declaresNothing, geometryFormatVersion, resolveProperties, splitScene,
  validateScene, validateZoneGeometry, zoneCapacity, type SeatingZoneGeometry,
} from './model';

function zone(overrides: Partial<SeatingZoneGeometry> = {}): SeatingZoneGeometry {
  return {
    code: 'A', name: 'Партер', color: '#4275DB', x: 0, y: 0, width: 100_000, height: 80_000,
    kind: 'Numbered', capacity: null,
    rows: [{
      id: null, label: '1',
      positions: [{ id: null, label: '01', x: 10_000, y: 20_000, rotation: 0 }],
    }],
    ...overrides,
  };
}

describe('zone geometry contract', () => {
  it.each(['json', 'protobuf'] as const)('round trips %s without adding prices or state', (encoding) => {
    const source = generateScene(2_100);
    const decoded = decodeScene(encodeScene(source, encoding), encoding);
    expect(decoded).toEqual(canonicalScene(source));
    expect(JSON.stringify(decoded)).not.toContain('amountMinor');
    expect(JSON.stringify(decoded)).not.toContain('status');
  });

  it.each(['json', 'protobuf'] as const)('carries declared properties of every level through %s', (encoding) => {
    const source = generateScene(20);
    source.properties = { sellable: true };
    source.zones[0].geometry.properties = { viewObstruction: 'Partial' };
    source.zones[0].geometry.rows[0].properties = { accessibility: 'Companion' };
    source.zones[0].geometry.rows[0].positions[0].properties = { accessibility: 'Wheelchair', sellable: false };
    const decoded = decodeScene(encodeScene(source, encoding), encoding);
    expect(decoded.properties).toEqual({ sellable: true });
    expect(decoded.zones[0].geometry.properties).toEqual({ viewObstruction: 'Partial' });
    expect(decoded.zones[0].geometry.rows[0].properties).toEqual({ accessibility: 'Companion' });
    expect(decoded.zones[0].geometry.rows[0].positions[0].properties)
      .toEqual({ accessibility: 'Wheelchair', sellable: false });
    // Уровень без объявления остаётся пустым: наследование не материализуется кодеком.
    expect(decoded.zones[0].geometry.rows[0].positions[1].properties).toBeNull();
  });

  it('splits a single large zone into parts without losing places', () => {
    const source = generateScene(54_000, 54_000);
    const chunks = splitScene(source);
    expect(chunks).toHaveLength(27);
    expect(chunks.every((chunk) => chunk.positions.length <= 2_000)).toBe(true);
    expect(new Set(chunks.flatMap((chunk) => chunk.positions.map((position) => position.id))).size).toBe(54_000);
  });

  it('keeps the two server kinds apart', () => {
    expect(() => validateZoneGeometry(zone({ capacity: 10 }))).toThrow('нумерованной зоны');
    expect(() => validateZoneGeometry(zone({ kind: 'Free', capacity: 10 }))).toThrow('не содержит рядов');
    const free = zone({ kind: 'Free', capacity: 500, rows: [], x: 0, y: 0, width: 0, height: 0 });
    expect(() => validateZoneGeometry(free)).not.toThrow();
    expect(zoneCapacity(free)).toBe(500);
    expect(() => validateZoneGeometry({ ...free, capacity: null })).toThrow('положительный лимит');
    expect(() => validateZoneGeometry({ ...free, x: 5 })).toThrow('без рамки');
  });

  it.each(['json', 'protobuf'] as const)('round trips table geometry through %s', (encoding) => {
    const tables = zone({ kind: 'Tables', rows: [], tables: [{ id: null, label: 'T1', x: 20_000, y: 20_000,
      rotation: 90_000, capacity: 6, saleMode: 'MinimumQuantity', minimumQuantity: 3,
      positions: Array.from({ length: 6 }, (_, index) => ({ id: null, label: String(index + 1),
        x: 20_000 + index * 1_000, y: 20_000, rotation: 0 })) }] });
    const scene = { formatVersion: geometryFormatVersion, configurationId: 'tables', revision: null,
      zones: [{ zoneId: newIdentity(), zoneVersion: 0, geometry: tables }] };
    const decoded = decodeScene(encodeScene(scene, encoding), encoding);
    expect(decoded.zones[0].geometry.tables?.[0]).toMatchObject({ label: 'T1', capacity: 6,
      saleMode: 'MinimumQuantity', minimumQuantity: 3 });
  });

  it('rejects mixed rows and invalid minimum table quantity', () => {
    expect(() => validateZoneGeometry(zone({ kind: 'Tables', tables: [] }))).toThrow('не содержит рядов');
    const tables = zone({ kind: 'Tables', rows: [], tables: [{ label: 'T1', x: 20_000, y: 20_000,
      rotation: 0, capacity: 4, saleMode: 'MinimumQuantity', minimumQuantity: 5,
      positions: Array.from({ length: 4 }, (_, index) => ({ id: null, label: String(index + 1),
        x: 20_000 + index * 1_000, y: 20_000, rotation: 0 })) }] });
    expect(() => validateZoneGeometry(tables)).toThrow('от 1 до вместимости');
  });

  it('rejects what the server rejects: labels, bounds, rotation, colour and foreign keys', () => {
    const duplicate = zone();
    duplicate.rows[0].positions.push({ id: null, label: '01', x: 20_000, y: 20_000, rotation: 0 });
    expect(() => validateZoneGeometry(duplicate)).toThrow('повторён в ряду');
    expect(() => validateZoneGeometry(zone({ color: '4275DB' }))).toThrow('#RRGGBB');
    expect(() => validateZoneGeometry(zone({ width: 5_000 }))).toThrow('выходит за границы');
    const rotated = zone();
    rotated.rows[0].positions[0].rotation = 360_000;
    expect(() => validateZoneGeometry(rotated)).toThrow('359999');
    const foreign = zone();
    foreign.rows[0].positions[0].id = 'not-a-uuid';
    expect(() => validateZoneGeometry(foreign)).toThrow('UUID');
  });

  it('refuses to place one position in two zones of the same revision', () => {
    const shared = newIdentity();
    const first = zone({ code: 'A' });
    const second = zone({ code: 'B', x: 200_000, name: 'Балкон' });
    first.rows[0].positions[0].id = shared;
    second.rows[0].positions[0] = { id: shared, label: '01', x: 210_000, y: 20_000, rotation: 0 };
    expect(() => validateScene({
      formatVersion: geometryFormatVersion, configurationId: 'draft', revision: 4,
      zones: [
        { zoneId: newIdentity(), zoneVersion: 1, geometry: first },
        { zoneId: newIdentity(), zoneVersion: 1, geometry: second },
      ],
    })).toThrow('в две зоны');
  });

  it('resolves each shared property from the nearest declaring level', () => {
    expect(resolveProperties(null, null, null, null))
      .toEqual({ accessibility: 'None', viewObstruction: 'None', sellable: true });
    expect(resolveProperties({ accessibility: 'Wheelchair' }, { accessibility: 'Companion' },
      { viewObstruction: 'Severe' }, { sellable: false }))
      .toEqual({ accessibility: 'Wheelchair', viewObstruction: 'Severe', sellable: false });
    // Явные None и false — заданные значения, а не наследование.
    expect(resolveProperties({ accessibility: 'None', sellable: false }, null, { accessibility: 'Wheelchair' }, null))
      .toEqual({ accessibility: 'None', viewObstruction: 'None', sellable: false });
    expect(declaresNothing(null)).toBe(true);
    expect(declaresNothing({ accessibility: null, viewObstruction: null, sellable: null })).toBe(true);
    expect(declaresNothing({ sellable: false })).toBe(false);
  });

  it('refuses unknown property values and repeated row labels inside a zone', () => {
    const invalid = zone();
    invalid.properties = { viewObstruction: 'Nope' as never };
    expect(() => validateZoneGeometry(invalid)).toThrow('ограничение обзора');
    const rowProperties = zone();
    rowProperties.rows[0].properties = { accessibility: 'Nope' as never };
    expect(() => validateZoneGeometry(rowProperties)).toThrow('признак доступности');
    const seatProperties = zone();
    seatProperties.rows[0].positions[0].properties = { sellable: 'yes' as never };
    expect(() => validateZoneGeometry(seatProperties)).toThrow('логическим значением');
    const duplicated = zone();
    duplicated.rows = [duplicated.rows[0], { ...duplicated.rows[0], id: null, label: ' ' + duplicated.rows[0].label + ' ' }];
    expect(() => validateZoneGeometry(duplicated)).toThrow('повторена в зоне');
  });

  it('ignores old and duplicate availability without mutating the previous snapshot', () => {
    const original = applyAvailability(new Map(), [{ positionId: 'a', version: 3, status: 'Sold' }]);
    const next = applyAvailability(original, [
      { positionId: 'a', version: 2, status: 'Free' }, { positionId: 'a', version: 3, status: 'Reserved' },
      { positionId: 'b', version: 1, status: 'Free' },
    ]);
    expect(next.get('a')?.status).toBe('Sold');
    expect(original.has('b')).toBe(false);
  });
});

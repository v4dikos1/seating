import { describe, expect, it } from 'vitest';

import type { SeatingApi } from './api';
import { duplicateConfiguration, withoutIdentities, type DuplicateProgress } from './duplicate';
import type { SeatingZoneGeometry } from './model';

function geometry(overrides: Partial<SeatingZoneGeometry> = {}): SeatingZoneGeometry {
  return {
    code: 'A',
    name: 'Сектор A',
    color: '#4275DB',
    kind: 'Numbered',
    capacity: null,
    x: 0,
    y: 0,
    width: 1_500,
    height: 900,
    rows: [{
      id: 'row-uuid',
      label: '1',
      positions: [{ id: 'seat-uuid', label: '1', x: 100, y: 100, rotation: 0 }],
    }],
    tables: [],
    ...overrides,
  };
}

/** Журнал вызовов: дублирование — это порядок команд, и проверять надо именно его. */
function fakeApi() {
  const calls: { name: string; args: unknown[] }[] = [];
  let version = 1;
  const record = (name: string, args: unknown[]) => calls.push({ name, args });

  const targetCard = (configurationVersion: number) => ({
    id: 'target', space: { id: 'space-1', name: 'Зал' }, venue: { id: 'venue-1', name: 'Площадка' },
    organizerId: 'org', name: 'Копия',
    versions: { configurationVersion, configurationRevision: null },
    createdAt: '', updatedAt: '', properties: null,
  });

  const api = {
    getConfiguration: async (id: string) => {
      record('getConfiguration', [id]);
      return id === 'source'
        ? {
            id: 'source', space: { id: 'space-1', name: 'Зал' }, venue: { id: 'venue-1', name: 'Площадка' },
            organizerId: 'org', name: 'Главный зал',
            versions: { configurationVersion: 9, configurationRevision: 4 },
            createdAt: '', updatedAt: '', properties: { sellable: false },
          }
        : { id: 'target', space: { id: 'space-1', name: 'Зал' }, venue: { id: 'venue-1', name: 'Площадка' },
            organizerId: 'org', name: 'Копия',
            versions: { configurationVersion: version, configurationRevision: 2 },
            createdAt: '', updatedAt: '', properties: null };
    },
    createConfiguration: async (body: unknown) => {
      record('createConfiguration', [body]);
      return targetCard(++version);
    },
    setConfigurationProperties: async (id: string, body: unknown) => {
      record('setConfigurationProperties', [id, body]);
      return targetCard(++version);
    },
    listFloors: async (id: string) => {
      record('listFloors', [id]);
      const items = id === 'source'
        ? [
            { configurationId: 'source', id: 'floor-main', name: 'Партер', isDefault: true,
              versions: { floorVersion: 3, configurationVersion: 9, configurationRevision: 4 },
              background: {
                file: { fileId: 'pdf-1', fileName: 'plan.pdf', contentType: 'application/pdf',
                  sizeBytes: 1, dominantColors: [], url: '', urlExpiresAt: '' },
                page: 2,
                calibration: { point1: { x: 1, y: 2 }, point2: { x: 3, y: 4 }, distanceMeters: 12 },
                placement: { originX: 5, originY: 6, rotationDegrees: 90 },
              } },
            { configurationId: 'source', id: 'floor-balcony', name: 'Балкон', isDefault: false,
              versions: { floorVersion: 1, configurationVersion: 9, configurationRevision: 4 },
              background: null },
          ]
        : [{ configurationId: 'target', id: 'target-main', name: 'Основной этаж', isDefault: true,
            versions: { floorVersion: 1, configurationVersion: 1, configurationRevision: null },
            background: null }];
      return { items, totalItems: items.length, offset: 0, limit: 200 };
    },
    createFloor: async (id: string, body: unknown) => {
      record('createFloor', [id, body]);
      return { configurationId: 'target', id: 'target-balcony', name: 'Балкон', isDefault: false,
        versions: { floorVersion: 1, configurationVersion: ++version, configurationRevision: 1 },
        background: null };
    },
    updateFloor: async (id: string, floorId: string, body: unknown) => {
      record('updateFloor', [id, floorId, body]);
      return { configurationId: 'target', id: floorId, name: 'Партер', isDefault: false,
        versions: { floorVersion: 2, configurationVersion: ++version, configurationRevision: 1 },
        background: null };
    },
    listZones: async (id: string, params: unknown) => {
      record('listZones', [id, params]);
      const items = [
        { configurationId: 'source', zoneId: 'zone-a', floorId: 'floor-main', versions: { zoneVersion: 2, compositionVersion: 2, configurationRevision: 4 }, code: 'A', name: 'Сектор A',
          color: '#4275DB', kind: 'Numbered' as const, capacity: null, x: 0, y: 0, width: 1_500, height: 900 },
        { configurationId: 'source', zoneId: 'zone-b', floorId: 'floor-balcony', versions: { zoneVersion: 1, compositionVersion: 1, configurationRevision: 4 }, code: 'B', name: 'Сектор B',
          color: '#2B9983', kind: 'Numbered' as const, capacity: null, x: 5_000, y: 0, width: 1_500, height: 900 },
      ];
      return { items, totalItems: items.length, offset: 0, limit: 200 };
    },
    getZone: async (id: string, zoneId: string, revision: unknown) => {
      record('getZone', [id, zoneId, revision]);
      return {
        configurationId: 'source', zoneId, floorId: zoneId === 'zone-a' ? 'floor-main' : 'floor-balcony',
        versions: { zoneVersion: 1, compositionVersion: 1, configurationVersion: 9, configurationRevision: 4 },
        geometry: geometry({ code: zoneId === 'zone-a' ? 'A' : 'B' }),
      };
    },
    createZone: async (id: string, body: unknown) => {
      record('createZone', [id, body]);
      return { configurationId: 'target', zoneId: 'new-zone', floorId: 'target-main', versions: { zoneVersion: 1, compositionVersion: 1, configurationVersion: ++version, configurationRevision: 1 },
        geometry: geometry() };
    },
  };

  return { api: api as unknown as SeatingApi, calls };
}

/** Находит вызов по имени и падает понятным сообщением, если его не было. */
function callOf(calls: { name: string; args: unknown[] }[], name: string) {
  const call = calls.find((item) => item.name === name);
  expect(call, `ожидался вызов ${name}`).toBeDefined();
  return call as { name: string; args: unknown[] };
}

describe('Дублирование конфигурации (CFG-14)', () => {
  it('снимает серверные ключи и переносит этаж копии', () => {
    const stripped = withoutIdentities(geometry(), 'target-main');

    expect(stripped.floorId).toBe('target-main');
    expect(stripped.rows[0].id).toBeNull();
    expect(stripped.rows[0].positions[0].id).toBeNull();
    // Подписи, координаты и всё прочее переносятся как есть.
    expect(stripped.rows[0].label).toBe('1');
    expect(stripped.rows[0].positions[0].x).toBe(100);
    expect(stripped.code).toBe('A');
  });

  it('снимает ключи мест за столами', () => {
    const withTable = geometry({
      kind: 'Tables',
      rows: [],
      tables: [{
        id: 'table-uuid', label: 'T1', x: 100, y: 100, rotation: 0, capacity: 2,
        saleMode: 'Whole', minimumQuantity: null,
        positions: [{ id: 'seat-1', label: '1', x: 90, y: 100, rotation: 0 }],
      }],
    });

    const stripped = withoutIdentities(withTable, 'target-main');

    expect(stripped.tables?.[0].id).toBeNull();
    expect(stripped.tables?.[0].positions[0].id).toBeNull();
    expect(stripped.tables?.[0].saleMode).toBe('Whole');
    expect(stripped.tables?.[0].capacity).toBe(2);
  });

  it('копирует карточку, умолчания, этажи и зоны в нужном порядке', async () => {
    const { api, calls } = fakeApi();
    const progress: DuplicateProgress[] = [];

    await duplicateConfiguration(api, 'source', 'Главный зал (копия)', {
      onProgress: (item) => progress.push(item),
    });

    const order = calls.map((call) => call.name);
    expect(order.indexOf('createConfiguration')).toBeLessThan(order.indexOf('createFloor'));
    expect(order.indexOf('createFloor')).toBeLessThan(order.indexOf('createZone'));
    expect(order.filter((name) => name === 'createZone')).toHaveLength(2);

    // Копия заводится в том же помещении и под заданным названием.
    expect(callOf(calls, 'createConfiguration').args[0])
      .toEqual({ spaceId: 'space-1', name: 'Главный зал (копия)' });

    // Умолчания зала переносятся отдельной командой.
    expect(calls.some((call) => call.name === 'setConfigurationProperties')).toBe(true);

    expect(progress.at(-1)).toEqual({ stage: 'zones', done: 2, total: 2 });
  });

  it('сопоставляет этаж по умолчанию вместо создания второго и переносит подложку', async () => {
    const { api, calls } = fakeApi();

    await duplicateConfiguration(api, 'source', 'Копия');

    // Исходных этажей два, но создаётся только один: дефолтный у копии уже есть.
    expect(calls.filter((call) => call.name === 'createFloor')).toHaveLength(1);
    expect(callOf(calls, 'createFloor').args[1]).toMatchObject({ name: 'Балкон' });

    const update = callOf(calls, 'updateFloor');
    expect(update.args[1]).toBe('target-main');
    expect(update.args[2]).toMatchObject({
      name: 'Партер',
      background: {
        file: 'pdf-1',
        page: 2,
        calibration: { distanceMeters: 12 },
        placement: { originX: 5, originY: 6, rotationDegrees: 90 },
      },
    });
  });

  it('раскладывает зоны по соответствующим этажам копии и не переносит ключи', async () => {
    const { api, calls } = fakeApi();

    await duplicateConfiguration(api, 'source', 'Копия');

    const zones = calls.filter((call) => call.name === 'createZone')
      .map((call) => (call.args[1] as { geometry: SeatingZoneGeometry }).geometry);

    expect(zones.map((zone) => zone.floorId)).toEqual(['target-main', 'target-balcony']);
    expect(zones.every((zone) => zone.rows.every((row) => row.id === null))).toBe(true);
    expect(zones.every((zone) => zone.rows.every((row) =>
      row.positions.every((position) => position.id === null)))).toBe(true);
  });

  it('читает состав исходной редакции, а не произвольной', async () => {
    const { api, calls } = fakeApi();

    await duplicateConfiguration(api, 'source', 'Копия');

    expect(callOf(calls, 'listZones').args[1]).toMatchObject({ revision: 4 });
    expect(calls.filter((call) => call.name === 'getZone')
      .every((call) => call.args[2] === 4)).toBe(true);
  });
});

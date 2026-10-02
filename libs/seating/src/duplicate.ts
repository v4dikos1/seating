/**
 * Дублирование конфигурации как основы новой (артефакт 14, CFG-14).
 *
 * Отдельного серверного маршрута копирования нет, поэтому копия собирается из тех же
 * команд, которыми конфигурацию строят вручную: карточка, этажи, зоны. Это не обход
 * контракта — наоборот, копия проходит ровно те же проверки, что и ручная разметка.
 *
 * Ключи рядов, мест и столов выдаёт сервер, поэтому в копию они не переносятся:
 * скопированный ключ означал бы, что два состава заявляют одну и ту же сущность.
 */

import type {
  SeatingApi, SeatingConfigurationResult, SeatingFloorResult,
} from './api';
import { newIdempotencyKey } from './api';
import type { SeatingZoneGeometry } from './model';

export type DuplicateStage = 'configuration' | 'floors' | 'zones';

export interface DuplicateProgress {
  stage: DuplicateStage;
  /** Сколько частей этого этапа уже перенесено. */
  done: number;
  /** Сколько частей на этом этапе всего; 0 — количество ещё неизвестно. */
  total: number;
}

export interface DuplicateOptions {
  onProgress?: (progress: DuplicateProgress) => void;
}

/**
 * Геометрия без серверных ключей и с новым этажом. Подписи, координаты, свойства,
 * режимы продажи столов и вместимость переносятся как есть.
 */
export function withoutIdentities(
  geometry: SeatingZoneGeometry,
  floorId: string | undefined,
): SeatingZoneGeometry {
  return {
    ...geometry,
    floorId,
    rows: geometry.rows.map((row) => ({
      ...row,
      id: null,
      positions: row.positions.map((position) => ({ ...position, id: null })),
    })),
    tables: (geometry.tables ?? []).map((table) => ({
      ...table,
      id: null,
      positions: table.positions.map((position) => ({ ...position, id: null })),
    })),
  };
}

/** Карточка копии с токеном версии, который вернула последняя команда. */
function withConfigurationVersion(
  target: SeatingConfigurationResult,
  versions: { configurationVersion: number },
): SeatingConfigurationResult {
  return {
    ...target,
    versions: { ...target.versions, configurationVersion: versions.configurationVersion },
  };
}

async function readAll<T>(page: (offset: number) => Promise<{ items: T[]; totalItems: number }>): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  let totalItems = 0;
  do {
    const result = await page(offset);
    items.push(...result.items);
    totalItems = result.totalItems;
    offset += result.items.length;
  } while (offset < totalItems && offset > 0);
  return items;
}

/**
 * Копия исходной конфигурации под новым названием в том же помещении.
 *
 * Копирование не атомарно: серверной команды копирования нет, поэтому отказ на середине
 * оставляет частично заполненный черновик. Он остаётся черновиком и ничему не мешает,
 * но удалить его нечем — маршрута удаления конфигурации в API нет.
 */
export async function duplicateConfiguration(
  api: SeatingApi,
  sourceId: string,
  name: string,
  options: DuplicateOptions = {},
): Promise<SeatingConfigurationResult> {
  const report = (stage: DuplicateStage, done: number, total: number) =>
    options.onProgress?.({ stage, done, total });

  report('configuration', 0, 1);
  const source = await api.getConfiguration(sourceId);
  let target = await api.createConfiguration(
    { spaceId: source.space.id, name },
    newIdempotencyKey(),
  );

  // Умолчания зала — часть описания конфигурации, а не её состава.
  if (source.properties) {
    target = await api.setConfigurationProperties(
      target.id,
      { expectedVersion: target.versions.configurationVersion, properties: source.properties },
      newIdempotencyKey(),
    );
  }
  report('configuration', 1, 1);

  const sourceFloors = await readAll<SeatingFloorResult>((offset) =>
    api.listFloors(sourceId, { offset, limit: 200, sortBy: 'Id', sortDirection: 'Asc' }));
  const targetFloors = await readAll<SeatingFloorResult>((offset) =>
    api.listFloors(target.id, { offset, limit: 200, sortBy: 'Id', sortDirection: 'Asc' }));

  // Этаж по умолчанию у копии уже есть: он создаётся вместе с карточкой,
  // поэтому сопоставляется с исходным, а не заводится заново.
  const targetDefault = targetFloors.find((floor) => floor.isDefault) ?? targetFloors[0];
  const floorMap = new Map<string, string>();
  let copiedFloors = 0;
  report('floors', 0, sourceFloors.length);

  for (const floor of sourceFloors) {
    let targetFloorId: string;
    let expectedFloorVersion: number;
    if (floor.isDefault && targetDefault) {
      targetFloorId = targetDefault.id;
      expectedFloorVersion = targetDefault.versions.floorVersion;
    } else {
      const created = await api.createFloor(
        target.id,
        { expectedVersion: target.versions.configurationVersion, name: floor.name },
        newIdempotencyKey(),
      );
      target = withConfigurationVersion(target, created.versions);
      targetFloorId = created.id;
      expectedFloorVersion = created.versions.floorVersion;
    }
    floorMap.set(floor.id, targetFloorId);

    // Подложка переносится ссылкой на тот же файл: он принадлежит тому же субъекту,
    // и повторная загрузка тех же байтов ничего бы не добавила.
    const background = floor.background;
    const needsName = floor.isDefault && targetDefault && targetDefault.name !== floor.name;
    if (background || needsName) {
      const saved = await api.updateFloor(
        target.id,
        targetFloorId,
        {
          expectedFloorVersion,
          ...(needsName ? { name: floor.name } : {}),
          ...(background
            ? {
                background: {
                  file: background.file.fileId,
                  page: background.page,
                  calibration: background.calibration,
                  placement: background.placement,
                },
              }
            : {}),
        },
        newIdempotencyKey(),
      );
      target = withConfigurationVersion(target, saved.versions);
    }
    report('floors', ++copiedFloors, sourceFloors.length);
  }

  const zoneList = await readAll((offset) =>
    api.listZones(sourceId, {
      offset,
      limit: 200,
      revision: source.versions.configurationRevision ?? undefined,
    }));
  report('zones', 0, zoneList.length);

  let copiedZones = 0;
  for (const item of zoneList) {
    const zone = await api.getZone(sourceId, item.zoneId, item.versions.configurationRevision);
    const geometry = withoutIdentities(zone.geometry, floorMap.get(zone.floorId));
    const saved = await api.createZone(
      target.id,
      { expectedVersion: target.versions.configurationVersion, geometry },
      newIdempotencyKey(),
    );
    target = withConfigurationVersion(target, saved.versions);
    report('zones', ++copiedZones, zoneList.length);
  }

  return api.getConfiguration(target.id);
}

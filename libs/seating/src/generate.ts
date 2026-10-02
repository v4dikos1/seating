import {
  geometryFormatVersion, maxZonePositions,
  type SeatingRowGeometry, type SeatingScene, type SeatingSceneZone,
} from './model';
import { SEATING_THEME } from './theme';

const palette = ['#4275DB', '#2B9983', '#B77B36', '#9862C5', '#D05B76'];
const columns = 60;
/** Настоящий шаг зала в миллиметрах: 50 см между креслами, 90 см между рядами. */
const step = SEATING_THEME.geometry.seatPitchMm;
const rowStep = SEATING_THEME.geometry.rowPitchMm;
const zoneMargin = 2_000;
const zoneGap = 6_000;

export function newIdentity(): string {
  return crypto.randomUUID();
}

export interface SyntheticOptions {
  /** Добавить свободную зону с лимитом вместимости и без мест. */
  freeZoneCapacity?: number;
  /** Свободная зона без рамки: сервер допускает нулевые x, y, width и height. */
  freeZoneWithoutFrame?: boolean;
}

/**
 * Синтетическая схема в форме серверного контракта. Это не официальная схема площадки
 * и не сохранённый черновик: ключи выданы клиентом и станут серверными только после записи.
 */
export function generateScene(positionCount: number, positionsPerZone = 1_800,
  options: SyntheticOptions = {}): SeatingScene {
  if (!Number.isSafeInteger(positionCount) || positionCount < 1 || positionCount > 200_000)
    throw new Error('Число мест вне допустимого диапазона.');
  if (!Number.isSafeInteger(positionsPerZone) || positionsPerZone < 1 || positionsPerZone > maxZonePositions)
    throw new Error('Размер зоны вне допустимого диапазона.');
  const zones: SeatingSceneZone[] = [];
  for (let offset = 0; offset < positionCount; offset += positionsPerZone) {
    const index = zones.length;
    const count = Math.min(positionsPerZone, positionCount - offset);
    const width = columns * step + zoneMargin * 2;
    const height = Math.ceil(positionsPerZone / columns) * rowStep + zoneMargin * 2;
    const originX = (index % 5) * (width + zoneGap);
    const originY = Math.floor(index / 5) * (height + zoneGap);
    const rows: SeatingRowGeometry[] = [];
    for (let seat = 0; seat < count; seat++) {
      const row = Math.floor(seat / columns);
      if (!rows[row]) rows[row] = { id: newIdentity(), label: String(row + 1), positions: [] };
      rows[row].positions.push({
        id: newIdentity(),
        label: String((seat % columns) + 1),
        x: originX + zoneMargin + (seat % columns) * step,
        y: originY + zoneMargin + row * rowStep,
        rotation: 0,
      });
    }
    zones.push({
      zoneId: newIdentity(), zoneVersion: 1,
      geometry: {
        code: 'Z' + (index + 1), name: 'Сектор ' + (index + 1), color: palette[index % palette.length],
        x: originX, y: originY, width, height, kind: 'Numbered', capacity: null, rows,
      },
    });
  }
  if (options.freeZoneCapacity) {
    const last = zones[zones.length - 1];
    const bare = options.freeZoneWithoutFrame === true;
    zones.push({
      zoneId: newIdentity(), zoneVersion: 1,
      geometry: {
        code: 'FREE', name: 'Танцпол', color: '#D05B76',
        x: bare ? 0 : last.geometry.x,
        y: bare ? 0 : last.geometry.y + last.geometry.height + zoneGap,
        width: bare ? 0 : last.geometry.width,
        height: bare ? 0 : 12_000,
        kind: 'Free', capacity: options.freeZoneCapacity, rows: [],
      },
    });
  }
  return {
    formatVersion: geometryFormatVersion,
    configurationId: 'synthetic-' + positionCount + '-' + positionsPerZone,
    revision: 1,
    zones,
  };
}

import {
  resolveProperties, seatingAccessibilities, seatingViewObstructions, zoneCapacity, zoneKindOf,
  type ResolvedSeatingProperties, type SeatingScene, type SeatingZoneKind,
} from './model';
import { buildSpatialIndex, querySpatial, type SpatialIndex } from './spatial-index';
import { MILLIMETRES_PER_UNIT, SEATING_THEME } from './theme';

export interface PackedText {
  bytes: Uint8Array;
  offsets: Uint32Array;
}

export interface RenderRowHeader {
  label: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  count: number;
}

/** Диаметр места в единицах сцены (метрах): 450 мм кресла. */
export const SEAT_DIAMETER_UNITS = SEATING_THEME.geometry.seatDiameterMm / MILLIMETRES_PER_UNIT;

/** Сколько экранных пикселей занимает место при данном масштабе камеры. */
export function seatScreenPixels(scale: number): number {
  return scale * SEAT_DIAMETER_UNITS;
}

/**
 * Пороги детализации выведены из размера места, а не подобраны числом: место видно,
 * пока оно шире трёх пикселей, подпись ряда — семи, номер места — шестнадцати.
 */
export const SEAT_LABEL_LOD_SCALE = SEATING_THEME.lod.seatLabelMinPixels / SEAT_DIAMETER_UNITS;
export const ROW_LABEL_LOD_SCALE = SEATING_THEME.lod.rowLabelMinPixels / SEAT_DIAMETER_UNITS;
export const SEAT_SPRITE_LOD_SCALE = SEATING_THEME.lod.seatSpriteMinPixels / SEAT_DIAMETER_UNITS;

export function isSeatLabelVisible(scale: number): boolean {
  return seatScreenPixels(scale) >= SEATING_THEME.lod.seatLabelMinPixels;
}

export function isRowLabelVisible(scale: number): boolean {
  return seatScreenPixels(scale) >= SEATING_THEME.lod.rowLabelMinPixels;
}

/** Размер точки места в экранных пикселях, когда полноценный спрайт ещё не читается. */
export function seatDotPixels(scale: number): number {
  return Math.max(seatScreenPixels(scale), SEATING_THEME.lod.seatDotMinPixels);
}

/** Диаметр кольца выбранного места: заметно крупнее места на любом масштабе. */
export function selectedHaloPixels(scale: number): number {
  return Math.max(seatScreenPixels(scale) * 1.9, SEATING_THEME.lod.selectedMinPixels);
}

/**
 * Плотность рендера по devicePixelRatio: дробные значения (110% масштаба страницы даёт 1,1)
 * сохраняются, иначе холст растягивается браузером и размывается.
 */
export function resolveRenderResolution(devicePixelRatio: number, max = 3): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(max, Math.max(1, ratio));
}

/** Доля шага рассадки, которую кресло занимает на схеме, если физический размер меньше. */
const seatPitchShare = 0.6;
const pitchSampleSize = 128;

/**
 * Во сколько раз кресло рисуется крупнее физического размера. Схема без калибровки масштаба
 * может ставить места в десятках единиц друг от друга: кресло в 0,5 единицы тогда остаётся
 * точкой среди пустоты на любом приближении, и выбрать его невозможно. Кресло рисуется не
 * меньше доли медианного шага до ближайшего соседа; у плотной калиброванной рассадки множитель
 * равен 1, и ничего не меняется.
 */
export function seatMagnification(geometry: Pick<RenderGeometry, 'x' | 'y' | 'spatial'>): number {
  const count = geometry.x.length;
  if (count < 2) return 1;
  const step = Math.max(1, Math.floor(count / pitchSampleSize));
  const pitches: number[] = [];
  for (let index = 0; index < count; index += step) {
    const x = geometry.x[index];
    const y = geometry.y[index];
    // Радиус растёт вдвое, пока в окрестности не найдётся сосед; предел — 10 км схемы.
    for (let radius = SEAT_DIAMETER_UNITS * 2; radius <= 10_000; radius *= 2) {
      let nearest = Infinity;
      for (const other of querySpatial(geometry.spatial, x - radius, y - radius, x + radius, y + radius)) {
        if (other === index) continue;
        const distance = Math.hypot(geometry.x[other] - x, geometry.y[other] - y);
        if (distance > 0 && distance < nearest) nearest = distance;
      }
      if (nearest <= radius) {
        pitches.push(nearest);
        break;
      }
    }
  }
  if (!pitches.length) return 1;
  pitches.sort((left, right) => left - right);
  const median = pitches[Math.floor(pitches.length / 2)];
  return Math.max(1, (median * seatPitchShare) / SEAT_DIAMETER_UNITS);
}

export function isSeatSpriteVisible(scale: number): boolean {
  return seatScreenPixels(scale) >= SEATING_THEME.lod.seatSpriteMinPixels;
}


export interface RenderTable {
  label: string;
  x: number;
  y: number;
  rotation: number;
  capacity: number;
}

/** Заголовок зоны без массивов мест: срез общих буферов задаётся start и count. */
export interface RenderZone {
  zoneId: string;
  zoneVersion: number;
  code: string;
  name: string;
  color: string;
  kind: SeatingZoneKind;
  capacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  start: number;
  count: number;
  rowHeaders?: RenderRowHeader[];
  tables?: RenderTable[];
  /** Задаётся `applySalesStatus`; вне продажного контекста не определено. */
  saleable?: boolean;
  /** Число свободных для выбора мест продаваемой зоны; задаётся `applySalesStatus`. */
  availableCount?: number;
}

/** Подпись зоны на схеме: в продаже — число свободных мест, иначе — что онлайн она не продаётся. */
export function zoneLabelText(zone: RenderZone): string {
  const head = zone.code + ' ' + zone.name;
  if (zone.saleable === false) return head + ' · не продаётся онлайн';
  if (zone.saleable === true && zone.kind !== 'Free') return head + ' · свободно ' + (zone.availableCount ?? 0);
  return head + (zone.kind === 'Free' ? ' · лимит ' + zone.capacity : ' · ' + zone.capacity);
}


export interface RenderGeometry {
  configurationId: string;
  revision: number | null;
  zones: RenderZone[];
  x: Float32Array;
  y: Float32Array;
  zoneSlots: Uint16Array;
  spatial: SpatialIndex;
  positionIds: PackedText;
  rows: PackedText;
  labels: PackedText;
  /**
   * Разрешённые свойства места одним байтом: биты 0–1 — доступность, биты 2–3 — обзор,
   * бит 4 — продаваемость. Общие значения не копируются объектом на каждое место.
   */
  seatProperties: Uint8Array;
  /**
   * Продажный статус показа (артефакт 20 §6), накладывается отдельно от декодирования
   * геометрии — см. `applySalesStatus`. Отсутствует вне продажного контекста (редактор,
   * предпросмотр конфигурации без показа): тогда `readSalesStatus` возвращает `null`.
   */
  salesStatus?: Uint8Array;
}

/**
 * Продажный статус одного места показа: три статуса сервера (`UnitAvailability`) плюс
 * `NotForSale` — позиция без единицы инвентаря или зона без назначенной цены. Определён
 * здесь, а не переиспользован из `sales-api.ts`, чтобы графическое ядро не зависело от
 * продажного среза (`libs/seating/README.md`, разделение core/sales).
 */
export type SeatSalesStatus = 'Available' | 'Held' | 'Sold' | 'NotForSale';

const salesStatusCodes: Record<SeatSalesStatus, number> = {
  Available: 1,
  Held: 2,
  Sold: 3,
  NotForSale: 4,
};
const salesStatusByCode: readonly (SeatSalesStatus | undefined)[] =
  [undefined, 'Available', 'Held', 'Sold', 'NotForSale'];

export function readSalesStatus(geometry: RenderGeometry, index: number): SeatSalesStatus | null {
  const table = geometry.salesStatus;
  if (!table) return null;
  return salesStatusByCode[table[index]] ?? null;
}

/**
 * Накладывает продажный статус показа на уже декодированную геометрию, в основном потоке:
 * снимок доступности опрашивается каждые несколько секунд и не должен гонять всю геометрию
 * обратно через Worker ради нескольких изменившихся мест. Позиция продаваемой зоны без
 * записи в `statusByPosition` — служебная (проход, негодное к продаже место) и считается
 * не участвующей в продаже, как и любое место зоны вне `saleableZoneIds`.
 */
export function applySalesStatus(
  geometry: RenderGeometry,
  input: {
    statusByPosition: ReadonlyMap<string, 'Available' | 'Held' | 'Sold'>;
    saleableZoneIds: ReadonlySet<string>;
  },
): void {
  const table = geometry.salesStatus ?? new Uint8Array(geometry.x.length);
  for (const zone of geometry.zones) {
    zone.saleable = input.saleableZoneIds.has(zone.zoneId);
    zone.availableCount = 0;
  }
  for (let index = 0; index < geometry.x.length; index++) {
    const zone = geometry.zones[geometry.zoneSlots[index]];
    if (!input.saleableZoneIds.has(zone.zoneId)) {
      table[index] = salesStatusCodes.NotForSale;
      continue;
    }
    const positionId = readText(geometry.positionIds, index);
    const status = positionId ? input.statusByPosition.get(positionId) : undefined;
    table[index] = status ? salesStatusCodes[status] : salesStatusCodes.NotForSale;
    if (status === 'Available') zone.availableCount = (zone.availableCount ?? 0) + 1;
  }
  geometry.salesStatus = table;
}

export function packSeatProperties(resolved: ResolvedSeatingProperties): number {
  return seatingAccessibilities.indexOf(resolved.accessibility)
    | (seatingViewObstructions.indexOf(resolved.viewObstruction) << 2)
    | (resolved.sellable ? 16 : 0);
}

export function readSeatProperties(geometry: RenderGeometry, index: number): ResolvedSeatingProperties {
  if (!Number.isInteger(index) || index < 0 || index >= geometry.seatProperties.length)
    throw new Error('Индекс места вне схемы.');
  const packed = geometry.seatProperties[index];
  return {
    accessibility: seatingAccessibilities[packed & 3],
    viewObstruction: seatingViewObstructions[(packed >> 2) & 3],
    sellable: (packed & 16) !== 0,
  };
}

const decoder = new TextDecoder();

export function packText(values: readonly string[]): PackedText {
  const encoder = new TextEncoder();
  const encoded = values.map((value) => encoder.encode(value));
  const offsets = new Uint32Array(values.length + 1);
  for (let i = 0; i < values.length; i++) offsets[i + 1] = offsets[i] + encoded[i].length;
  const bytes = new Uint8Array(offsets[values.length]);
  for (let i = 0; i < values.length; i++) bytes.set(encoded[i], offsets[i]);
  return { bytes, offsets };
}

export function readText(table: PackedText, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index + 1 >= table.offsets.length)
    throw new Error('Индекс текста вне таблицы.');
  return decoder.decode(table.bytes.subarray(table.offsets[index], table.offsets[index + 1]));
}

/**
 * Выполняется в Worker. Координаты API абсолютны, поэтому смещение зоны не прибавляется;
 * в основной поток не клонируется ни один объект места.
 */
export function createRenderGeometry(scene: SeatingScene): RenderGeometry {
  const total = scene.zones.reduce(
    (count, zone) => count
      + zone.geometry.rows.reduce((inner, row) => inner + row.positions.length, 0)
      + (zone.geometry.tables ?? []).reduce((inner, table) => inner + table.positions.length, 0), 0);
  const x = new Float32Array(total);
  const y = new Float32Array(total);
  const zoneSlots = new Uint16Array(total);
  const seatProperties = new Uint8Array(total);
  const ids: string[] = [];
  const rows: string[] = [];
  const labels: string[] = [];
  const zones: RenderZone[] = [];
  let start = 0;
  for (const zone of scene.zones) {
    const geometry = zone.geometry;
    let offset = start;
    const rowHeaders: RenderRowHeader[] = [];
    for (const row of geometry.rows) {
      if (row.positions.length > 0) {
        const first = row.positions[0];
        const last = row.positions[row.positions.length - 1];
        rowHeaders.push({
          label: row.label,
          startX: first.x / 1_000,
          startY: first.y / 1_000,
          endX: last.x / 1_000,
          endY: last.y / 1_000,
          count: row.positions.length,
        });
      }
      for (const position of row.positions) {
        x[offset] = position.x / 1_000;
        y[offset] = position.y / 1_000;
        zoneSlots[offset] = zones.length;
        seatProperties[offset] = packSeatProperties(resolveProperties(
          position.properties, row.properties, geometry.properties, scene.properties));
        ids.push(position.id ?? '');
        rows.push(row.label);
        labels.push(position.label);
        offset++;
      }
    }
    for (const table of geometry.tables ?? [])
      for (const position of table.positions) {
        x[offset] = position.x / 1_000;
        y[offset] = position.y / 1_000;
        zoneSlots[offset] = zones.length;
        seatProperties[offset] = packSeatProperties(resolveProperties(
          position.properties, table.properties, geometry.properties, scene.properties));
        ids.push(position.id ?? '');
        rows.push(table.label);
        labels.push(position.label);
        offset++;
      }
    const tables: RenderTable[] = (geometry.tables ?? []).map((t) => ({
      label: t.label,
      x: t.x / 1_000,
      y: t.y / 1_000,
      rotation: (t.rotation / 1_000) * (Math.PI / 180),
      capacity: t.capacity,
    }));
    zones.push({
      zoneId: zone.zoneId, zoneVersion: zone.zoneVersion, code: geometry.code, name: geometry.name,
      color: geometry.color, kind: zoneKindOf(geometry), capacity: zoneCapacity(geometry),
      x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height,
      start, count: offset - start,
      rowHeaders,
      tables,
    });
    start = offset;
  }

  return {
    configurationId: scene.configurationId, revision: scene.revision, zones, x, y, zoneSlots,
    spatial: buildSpatialIndex(x, y), positionIds: packText(ids), rows: packText(rows), labels: packText(labels),
    seatProperties,
  };
}

export function renderTransferables(scene: RenderGeometry): ArrayBuffer[] {
  return [scene.x.buffer, scene.y.buffer, scene.seatProperties.buffer, scene.positionIds.bytes.buffer, scene.positionIds.offsets.buffer,
    scene.rows.bytes.buffer, scene.rows.offsets.buffer, scene.labels.bytes.buffer,
    scene.labels.offsets.buffer, scene.zoneSlots.buffer, scene.spatial.cellX.buffer,
    scene.spatial.cellY.buffer, scene.spatial.offsets.buffer, scene.spatial.slots.buffer] as ArrayBuffer[];
}

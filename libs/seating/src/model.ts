/**
 * Модель геометрии повторяет контракт backend (ADR-052, артефакт 20 §2.1):
 * абсолютные координаты в целых тысячных условной единицы, ряды и места —
 * сущности с устойчивыми ключами, три вида зоны. Цены и доступность сюда не входят.
 */
export const geometryFormatVersion = 4;
export const maxZonePositions = 54_000;
export const maxLabelLength = 64;
export const maxNameLength = 200;
export const coordinateLimit = 1_000_000_000;
export const maxRotation = 359_999;
/** Целевой размер части манифеста; сервер части ещё не отдаёт. */
export const maxChunkPositions = 2_000;

/** PDF coordinates use native PDF user space: points (1/72 inch), origin bottom-left. */
export interface FloorCalibrationPoint {
  x: number;
  y: number;
}

/** Two measured points define the PDF-to-floor scale and rotation. */
export interface FloorCalibration {
  point1: FloorCalibrationPoint;
  point2: FloorCalibrationPoint;
  distanceMeters: number;
}

export type SeatingZoneKind = 'Numbered' | 'Free' | 'Tables';
export const seatingZoneKinds: readonly SeatingZoneKind[] = ['Numbered', 'Free', 'Tables'];
export type SeatingTableSaleMode = 'Whole' | 'Individual' | 'MinimumQuantity';
export const seatingTableSaleModes: readonly SeatingTableSaleMode[] = ['Whole', 'Individual', 'MinimumQuantity'];

export type SeatingAccessibility = 'None' | 'Wheelchair' | 'Companion' | 'ReducedMobility';
export const seatingAccessibilities: readonly SeatingAccessibility[] =
  ['None', 'Wheelchair', 'Companion', 'ReducedMobility'];

export type SeatingViewObstruction = 'None' | 'Partial' | 'Severe';
export const seatingViewObstructions: readonly SeatingViewObstruction[] = ['None', 'Partial', 'Severe'];

/**
 * Объявленные общие свойства уровня (ADR-052 §4). Отсутствие поля означает наследование,
 * а явные `None` и `false` — заданное значение. Цена сюда не входит: она принадлежит показу.
 */
export interface SeatingProperties {
  accessibility?: SeatingAccessibility | null;
  viewObstruction?: SeatingViewObstruction | null;
  sellable?: boolean | null;
}

/** Свойства после разрешения наследования; неопределённых полей не остаётся. */
export interface ResolvedSeatingProperties {
  accessibility: SeatingAccessibility;
  viewObstruction: SeatingViewObstruction;
  sellable: boolean;
}

/** Значения, действующие, когда ни один уровень цепочки ничего не объявил. */
export const defaultSeatingProperties: ResolvedSeatingProperties =
  { accessibility: 'None', viewObstruction: 'None', sellable: true };

/** Уровень ничего не объявил, поэтому наследует всё. */
export function declaresNothing(properties: SeatingProperties | null | undefined): boolean {
  if (!properties) return true;
  return (properties.accessibility ?? null) === null
    && (properties.viewObstruction ?? null) === null
    && (properties.sellable ?? null) === null;
}

/**
 * Тот же конечный порядок, что и на сервере: позиция → ряд/стол → зона → конфигурация.
 * Каждое свойство разрешается независимо, цепочка не продолжается произвольной ссылкой.
 */
export function resolveProperties(
  position?: SeatingProperties | null, row?: SeatingProperties | null,
  zone?: SeatingProperties | null, configuration?: SeatingProperties | null,
): ResolvedSeatingProperties {
  const pick = <T>(...values: (T | null | undefined)[]): T | undefined =>
    values.find(value => value !== null && value !== undefined) ?? undefined;
  return {
    accessibility: pick(position?.accessibility, row?.accessibility, zone?.accessibility,
      configuration?.accessibility) ?? defaultSeatingProperties.accessibility,
    viewObstruction: pick(position?.viewObstruction, row?.viewObstruction, zone?.viewObstruction,
      configuration?.viewObstruction) ?? defaultSeatingProperties.viewObstruction,
    sellable: pick(position?.sellable, row?.sellable, zone?.sellable,
      configuration?.sellable) ?? defaultSeatingProperties.sellable,
  };
}

export function validateProperties(properties: SeatingProperties | null | undefined, field: string): void {
  if (properties === null || properties === undefined) return;
  if (typeof properties !== 'object') throw new Error(field + ': ожидается объект свойств.');
  const { accessibility, viewObstruction, sellable } = properties;
  if (accessibility !== null && accessibility !== undefined && !seatingAccessibilities.includes(accessibility))
    throw new Error(field + ': неизвестный признак доступности.');
  if (viewObstruction !== null && viewObstruction !== undefined && !seatingViewObstructions.includes(viewObstruction))
    throw new Error(field + ': неизвестное ограничение обзора.');
  if (sellable !== null && sellable !== undefined && typeof sellable !== 'boolean')
    throw new Error(field + ': продаваемость задаётся логическим значением.');
}

/** Место без цены и статуса; `id` отсутствует у ещё не сохранённой идентичности. */
export interface SeatingPositionGeometry {
  id?: string | null;
  label: string;
  x: number;
  y: number;
  rotation: number;
  properties?: SeatingProperties | null;
}

export interface SeatingRowGeometry {
  id?: string | null;
  label: string;
  positions: SeatingPositionGeometry[];
  properties?: SeatingProperties | null;
}

export interface SeatingTableGeometry {
  id?: string | null; label: string; x: number; y: number; rotation: number; capacity: number;
  saleMode: SeatingTableSaleMode; positions: SeatingPositionGeometry[];
  minimumQuantity?: number | null; properties?: SeatingProperties | null;
}

export interface SeatingZoneGeometry {
  /** Стабильный этаж зоны; старые снимки до backfill могут не передавать его. */
  floorId?: string | null;
  code: string;
  name: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: SeatingRowGeometry[];
  /** Numbered по умолчанию; API опускает это значение в ответе. */
  kind?: SeatingZoneKind;
  /** Положительный лимит свободной зоны; у нумерованной — null. */
  capacity?: number | null;
  /** Объявленные свойства зоны; отсутствие означает наследование от конфигурации. */
  properties?: SeatingProperties | null;
  tables?: SeatingTableGeometry[] | null;
}

/** Зона состава редакции: ключ и обе версии снимка выданы сервером. */
export interface SeatingSceneZone {
  zoneId: string;
  zoneVersion: number;
  /** Версия состава: не изменилась — ряды и места сервер не переписывал. */
  compositionVersion?: number;
  geometry: SeatingZoneGeometry;
}

/** Состав одной редакции черновика — то, что стенд рисует и измеряет. */
export interface SeatingScene {
  formatVersion: number;
  configurationId: string;
  revision: number | null;
  zones: SeatingSceneZone[];
  /** Умолчания конфигурации — последний уровень наследования свойств. */
  properties?: SeatingProperties | null;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const colorPattern = /^#[0-9a-f]{6}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

export function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && colorPattern.test(value);
}

/** Та же нормализация, что у сервера: NFC и обрезка краёв, затем предел длины. */
export function normalizeText(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(field + ': значение обязательно.');
  const normalized = value.trim().normalize('NFC');
  if (normalized.length > maxLength) throw new Error(field + ': не более ' + maxLength + ' символов.');
  if (normalized.includes('\u0000')) throw new Error(field + ': нулевой символ запрещён.');
  return normalized;
}

export function zoneKindOf(geometry: SeatingZoneGeometry): SeatingZoneKind {
  return geometry.kind ?? 'Numbered';
}

/** Вместимость нумерованной зоны задаётся местами, свободной — лимитом. */
export function zoneCapacity(geometry: SeatingZoneGeometry): number {
  return zoneKindOf(geometry) === 'Free'
    ? geometry.capacity ?? 0
    : zoneKindOf(geometry) === 'Tables'
      ? (geometry.tables ?? []).reduce((total, table) => total + table.capacity, 0)
      : geometry.rows.reduce((total, row) => total + row.positions.length, 0);
}

export function zoneHasFrame(geometry: SeatingZoneGeometry): boolean {
  return geometry.width > 0 && geometry.height > 0;
}

function checkCoordinate(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Math.abs(value as number) > coordinateLimit)
    throw new Error(field + ': целое число в пределах ±' + coordinateLimit + '.');
  return value as number;
}

function validateBounds(geometry: SeatingZoneGeometry, kind: SeatingZoneKind): void {
  checkCoordinate(geometry.x, 'x');
  checkCoordinate(geometry.y, 'y');
  if (kind === 'Free' && geometry.width === 0 && geometry.height === 0) {
    if (geometry.x !== 0 || geometry.y !== 0) throw new Error('Свободная зона без рамки задаёт x и y нулями.');
    return;
  }
  const sides: (readonly [string, number])[] = [['width', geometry.width], ['height', geometry.height]];
  for (const [field, value] of sides)
    if (!Number.isSafeInteger(value) || value < 1 || value > coordinateLimit)
      throw new Error(field + ': от 1 до ' + coordinateLimit + '; нумерованная зона требует рамку.');
}

function validateKind(geometry: SeatingZoneGeometry, kind: SeatingZoneKind): void {
  if (!Array.isArray(geometry.rows)) throw new Error('rows: ожидается список рядов.');
  if (kind === 'Numbered' || kind === 'Tables') {
    if (geometry.capacity !== null && geometry.capacity !== undefined)
      throw new Error('Вместимость нумерованной зоны определяется местами.');
    if (kind === 'Tables' && geometry.rows.length) throw new Error('Столовая зона не содержит рядов и мест.');
    if (kind === 'Numbered' && (geometry.tables?.length ?? 0)) throw new Error('Нумерованная зона не содержит столов.');
    return;
  }
  if (!Number.isSafeInteger(geometry.capacity) || (geometry.capacity as number) <= 0)
    throw new Error('Свободной зоне нужен положительный лимит вместимости.');
  if (geometry.rows.length) throw new Error('Свободная зона не содержит рядов и мест.');
  if (geometry.tables?.length) throw new Error('Свободная зона не содержит столов.');
}

function validateRow(geometry: SeatingZoneGeometry, row: SeatingRowGeometry,
  rowIds: Set<string>, rowLabels: Set<string>, positionIds: Set<string>): number {
  if (!row || !Array.isArray(row.positions)) throw new Error('Ряд без списка мест.');
  const rowLabel = normalizeText(row.label, maxLabelLength, 'Подпись ряда');
  // Адрес «ряд 7, место 12» однозначен только при уникальной подписи ряда в зоне.
  if (rowLabels.has(rowLabel)) throw new Error('Подпись ряда ' + rowLabel + ' повторена в зоне.');
  rowLabels.add(rowLabel);
  validateProperties(row.properties, 'Свойства ряда ' + rowLabel);
  if (row.id !== null && row.id !== undefined) {
    if (!isUuid(row.id)) throw new Error('Ключ ряда должен быть UUID, полученным от сервера.');
    if (rowIds.has(row.id)) throw new Error('Ключ ряда повторён.');
    rowIds.add(row.id);
  }
  const labels = new Set<string>();
  for (const position of row.positions) {
    if (!position) throw new Error('Пустая запись места.');
    const label = normalizeText(position.label, maxLabelLength, 'Номер места');
    if (labels.has(label))
      throw new Error('Номер места ' + label + ' повторён в ряду ' + rowLabel + '.');
    labels.add(label);
    if (position.id !== null && position.id !== undefined) {
      if (!isUuid(position.id)) throw new Error('Ключ места должен быть UUID, полученным от сервера.');
      if (positionIds.has(position.id)) throw new Error('Ключ места повторён.');
      positionIds.add(position.id);
    }
    validateProperties(position.properties, 'Свойства места ' + label);
    checkCoordinate(position.x, 'Координата места x');
    checkCoordinate(position.y, 'Координата места y');
    if (position.x < geometry.x || position.x > geometry.x + geometry.width
      || position.y < geometry.y || position.y > geometry.y + geometry.height)
      throw new Error('Место ' + label + ' выходит за границы зоны ' + geometry.name + '.');
    if (!Number.isSafeInteger(position.rotation) || position.rotation < 0 || position.rotation > maxRotation)
      throw new Error('Поворот задаётся тысячными долями градуса от 0 до ' + maxRotation + '.');
  }
  return row.positions.length;
}

/** Те же правила, что проверит сервер перед записью снимка зоны. */
export function validateZoneGeometry(geometry: SeatingZoneGeometry): void {
  if (!geometry || typeof geometry !== 'object') throw new Error('Геометрия зоны обязательна.');
  const kind = zoneKindOf(geometry);
  if (!seatingZoneKinds.includes(kind)) throw new Error('Неизвестный вид зоны.');
  normalizeText(geometry.code, maxLabelLength, 'Код зоны');
  normalizeText(geometry.name, maxNameLength, 'Название зоны');
  if (!isValidColor(geometry.color)) throw new Error('Цвет зоны задаётся как #RRGGBB.');
  validateProperties(geometry.properties, 'Свойства зоны');
  validateBounds(geometry, kind);
  validateKind(geometry, kind);
  if (geometry.rows.length > maxZonePositions)
    throw new Error('Не более ' + maxZonePositions + ' рядов в зоне.');
  const rowIds = new Set<string>();
  const rowLabels = new Set<string>();
  const positionIds = new Set<string>();
  let total = 0;
  for (const row of geometry.rows) {
    total += validateRow(geometry, row, rowIds, rowLabels, positionIds);
    if (total > maxZonePositions) throw new Error('Не более ' + maxZonePositions + ' мест в зоне.');
  }
  const tableIds = new Set<string>();
  const tableLabels = new Set<string>();
  for (const table of geometry.tables ?? []) {
    if (!table || !Array.isArray(table.positions)) throw new Error('Стол без списка позиций.');
    const label = normalizeText(table.label, maxLabelLength, 'Подпись стола');
    if (tableLabels.has(label)) throw new Error('Подпись стола повторена в зоне.');
    tableLabels.add(label);
    if (table.id != null && (!isUuid(table.id) || tableIds.has(table.id))) throw new Error('Ключ стола некорректен или повторён.');
    if (table.id) tableIds.add(table.id);
    checkCoordinate(table.x, 'Координата стола x'); checkCoordinate(table.y, 'Координата стола y');
    if (table.x < geometry.x || table.x > geometry.x + geometry.width || table.y < geometry.y || table.y > geometry.y + geometry.height)
      throw new Error('Стол выходит за границы зоны.');
    if (!Number.isSafeInteger(table.rotation) || table.rotation < 0 || table.rotation > maxRotation) throw new Error('Поворот стола некорректен.');
    if (!Number.isSafeInteger(table.capacity) || table.capacity < 1) throw new Error('Вместимость стола должна быть положительной.');
    if (!seatingTableSaleModes.includes(table.saleMode)) throw new Error('Неизвестный режим продажи стола.');
    if (table.saleMode === 'MinimumQuantity') {
      const minimumQuantity = table.minimumQuantity;
      if (typeof minimumQuantity !== 'number' || !Number.isSafeInteger(minimumQuantity)
        || minimumQuantity < 1 || minimumQuantity > table.capacity)
        throw new Error('Минимум должен быть от 1 до вместимости стола.');
    } else if (table.minimumQuantity != null) throw new Error('Минимум допустим только для MinimumQuantity.');
    validateProperties(table.properties, 'Свойства стола ' + label);
    if (table.positions.length !== table.capacity)
      throw new Error('Число позиций стола должно совпадать с его вместимостью.');
    const labels = new Set<string>();
    for (const position of table.positions) {
      if (!position) throw new Error('Пустая позиция стола.');
      const positionLabel = normalizeText(position.label, maxLabelLength, 'Номер позиции');
      if (labels.has(positionLabel)) throw new Error('Номер позиции повторён за столом ' + label + '.');
      labels.add(positionLabel);
      if (position.id !== null && position.id !== undefined) {
        if (!isUuid(position.id)) throw new Error('Ключ позиции должен быть UUID, полученным от сервера.');
        if (positionIds.has(position.id)) throw new Error('Ключ места повторён.');
        positionIds.add(position.id);
      }
      validateProperties(position.properties, 'Свойства позиции ' + positionLabel);
      checkCoordinate(position.x, 'Координата позиции x');
      checkCoordinate(position.y, 'Координата позиции y');
      if (position.x < geometry.x || position.x > geometry.x + geometry.width
        || position.y < geometry.y || position.y > geometry.y + geometry.height)
        throw new Error('Позиция ' + positionLabel + ' выходит за границы зоны ' + geometry.name + '.');
      if (!Number.isSafeInteger(position.rotation) || position.rotation < 0 || position.rotation > maxRotation)
        throw new Error('Поворот задаётся тысячными долями градуса от 0 до ' + maxRotation + '.');
      total++;
      if (total > maxZonePositions) throw new Error('Не более ' + maxZonePositions + ' мест в зоне.');
    }
  }
}

/** Дополнительно к правилам зоны: сервер не допускает место в двух зонах одной редакции. */
export function validateScene(scene: SeatingScene): asserts scene is SeatingScene {
  if (!scene || typeof scene !== 'object') throw new Error('Состав редакции должен быть объектом.');
  if (scene.formatVersion !== geometryFormatVersion) throw new Error('Неподдерживаемая версия формата стенда.');
  if (typeof scene.configurationId !== 'string' || !scene.configurationId)
    throw new Error('Не указана конфигурация состава.');
  if (scene.revision !== null && (!Number.isSafeInteger(scene.revision) || scene.revision < 1))
    throw new Error('Редакция состава — положительное целое либо null.');
  if (!Array.isArray(scene.zones)) throw new Error('Состав редакции должен содержать список зон.');
  validateProperties(scene.properties, 'Умолчания конфигурации');
  const zoneIds = new Set<string>();
  const positionIds = new Set<string>();
  for (const zone of scene.zones) {
    if (!zone || typeof zone.zoneId !== 'string' || !zone.zoneId) throw new Error('Зона состава без ключа.');
    if (zoneIds.has(zone.zoneId)) throw new Error('Ключ зоны повторён в составе.');
    zoneIds.add(zone.zoneId);
    if (!Number.isSafeInteger(zone.zoneVersion) || zone.zoneVersion < 0)
      throw new Error('Версия снимка зоны — неотрицательное целое.');
    validateZoneGeometry(zone.geometry);
    for (const row of zone.geometry.rows)
      for (const position of row.positions) {
        if (position.id === null || position.id === undefined) continue;
        if (positionIds.has(position.id))
          throw new Error('Место не может одновременно входить в две зоны редакции.');
        positionIds.add(position.id);
      }
    for (const table of zone.geometry.tables ?? [])
      for (const position of table.positions) {
        if (position.id === null || position.id === undefined) continue;
        if (positionIds.has(position.id))
          throw new Error('Место не может одновременно входить в две зоны редакции.');
        positionIds.add(position.id);
      }
  }
}

export interface SeatingChunk {
  zoneId: string;
  part: number;
  positions: SeatingPositionGeometry[];
}

/**
 * Разбиение на части целевого манифеста (артефакт 20 §5.1). Сервер манифест и части
 * ещё не отдаёт: здесь это оценка объёма, а не реальный протокол доставки.
 */
export function splitScene(scene: SeatingScene): SeatingChunk[] {
  validateScene(scene);
  return scene.zones.flatMap(zone => {
    const flat = zone.geometry.rows.flatMap(row => row.positions)
      .concat((zone.geometry.tables ?? []).flatMap(table => table.positions));
    const chunks: SeatingChunk[] = [];
    for (let start = 0; start < flat.length; start += maxChunkPositions)
      chunks.push({
        zoneId: zone.zoneId, part: chunks.length,
        positions: flat.slice(start, start + maxChunkPositions),
      });
    return chunks;
  });
}

export type SeatStatus = 'Free' | 'Reserved' | 'Sold' | 'Blocked';
export interface AvailabilityChange {
  positionId: string;
  version: number;
  status: SeatStatus;
}

/**
 * Слияние дельт доступности. Источника дельт нет: инвентарь, резерв и поток
 * доступности на сервере не реализованы (этапы S3 и S6).
 */
export function applyAvailability(
  current: ReadonlyMap<string, AvailabilityChange>, changes: readonly AvailabilityChange[],
): Map<string, AvailabilityChange> {
  const next = new Map(current);
  for (const change of changes) {
    if (!Number.isSafeInteger(change.version) || change.version < 1) throw new Error('Недопустимая версия единицы.');
    if (!['Free', 'Reserved', 'Sold', 'Blocked'].includes(change.status)) throw new Error('Неизвестный статус места.');
    if ((next.get(change.positionId)?.version ?? 0) < change.version) next.set(change.positionId, change);
  }
  return next;
}

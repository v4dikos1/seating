/** Разреженная равномерная сетка: строится в Worker и передаётся без объектов мест. */
export interface SpatialIndex {
  cellSize: number;
  cellX: Int32Array;
  cellY: Int32Array;
  offsets: Uint32Array;
  slots: Uint32Array;
}

/**
 * Сторона ячейки в единицах сцены, то есть в метрах: четыре метра держат около
 * тридцати кресел при шаге в полметра. Прежние 128 были подобраны под схемы,
 * нарисованные с шагом в восемнадцать «единиц», и в метрах накрывали бы зал целиком.
 */
export const defaultSpatialCellSize = 4;

const cellOrigin = 1_048_576;
const cellStride = 2_097_152;
const lookups = new WeakMap<SpatialIndex, Map<number, number>>();

function cellKey(cx: number, cy: number): number {
  return (cx + cellOrigin) * cellStride + (cy + cellOrigin);
}

export function buildSpatialIndex(x: Float32Array, y: Float32Array, cellSize = defaultSpatialCellSize): SpatialIndex {
  if (x.length !== y.length || !Number.isFinite(cellSize) || cellSize <= 0)
    throw new Error('Недопустимый вход пространственного индекса.');
  const cells = new Map<number, { x: number; y: number; slots: number[] }>();
  for (let slot = 0; slot < x.length; slot++) {
    if (!Number.isFinite(x[slot]) || !Number.isFinite(y[slot])) throw new Error('Недопустимая координата.');
    const cx = Math.floor(x[slot] / cellSize);
    const cy = Math.floor(y[slot] / cellSize);
    const key = cellKey(cx, cy);
    let cell = cells.get(key);
    if (!cell) {
      cell = { x: cx, y: cy, slots: [] };
      cells.set(key, cell);
    }
    cell.slots.push(slot);
  }
  const cellX = new Int32Array(cells.size);
  const cellY = new Int32Array(cells.size);
  const offsets = new Uint32Array(cells.size + 1);
  const slots = new Uint32Array(x.length);
  let i = 0;
  let start = 0;
  for (const cell of cells.values()) {
    cellX[i] = cell.x;
    cellY[i] = cell.y;
    offsets[i] = start;
    slots.set(cell.slots, start);
    start += cell.slots.length;
    i++;
  }
  offsets[i] = start;
  return { cellSize, cellX, cellY, offsets, slots };
}

/** Адресация ячеек по ключу; индекс передаётся массивами, поэтому карта строится при первом запросе. */
function lookupOf(index: SpatialIndex): Map<number, number> {
  let lookup = lookups.get(index);
  if (!lookup) {
    lookup = new Map<number, number>();
    for (let cell = 0; cell < index.cellX.length; cell++) lookup.set(cellKey(index.cellX[cell], index.cellY[cell]), cell);
    lookups.set(index, lookup);
  }
  return lookup;
}

function collect(index: SpatialIndex, cell: number, result: number[]): void {
  for (let i = index.offsets[cell]; i < index.offsets[cell + 1]; i++) result.push(index.slots[i]);
}

export function querySpatial(index: SpatialIndex, left: number, top: number, right: number, bottom: number): number[] {
  const result: number[] = [];
  if (!index.cellX.length) return result;
  const minX = Math.floor(left / index.cellSize);
  const maxX = Math.floor(right / index.cellSize);
  const minY = Math.floor(top / index.cellSize);
  const maxY = Math.floor(bottom / index.cellSize);
  if (maxX < minX || maxY < minY) return result;
  const requested = (maxX - minX + 1) * (maxY - minY + 1);
  // Окно шире самой схемы: полный обход дешевле адресации каждой пустой ячейки.
  if (requested >= index.cellX.length) {
    for (let cell = 0; cell < index.cellX.length; cell++) {
      if (index.cellX[cell] < minX || index.cellX[cell] > maxX
        || index.cellY[cell] < minY || index.cellY[cell] > maxY) continue;
      collect(index, cell, result);
    }
    return result;
  }
  const lookup = lookupOf(index);
  for (let cx = minX; cx <= maxX; cx++)
    for (let cy = minY; cy <= maxY; cy++) {
      const cell = lookup.get(cellKey(cx, cy));
      if (cell !== undefined) collect(index, cell, result);
    }
  return result;
}

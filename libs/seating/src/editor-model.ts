import { newIdentity } from './generate';
import { createStructureLabels, type StraightRowLabelOptions } from './generate-rows';
import {
  maxZonePositions, zoneKindOf,
  type SeatingPositionGeometry, type SeatingProperties, type SeatingRowGeometry, type SeatingZoneGeometry,
  type SeatingTableGeometry,
} from './model';
import { SEATING_THEME } from './theme';

/** Плоская адресация позиции внутри зоны: родитель — ряд либо стол. */
export interface SeatSlot {
  slot: number;
  parent: 'row' | 'table';
  parentIndex: number;
  positionIndex: number;
  x: number;
  y: number;
  rotation: number;
  label: string;
  parentLabel: string;
  id: string | null;
  properties?: SeatingProperties | null;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraView {
  scale: number;
  x: number;
  y: number;
}

/** Общие границы только конечных рамок зон. */
export function documentBounds(rects: readonly Rect[]): Rect | null {
  const framed = rects.filter(({ x, y, width, height }) =>
    [x, y, width, height, x + width, y + height].every(Number.isFinite)
      && width > 0 && height > 0);
  if (!framed.length) return null;
  const x = Math.min(...framed.map((rect) => rect.x));
  const y = Math.min(...framed.map((rect) => rect.y));
  const right = Math.max(...framed.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...framed.map((rect) => rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Подгонка камеры остаётся определённой и для пустой или повреждённой геометрии. */
export function fitCamera(rect: Rect | null, viewportWidth: number, viewportHeight: number): CameraView {
  const empty: CameraView = { scale: 25, x: 60, y: 60 };
  if (!rect || ![rect.x, rect.y, rect.width, rect.height, viewportWidth, viewportHeight]
    .every(Number.isFinite) || rect.width <= 0 || rect.height <= 0
    || viewportWidth <= 0 || viewportHeight <= 0) return empty;

  const widthMeters = rect.width / 1_000;
  const heightMeters = rect.height / 1_000;
  const scale = Math.max(SEATING_THEME.zoom.minScale,
    Math.min((viewportWidth - 80) / widthMeters, (viewportHeight - 80) / heightMeters,
      SEATING_THEME.zoom.fitMaxScale));
  const x = (viewportWidth - widthMeters * scale) / 2 - (rect.x / 1_000) * scale;
  const y = (viewportHeight - heightMeters * scale) / 2 - (rect.y / 1_000) * scale;
  return [scale, x, y].every(Number.isFinite) ? { scale, x, y } : empty;
}

/**
 * Отступ рамки зоны и шаг мест — в миллиметрах помещения (см. `units.ts`).
 * Метр вокруг крайних кресел и полметра между соседними — обычные величины зала;
 * прежние 20 000 и 18 000 означали двадцать и восемнадцать метров.
 */
export const framePadding: number = SEATING_THEME.geometry.framePaddingMm;
export const defaultSeatStep: number = SEATING_THEME.geometry.seatPitchMm;
export const defaultRowStep: number = SEATING_THEME.geometry.rowPitchMm;
export const defaultZoneFrameWidth: number = SEATING_THEME.defaultZoneFrame.widthMm;
export const defaultZoneFrameHeight: number = SEATING_THEME.defaultZoneFrame.heightMm;

export function flattenZone(geometry: SeatingZoneGeometry): SeatSlot[] {
  const result: SeatSlot[] = [];
  geometry.rows.forEach((row, rowIndex) => {
    row.positions.forEach((position, seatIndex) => {
      result.push({
        slot: result.length, parent: 'row', parentIndex: rowIndex, positionIndex: seatIndex,
        x: position.x, y: position.y, rotation: position.rotation,
        label: position.label, parentLabel: row.label, id: position.id ?? null, properties: position.properties,
      });
    });
  });
  (geometry.tables ?? []).forEach((table, tableIndex) => {
    table.positions.forEach((position, positionIndex) => {
      result.push({
        slot: result.length, parent: 'table', parentIndex: tableIndex, positionIndex,
        x: position.x, y: position.y, rotation: position.rotation,
        label: position.label, parentLabel: table.label, id: position.id ?? null, properties: position.properties,
      });
    });
  });
  return result;
}

function mapPositions(geometry: SeatingZoneGeometry,
  change: (position: SeatingPositionGeometry, slot: SeatSlot) => SeatingPositionGeometry): SeatingZoneGeometry {
  let slot = 0;
  const rows = geometry.rows.map((row, rowIndex) => ({
    ...row,
    positions: row.positions.map((position, seatIndex) => {
      const current: SeatSlot = {
        slot: slot++, parent: 'row', parentIndex: rowIndex, positionIndex: seatIndex,
        x: position.x, y: position.y, rotation: position.rotation,
        label: position.label, parentLabel: row.label, id: position.id ?? null, properties: position.properties,
      };
      return change(position, current);
    }),
  }));
  const tables = (geometry.tables ?? []).map((table, tableIndex) => ({
    ...table,
    positions: table.positions.map((position, positionIndex) => {
      const current: SeatSlot = {
        slot: slot++, parent: 'table', parentIndex: tableIndex, positionIndex,
        x: position.x, y: position.y, rotation: position.rotation,
        label: position.label, parentLabel: table.label, id: position.id ?? null, properties: position.properties,
      };
      return change(position, current);
    }),
  }));
  return { ...geometry, rows, tables };
}

/** Рамка только растёт: подогнанные вручную границы не схлопываются при правке мест. */
export function growFrame(geometry: SeatingZoneGeometry): SeatingZoneGeometry {
  const seats = flattenZone(geometry);
  if (!seats.length) return geometry;
  const minX = Math.min(...seats.map((seat) => seat.x)) - framePadding;
  const minY = Math.min(...seats.map((seat) => seat.y)) - framePadding;
  const maxX = Math.max(...seats.map((seat) => seat.x)) + framePadding;
  const maxY = Math.max(...seats.map((seat) => seat.y)) + framePadding;
  const x = Math.min(geometry.x, minX);
  const y = Math.min(geometry.y, minY);
  return {
    ...geometry, x, y,
    width: Math.max(geometry.x + geometry.width, maxX) - x,
    height: Math.max(geometry.y + geometry.height, maxY) - y,
  };
}

/** Рамка по местам без запаса прежних границ. */
export function fitFrame(geometry: SeatingZoneGeometry): SeatingZoneGeometry {
  const seats = flattenZone(geometry);
  if (!seats.length) return geometry;
  const minX = Math.min(...seats.map((seat) => seat.x)) - framePadding;
  const minY = Math.min(...seats.map((seat) => seat.y)) - framePadding;
  return {
    ...geometry, x: minX, y: minY,
    width: Math.max(...seats.map((seat) => seat.x)) + framePadding - minX,
    height: Math.max(...seats.map((seat) => seat.y)) + framePadding - minY,
  };
}

/**
 * Ставит рамку зоне, у которой её нет (`width`/`height` = 0 — обычно так выглядит
 * `kind: 'Free'` без единого места, импортированная как точка). Без рамки зону
 * не видно на холсте и не выбрать иначе, чем из списка, а «Подогнать границы под
 * места» здесь бессилен: мест тоже нет. Действие явное — ставит рамку заданного
 * размера с центром в точке `center` — и, как обычная правка геометрии, отменяется
 * через Ctrl+Z. Места и столы зоны не трогает: у зоны без рамки их и не может быть.
 */
export function setZoneFrame(
  geometry: SeatingZoneGeometry,
  center: { x: number; y: number },
  width: number = defaultZoneFrameWidth,
  height: number = defaultZoneFrameHeight,
): SeatingZoneGeometry {
  return {
    ...geometry,
    x: Math.round(center.x - width / 2),
    y: Math.round(center.y - height / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export type ZoneResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const minimumZoneFrameSize = 500;

/** Меняет только рамку; границы не могут пересечь уже расставленные места и столы. */
export function resizeZoneFrame(
  geometry: SeatingZoneGeometry,
  handle: ZoneResizeHandle,
  x: number,
  y: number,
): SeatingZoneGeometry {
  const positions = flattenZone(geometry);
  const coordinates = [
    ...positions.map((seat) => ({ x: seat.x, y: seat.y })),
    ...(geometry.tables ?? []).map((table) => ({ x: table.x, y: table.y })),
  ];
  const left = geometry.x;
  const top = geometry.y;
  const right = left + geometry.width;
  const bottom = top + geometry.height;
  const minX = coordinates.length ? Math.min(...coordinates.map((point) => point.x)) : Infinity;
  const maxX = coordinates.length ? Math.max(...coordinates.map((point) => point.x)) : -Infinity;
  const minY = coordinates.length ? Math.min(...coordinates.map((point) => point.y)) : Infinity;
  const maxY = coordinates.length ? Math.max(...coordinates.map((point) => point.y)) : -Infinity;
  const nextLeft = handle.includes('w') ? Math.min(Math.round(x), right - minimumZoneFrameSize, minX) : left;
  const nextRight = handle.includes('e') ? Math.max(Math.round(x), left + minimumZoneFrameSize, maxX) : right;
  const nextTop = handle.includes('n') ? Math.min(Math.round(y), bottom - minimumZoneFrameSize, minY) : top;
  const nextBottom = handle.includes('s') ? Math.max(Math.round(y), top + minimumZoneFrameSize, maxY) : bottom;
  if (nextLeft === left && nextTop === top && nextRight === right && nextBottom === bottom) return geometry;
  return {
    ...geometry,
    x: nextLeft, y: nextTop,
    width: nextRight - nextLeft,
    height: nextBottom - nextTop,
  };
}

export function selectInRect(geometry: SeatingZoneGeometry, rect: Rect): number[] {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return flattenZone(geometry)
    .filter((seat) => seat.x >= rect.x && seat.x <= right && seat.y >= rect.y && seat.y <= bottom)
    .map((seat) => seat.slot);
}

export function nearestSeat(geometry: SeatingZoneGeometry, x: number, y: number, radius: number): number | null {
  let best: number | null = null;
  let distance = radius;
  for (const seat of flattenZone(geometry)) {
    const candidate = Math.hypot(seat.x - x, seat.y - y);
    if (candidate <= distance) {
      distance = candidate;
      best = seat.slot;
    }
  }
  return best;
}

export function moveSeats(geometry: SeatingZoneGeometry, slots: readonly number[],
  dx: number, dy: number): SeatingZoneGeometry {
  const moving = new Set(slots);
  const allSlots = flattenZone(geometry);
  const moved = mapPositions(geometry, (position, seat) => moving.has(seat.slot)
    ? { ...position, x: Math.round(position.x + dx), y: Math.round(position.y + dy) }
    : position);
  const tables = (moved.tables ?? []).map((table, tIndex) => {
    const tableSlots = allSlots.filter((s) => s.parent === 'table' && s.parentIndex === tIndex);
    const movedCount = tableSlots.filter((s) => moving.has(s.slot)).length;
    if (movedCount > 0) {
      return {
        ...table,
        x: Math.round(table.x + dx),
        y: Math.round(table.y + dy),
      };
    }
    return table;
  });
  return growFrame({ ...moved, tables });
}

/** Перемещение всей зоны целиком: рамка, ряды и столы смещаются синхронно. */
export function moveZone(geometry: SeatingZoneGeometry, dx: number, dy: number): SeatingZoneGeometry {
  const roundDx = Math.round(dx);
  const roundDy = Math.round(dy);
  if (roundDx === 0 && roundDy === 0) return geometry;

  const rows = geometry.rows.map((row) => ({
    ...row,
    positions: row.positions.map((pos) => ({
      ...pos,
      x: pos.x + roundDx,
      y: pos.y + roundDy,
    })),
  }));

  const tables = (geometry.tables ?? []).map((table) => ({
    ...table,
    x: table.x + roundDx,
    y: table.y + roundDy,
    positions: table.positions.map((pos) => ({
      ...pos,
      x: pos.x + roundDx,
      y: pos.y + roundDy,
    })),
  }));

  return {
    ...geometry,
    x: geometry.x + roundDx,
    y: geometry.y + roundDy,
    rows,
    tables,
  };
}

/**
 * Фактический шаг мест зоны: медиана расстояний между соседями внутри рядов.
 * Нужна, чтобы отличить схему, нарисованную в метрах, от схемы, нарисованной
 * в неизвестном масштабе: в зале кресла стоят через 45–60 см, и всё, что сильно
 * больше, означает, что геометрия построена не в тех единицах.
 * Возвращает `null`, когда измерять нечего: ни в одном ряду нет пары соседей.
 */
export function measureSeatPitch(geometry: SeatingZoneGeometry): number | null {
  const gaps: number[] = [];
  for (const row of geometry.rows) {
    for (let index = 1; index < row.positions.length; index++) {
      const previous = row.positions[index - 1];
      const current = row.positions[index];
      const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
      if (distance > 0) gaps.push(distance);
    }
  }
  if (!gaps.length) return null;
  gaps.sort((left, right) => left - right);
  return Math.round(gaps[Math.floor(gaps.length / 2)]);
}

/**
 * Масштабирование зоны относительно её левого верхнего угла: рамка, ряды, места и столы
 * меняются согласованно. Операция явная и отменяемая — ею приводят к настоящему масштабу
 * схему, нарисованную в чужих единицах, и подгоняют импортированную геометрию.
 */
export function scaleZone(geometry: SeatingZoneGeometry, factor: number): SeatingZoneGeometry {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('Коэффициент масштаба должен быть положительным.');
  if (factor === 1) return geometry;
  const originX = geometry.x;
  const originY = geometry.y;
  const at = (value: number, origin: number) => Math.round(origin + (value - origin) * factor);

  const rows = geometry.rows.map((row) => ({
    ...row,
    positions: row.positions.map((position) => ({
      ...position,
      x: at(position.x, originX),
      y: at(position.y, originY),
    })),
  }));

  const tables = (geometry.tables ?? []).map((table) => ({
    ...table,
    x: at(table.x, originX),
    y: at(table.y, originY),
    positions: table.positions.map((position) => ({
      ...position,
      x: at(position.x, originX),
      y: at(position.y, originY),
    })),
  }));

  return {
    ...geometry,
    width: Math.max(0, Math.round(geometry.width * factor)),
    height: Math.max(0, Math.round(geometry.height * factor)),
    rows,
    tables,
  };
}

/** Задание точных координат отдельного места (координаты контракта, миллиметры). */
export function setSeatPosition(
  geometry: SeatingZoneGeometry,
  slot: number,
  x: number,
  y: number,
): SeatingZoneGeometry {
  const updated = mapPositions(geometry, (pos, seat) => {
    if (seat.slot !== slot) return pos;
    return { ...pos, x: Math.round(x), y: Math.round(y) };
  });
  return growFrame(updated);
}

export function removeRow(geometry: SeatingZoneGeometry, rowIndex: number): SeatingZoneGeometry {
  const rows = geometry.rows.filter((_, index) => index !== rowIndex);
  return { ...geometry, rows };
}

export function removeTable(geometry: SeatingZoneGeometry, tableIndex: number): SeatingZoneGeometry {
  const tables = (geometry.tables ?? []).filter((_, index) => index !== tableIndex);
  return { ...geometry, tables };
}

export function removeSeats(geometry: SeatingZoneGeometry, slots: readonly number[]): SeatingZoneGeometry {
  const removing = new Set(slots);
  let slot = 0;
  const rows = geometry.rows
    .map((row) => ({ ...row, positions: row.positions.filter(() => !removing.has(slot++)) }))
    // Ряд без мест исчезает: пустой ряд не описывает ничего и только мешает нумерации.
    .filter((row) => row.positions.length > 0);
  const tables = (geometry.tables ?? [])
    .map((table) => {
      const positions = table.positions.filter(() => !removing.has(slot++));
      return {
        ...table, positions, capacity: positions.length,
        minimumQuantity: table.saleMode === 'MinimumQuantity'
          ? Math.min(table.minimumQuantity ?? 1, positions.length)
          : null,
      };
    })
    .filter((table) => table.positions.length > 0);
  return { ...geometry, rows, tables };
}

export interface RowPlan {
  from: { x: number; y: number };
  to: { x: number; y: number };
  count: number;
  label: string;
  firstSeat: number;
}

export interface SnapRowOptions {
  lockAxis?: boolean;
  snapAngle?: boolean;
  snapGrid?: boolean;
  step?: number;
  fixedCount?: number;
  neighborRows?: readonly SeatingRowGeometry[];
}

export interface SnappedRowPlan {
  from: { x: number; y: number };
  to: { x: number; y: number };
  count: number;
  step: number;
  angleDeg: number;
}

export function snapToGrid(value: number, step = defaultSeatStep): number {
  return Math.round(value / step) * step;
}

export function snapPointToGrid(p: { x: number; y: number }, step = defaultSeatStep): { x: number; y: number } {
  return {
    x: Math.round(p.x / step) * step,
    y: Math.round(p.y / step) * step,
  };
}

/**
 * Вычисляет привязку ряда при протяжке:
 * - фиксация горизонтали/вертикали (Shift);
 * - привязка угла к шагу 15°;
 * - привязка начала к сетке либо базовой линии соседнего ряда;
 * - подгонка длины под целое число мест с заданным шагом.
 */
export function snapRowPlan(
  rawFrom: { x: number; y: number },
  rawTo: { x: number; y: number },
  options: SnapRowOptions = {},
): SnappedRowPlan {
  const step = options.step ?? defaultSeatStep;
  const from = options.snapGrid ? snapPointToGrid(rawFrom, step) : { ...rawFrom };

  if (options.neighborRows?.length) {
    for (const row of options.neighborRows) {
      if (!row.positions.length) continue;
      const first = row.positions[0];
      if (Math.abs(from.x - first.x) < step * 0.75) from.x = first.x;
      if (Math.abs(from.y - first.y) < step * 0.75) from.y = first.y;
    }
  }

  const dx = rawTo.x - from.x;
  const dy = rawTo.y - from.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 1) {
    return {
      from,
      to: { x: from.x + step, y: from.y },
      count: 1,
      step,
      angleDeg: 0,
    };
  }

  let angle = Math.atan2(dy, dx);
  let deg = ((angle * 180) / Math.PI + 360) % 360;

  if (options.lockAxis) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      deg = dx >= 0 ? 0 : 180;
    } else {
      deg = dy >= 0 ? 90 : 270;
    }
    angle = (deg * Math.PI) / 180;
  } else if (options.snapAngle !== false) {
    const nearest15 = Math.round(deg / 15) * 15;
    for (const cardinal of [0, 90, 180, 270, 360]) {
      if (Math.abs(deg - cardinal) <= 6) {
        deg = cardinal % 360;
        break;
      }
    }
    if (deg % 90 !== 0) deg = nearest15 % 360;
    angle = (deg * Math.PI) / 180;
  }

  let count = options.fixedCount ?? Math.max(1, Math.round(dist / step) + 1);
  if (count > maxZonePositions) count = maxZonePositions;

  const actualDist = count > 1 ? (count - 1) * step : 0;
  const to = {
    x: Math.round(from.x + Math.cos(angle) * actualDist),
    y: Math.round(from.y + Math.sin(angle) * actualDist),
  };

  return {
    from,
    to,
    count,
    step,
    angleDeg: Math.round(deg),
  };
}

/** Выравнивание выделенных мест по горизонтали (одинаковый Y) или вертикали (одинаковый X). */
export function alignSeats(
  geometry: SeatingZoneGeometry,
  slots: readonly number[],
  direction: 'horizontal' | 'vertical',
): SeatingZoneGeometry {
  if (slots.length <= 1) return geometry;
  const selectedSet = new Set(slots);
  const allSlots = flattenZone(geometry).filter((s) => selectedSet.has(s.slot));
  if (allSlots.length <= 1) return geometry;

  const target =
    direction === 'horizontal'
      ? Math.round(allSlots.reduce((sum, s) => sum + s.y, 0) / allSlots.length)
      : Math.round(allSlots.reduce((sum, s) => sum + s.x, 0) / allSlots.length);

  const updated = mapPositions(geometry, (position, seat) => {
    if (!selectedSet.has(seat.slot)) return position;
    return direction === 'horizontal' ? { ...position, y: target } : { ...position, x: target };
  });

  return growFrame(updated);
}

/** Равномерное распределение выделенных мест вдоль их главной оси. */
export function distributeSeats(
  geometry: SeatingZoneGeometry,
  slots: readonly number[],
): SeatingZoneGeometry {
  if (slots.length < 3) return geometry;
  const selectedSet = new Set(slots);
  const seats = flattenZone(geometry).filter((s) => selectedSet.has(s.slot));
  if (seats.length < 3) return geometry;

  const spanX = Math.max(...seats.map((s) => s.x)) - Math.min(...seats.map((s) => s.x));
  const spanY = Math.max(...seats.map((s) => s.y)) - Math.min(...seats.map((s) => s.y));

  const sorted = [...seats].sort((a, b) => (spanX >= spanY ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const totalSteps = sorted.length - 1;
  const slotPositions = new Map<number, { x: number; y: number }>();

  sorted.forEach((seat, index) => {
    const ratio = index / totalSteps;
    slotPositions.set(seat.slot, {
      x: Math.round(first.x + (last.x - first.x) * ratio),
      y: Math.round(first.y + (last.y - first.y) * ratio),
    });
  });

  const updated = mapPositions(geometry, (position, seat) => {
    const nextPos = slotPositions.get(seat.slot);
    if (!nextPos) return position;
    return { ...position, x: nextPos.x, y: nextPos.y };
  });

  return growFrame(updated);
}

/** Выпрямление целого ряда: места располагаются строго на отрезке между крайними позициями с равным шагом. */
export function straightenRow(
  geometry: SeatingZoneGeometry,
  rowIndex: number,
): SeatingZoneGeometry {
  const row = geometry.rows[rowIndex];
  if (!row || row.positions.length < 2) return geometry;

  const positions = [...row.positions];
  const first = positions[0];
  const last = positions[positions.length - 1];
  const count = positions.length;
  const steps = count - 1;

  const angle = Math.atan2(last.y - first.y, last.x - first.x);
  const rotation = Math.round(((angle * 180) / Math.PI * 1_000 + 360_000) % 360_000);

  const straightened = positions.map((pos, index) => {
    const ratio = index / steps;
    return {
      ...pos,
      x: Math.round(first.x + (last.x - first.x) * ratio),
      y: Math.round(first.y + (last.y - first.y) * ratio),
      rotation,
    };
  });

  const rows = geometry.rows.map((r, idx) => (idx === rowIndex ? { ...r, positions: straightened } : r));
  return growFrame({ ...geometry, rows });
}

/** Задание точного шага между местами ряда вдоль его направления. */
export function setRowStep(
  geometry: SeatingZoneGeometry,
  rowIndex: number,
  step = defaultSeatStep,
): SeatingZoneGeometry {
  const row = geometry.rows[rowIndex];
  if (!row || row.positions.length < 2) return geometry;

  const positions = [...row.positions];
  const first = positions[0];
  const last = positions[positions.length - 1];

  const angle = Math.atan2(last.y - first.y, last.x - first.x);
  const rotation = Math.round(((angle * 180) / Math.PI * 1_000 + 360_000) % 360_000);

  const updatedPositions = positions.map((pos, index) => ({
    ...pos,
    x: Math.round(first.x + Math.cos(angle) * step * index),
    y: Math.round(first.y + Math.sin(angle) * step * index),
    rotation,
  }));

  const rows = geometry.rows.map((r, idx) => (idx === rowIndex ? { ...r, positions: updatedPositions } : r));
  return growFrame({ ...geometry, rows });
}

/** Привязка выделенных мест к сетке с заданным шагом. */
export function snapSelectionToGrid(
  geometry: SeatingZoneGeometry,
  slots: readonly number[],
  step = defaultSeatStep,
): SeatingZoneGeometry {
  const selectedSet = new Set(slots);
  const updated = mapPositions(geometry, (position, seat) => {
    if (!selectedSet.has(seat.slot)) return position;
    return {
      ...position,
      x: Math.round(position.x / step) * step,
      y: Math.round(position.y / step) * step,
    };
  });
  return growFrame(updated);
}

/** Ряд строится по отрезку: места распределяются равномерно между началом и концом. */
export function addRow(geometry: SeatingZoneGeometry, plan: RowPlan): SeatingZoneGeometry {
  if (!Number.isSafeInteger(plan.count) || plan.count < 1) throw new Error('В ряду должно быть хотя бы одно место.');
  const total = flattenZone(geometry).length;
  if (total + plan.count > maxZonePositions)
    throw new Error('В зоне не может быть больше ' + maxZonePositions + ' мест.');
  const steps = Math.max(1, plan.count - 1);
  const positions: SeatingPositionGeometry[] = [];
  for (let index = 0; index < plan.count; index++) {
    const ratio = plan.count === 1 ? 0 : index / steps;
    positions.push({
      id: null,
      label: String(plan.firstSeat + index),
      x: Math.round(plan.from.x + (plan.to.x - plan.from.x) * ratio),
      y: Math.round(plan.from.y + (plan.to.y - plan.from.y) * ratio),
      rotation: 0,
    });
  }
  const row: SeatingRowGeometry = { id: null, label: plan.label, positions };
  return growFrame({ ...geometry, rows: [...geometry.rows, row] });
}

export function addSeat(geometry: SeatingZoneGeometry, rowIndex: number, x: number, y: number): SeatingZoneGeometry {
  const rows = geometry.rows.map((row, index) => {
    if (index !== rowIndex) return row;
    const used = new Set(row.positions.map((position) => position.label));
    let next = row.positions.length + 1;
    while (used.has(String(next))) next++;
    return {
      ...row,
      positions: [...row.positions, { id: null, label: String(next), x: Math.round(x), y: Math.round(y), rotation: 0 }],
    };
  });
  return growFrame({ ...geometry, rows });
}

export function addSeatToRow(geometry: SeatingZoneGeometry, rowIndex: number): SeatingZoneGeometry {
  const row = geometry.rows[rowIndex];
  if (!row) return geometry;
  let nextX = snapToGrid(geometry.x + framePadding, defaultSeatStep);
  let nextY = snapToGrid(geometry.y + framePadding, defaultSeatStep);

  if (row.positions.length >= 2) {
    const last = row.positions[row.positions.length - 1];
    const prev = row.positions[row.positions.length - 2];
    nextX = last.x + (last.x - prev.x);
    nextY = last.y + (last.y - prev.y);
  } else if (row.positions.length === 1) {
    const last = row.positions[0];
    nextX = last.x + defaultSeatStep;
    nextY = last.y;
  }
  return addSeat(geometry, rowIndex, nextX, nextY);
}

/** Перенумерация ряда с сохранением ключей: идентичность места от подписи не зависит. */
/**
 * Перенумерация ряда по тем же правилам, что и построение структуры (CFG-04):
 * числовая с шагом, буквенная, произвольный список, разрыв нумерации и направление.
 * Места не двигаются — меняются только подписи.
 */
export function renumberRowWithRule(geometry: SeatingZoneGeometry, rowIndex: number,
  rule: StraightRowLabelOptions): SeatingZoneGeometry {
  const row = geometry.rows[rowIndex];
  if (!row || row.positions.length === 0) return geometry;
  const labels = createStructureLabels(rule, row.positions.length, 'Подписи мест');
  return {
    ...geometry,
    rows: geometry.rows.map((item, index) => index !== rowIndex ? item : {
      ...item,
      positions: item.positions.map((position, seat) => ({ ...position, label: labels[seat] })),
    }),
  };
}

export function renumberRow(geometry: SeatingZoneGeometry, rowIndex: number,
  start: number, step: number, reverse: boolean): SeatingZoneGeometry {
  const rows = geometry.rows.map((row, index) => {
    if (index !== rowIndex) return row;
    const count = row.positions.length;
    return {
      ...row,
      positions: row.positions.map((position, seat) => ({
        ...position,
        label: String(start + (reverse ? count - 1 - seat : seat) * step),
      })),
    };
  });
  return { ...geometry, rows };
}

export function setRowLabel(geometry: SeatingZoneGeometry, rowIndex: number, label: string): SeatingZoneGeometry {
  return { ...geometry, rows: geometry.rows.map((row, index) => index === rowIndex ? { ...row, label } : row) };
}

/** Общие свойства ряда: одно объявление вместо копии на каждом месте (ADR-052 §4). */
export function setRowProperties(geometry: SeatingZoneGeometry, rowIndex: number,
  properties: SeatingProperties | null): SeatingZoneGeometry {
  return {
    ...geometry,
    rows: geometry.rows.map((row, index) => index === rowIndex ? { ...row, properties } : row),
  };
}

/** Индивидуальное исключение выбранных мест; null возвращает их к наследованию от ряда. */
export function setSeatProperties(geometry: SeatingZoneGeometry, slots: readonly number[],
  properties: SeatingProperties | null): SeatingZoneGeometry {
  const selected = new Set(slots);
  return mapPositions(geometry, (position, seat) =>
    selected.has(seat.slot) ? { ...position, properties } : position);
}

export function rotateSeats(geometry: SeatingZoneGeometry, slots: readonly number[], rotation: number): SeatingZoneGeometry {
  const selected = new Set(slots);
  return mapPositions(geometry, (position, seat) => selected.has(seat.slot) ? { ...position, rotation } : position);
}

export function rotateSeatsBy(geometry: SeatingZoneGeometry, slots: readonly number[], delta: number): SeatingZoneGeometry {
  const selected = new Set(slots);
  return mapPositions(geometry, (position, seat) => selected.has(seat.slot)
    ? { ...position, rotation: (position.rotation + delta + 360_000) % 360_000 }
    : position);
}

export function selectedRotation(geometry: SeatingZoneGeometry, slots: readonly number[]): number | null {
  const rotations = flattenZone(geometry).filter((seat) => slots.includes(seat.slot))
    .map((seat) => seat.rotation);
  return rotations.length > 0 && rotations.every((rotation) => rotation === rotations[0]) ? rotations[0] : null;
}

export function nextRowLabel(geometry: SeatingZoneGeometry): string {
  const used = new Set(geometry.rows.map((row) => row.label));
  let next = 1;
  while (used.has(String(next))) next++;
  return String(next);
}

/** Кресла садятся по окружности вокруг стола: 1 метр от центра при столе 1,5 м. */
const defaultTablePositionRadius = 1_000;

function resizeTablePositions(table: SeatingTableGeometry, capacity: number): SeatingPositionGeometry[] {
  const result: SeatingPositionGeometry[] = [];
  const baseAngle = ((table.rotation / 1_000) * Math.PI) / 180;
  const existingLabels = new Set(table.positions.map((position) => position.label));
  let nextLabel = 1;

  for (let index = 0; index < capacity; index++) {
    const angle = baseAngle + (2 * Math.PI * index) / capacity;
    const x = Math.round(table.x + Math.cos(angle) * defaultTablePositionRadius);
    const y = Math.round(table.y + Math.sin(angle) * defaultTablePositionRadius);
    const rotation = table.rotation;

    if (index < table.positions.length) {
      result.push({
        ...table.positions[index],
        x,
        y,
        rotation,
      });
    } else {
      while (existingLabels.has(String(nextLabel))) nextLabel++;
      const label = String(nextLabel);
      existingLabels.add(label);
      result.push({
        id: null,
        label,
        x,
        y,
        rotation,
      });
    }
  }
  return result;
}


function transformTablePositions(
  previous: SeatingTableGeometry, next: SeatingTableGeometry,
): SeatingPositionGeometry[] {
  const delta = ((next.rotation - previous.rotation) / 1_000) * Math.PI / 180;
  const cosine = Math.cos(delta);
  const sine = Math.sin(delta);
  return previous.positions.map((position) => {
    const x = position.x - previous.x;
    const y = position.y - previous.y;
    return {
      ...position,
      x: Math.round(next.x + x * cosine - y * sine),
      y: Math.round(next.y + x * sine + y * cosine),
      rotation: (position.rotation + next.rotation - previous.rotation + 360_000) % 360_000,
    };
  });
}

export function addTable(geometry: SeatingZoneGeometry, x: number, y: number): SeatingZoneGeometry {
  const tables = geometry.tables ?? [];
  if (flattenZone(geometry).length + 4 > maxZonePositions)
    throw new Error('В зоне не может быть больше ' + maxZonePositions + ' мест.');
  const used = new Set(tables.map((table) => table.label));
  let label = 1; while (used.has(String(label))) label++;
  const table: SeatingTableGeometry = {
    id: null, label: String(label), x: Math.round(x), y: Math.round(y), rotation: 0,
    capacity: 4, saleMode: 'Whole', positions: [], minimumQuantity: null,
  };
  table.positions = resizeTablePositions(table, table.capacity);
  return growFrame({ ...geometry, kind: 'Tables', capacity: null, rows: [], tables: [...tables, table] });
}

export function updateTable(
  geometry: SeatingZoneGeometry, index: number, change: Partial<SeatingTableGeometry>,
): SeatingZoneGeometry {
  const tables = (geometry.tables ?? []).map((table, current) => {
    if (current !== index) return table;
    const capacity = change.capacity === undefined ? table.capacity : Math.max(1, Math.round(change.capacity));
    if (flattenZone(geometry).length - table.positions.length + capacity > maxZonePositions)
      throw new Error('В зоне не может быть больше ' + maxZonePositions + ' мест.');
    const target = { ...table, ...change, capacity };
    const transformed = change.positions ?? transformTablePositions(table, target);
    const next = { ...target, positions: transformed };
    next.positions = resizeTablePositions(next, capacity);
    if (next.saleMode === 'MinimumQuantity')
      next.minimumQuantity = Math.min(next.minimumQuantity ?? 1, capacity);
    else next.minimumQuantity = null;
    return next;
  });
  return growFrame({ ...geometry, tables });
}

const palette = ['#4275DB', '#2B9983', '#B77B36', '#9862C5', '#D05B76', '#3E8FB0'];

export function nextZoneColor(taken: readonly string[]): string {
  return palette.find((color) => !taken.includes(color)) ?? palette[taken.length % palette.length];
}

export function nextZoneCode(taken: readonly string[]): string {
  for (let index = 0; index < 26 * 26; index++) {
    const code = index < 26
      ? String.fromCharCode(65 + index)
      : String.fromCharCode(65 + Math.floor(index / 26) - 1) + String.fromCharCode(65 + (index % 26));
    if (!taken.includes(code)) return code;
  }
  return 'Z' + taken.length;
}

/** Новая зона по нарисованному прямоугольнику. Клиентский ключ живёт до первой записи. */
export function createZone(rect: Rect, taken: { codes: string[]; colors: string[] }): {
  zoneId: string; geometry: SeatingZoneGeometry;
} {
  const code = nextZoneCode(taken.codes);
  return {
    zoneId: newIdentity(),
    geometry: {
      code, name: 'Зона ' + code, color: nextZoneColor(taken.colors),
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)),
      kind: 'Numbered', capacity: null, rows: [],
    },
  };
}

/** Русское согласование числа с существительным: «1 ряд», «2 ряда», «5 рядов». */
export function plural(count: number, one: string, few: string, many: string): string {
  const tens = Math.abs(count) % 100;
  const units = tens % 10;
  if (tens > 10 && tens < 20) return count + ' ' + many;
  if (units > 1 && units < 5) return count + ' ' + few;
  if (units === 1) return count + ' ' + one;
  return count + ' ' + many;
}

export function zoneSummary(geometry: SeatingZoneGeometry): string {
  const kind = zoneKindOf(geometry);
  if (kind === 'Free') return 'без мест · вместимость ' + (geometry.capacity ?? 0);
  if (kind === 'Tables') {
    const tables = geometry.tables ?? [];
    return plural(tables.length, 'стол', 'стола', 'столов')
      + ' · ' + plural(tables.reduce((count, table) => count + table.positions.length, 0), 'место', 'места', 'мест');
  }
  const seats = flattenZone(geometry).length;
  if (!seats) return 'мест ещё нет';
  return plural(geometry.rows.length, 'ряд', 'ряда', 'рядов')
    + ' · ' + plural(seats, 'место', 'места', 'мест');
}

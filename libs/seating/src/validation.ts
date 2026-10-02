/**
 * Проверка схемы зала (артефакт 14 §11, CFG-17).
 *
 * Это не замена контрактному `validateZoneGeometry`: тот падает на первом нарушении
 * и проверяет одну зону, потому что сторожит форму запроса к серверу. Здесь строится
 * отчёт по всей схеме этажа — со всеми находками сразу, с уровнями и адресами, —
 * чтобы организатор видел список, а не одно сообщение об ошибке.
 *
 * Критические находки блокируют сохранение; предупреждения требуют подтверждения
 * и не исчезают после него.
 */

import { flattenZone, type SeatSlot } from './editor-model';
import { zoneCapacity, zoneKindOf, type SeatingZoneGeometry } from './model';
import { buildSpatialIndex, querySpatial } from './spatial-index';
import { SEATING_THEME } from './theme';
import { millimetresToUnits } from './units';

export type SeatingFindingLevel = 'critical' | 'warning';

/** Коды соответствуют строкам таблицы проверок артефакта 14 §11. */
export type SeatingFindingCode =
  | 'PositionAddressDuplicated'
  | 'ZonesOverlap'
  | 'SeatsOverlap'
  | 'RowsCross'
  | 'PositionOutsideZone'
  | 'TableWithoutCapacity'
  | 'NumberingGap'
  | 'EmptyZone';

export interface SeatingFinding {
  level: SeatingFindingLevel;
  code: SeatingFindingCode;
  /** Зона, к которой относится находка; у пересечения — первая из пары. */
  zoneId: string;
  /** Вторая зона пары для пересечения зон. */
  relatedZoneId?: string;
  /** Координаты первой пары пересекающихся мест в системе координат схемы. */
  firstPairCoordinates?: readonly [{ x: number; y: number }, { x: number; y: number }];
  message: string;
}

export interface InspectedZone {
  zoneId: string;
  geometry: SeatingZoneGeometry;
}

/** Проверки, которые контракт выразить не может, и потому их здесь нет. */
export const unimplementedChecks = [
  // Заявленной вместимости у конфигурации в контракте нет, сверять сумму зон не с чем.
  'Расхождение вместимости',
  // Подвижных элементов (CFG-11) и уровня идентификации импорта в контракте нет.
  'Подвижный элемент занят',
  'Неразрешённая идентификация',
] as const;

function framed(geometry: SeatingZoneGeometry): boolean {
  return geometry.width > 0 && geometry.height > 0;
}

function overlaps(left: SeatingZoneGeometry, right: SeatingZoneGeometry): boolean {
  return left.x < right.x + right.width
    && right.x < left.x + left.width
    && left.y < right.y + right.height
    && right.y < left.y + left.height;
}

interface IndexedSeat {
  zoneIndex: number;
  seat: SeatSlot;
}

function parentName(zone: InspectedZone, seat: SeatSlot): string {
  return `${seat.parent === 'row' ? 'Ряд' : 'Стол'} «${seat.parentLabel}» зоны «${zone.geometry.code}»`;
}

function parentKey(seat: IndexedSeat): string {
  return `${seat.zoneIndex}:${seat.seat.parent}:${seat.seat.parentIndex}`;
}

/** Знаки ориентированных площадей позволяют учитывать и касание, и наложение отрезков. */
function segmentsCross(
  a: { x: number; y: number }, b: { x: number; y: number },
  c: { x: number; y: number }, d: { x: number; y: number },
): boolean {
  const turn = (p: typeof a, q: typeof a, r: typeof a): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = turn(a, b, c);
  const abD = turn(a, b, d);
  const cdA = turn(c, d, a);
  const cdB = turn(c, d, b);
  return abC * abD <= 0 && cdA * cdB <= 0
    && Math.max(a.x, b.x) >= Math.min(c.x, d.x)
    && Math.max(c.x, d.x) >= Math.min(a.x, b.x)
    && Math.max(a.y, b.y) >= Math.min(c.y, d.y)
    && Math.max(c.y, d.y) >= Math.min(a.y, b.y);
}

function segmentInsideZone(
  a: { x: number; y: number }, b: { x: number; y: number }, zone: SeatingZoneGeometry,
): boolean {
  let first = 0;
  let last = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const boundaries = [
    [-dx, a.x - zone.x], [dx, zone.x + zone.width - a.x],
    [-dy, a.y - zone.y], [dy, zone.y + zone.height - a.y],
  ];
  for (const [p, q] of boundaries) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) first = Math.max(first, ratio);
    else last = Math.min(last, ratio);
    if (first > last) return false;
  }
  const middle = (first + last) / 2;
  const x = a.x + middle * dx;
  const y = a.y + middle * dy;
  return x >= zone.x && x <= zone.x + zone.width
    && y >= zone.y && y <= zone.y + zone.height;
}

function segmentsCrossInside(
  a: { x: number; y: number }, b: { x: number; y: number },
  c: { x: number; y: number }, d: { x: number; y: number }, zone: SeatingZoneGeometry,
): boolean {
  if (!segmentsCross(a, b, c, d)) return false;
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const cdX = d.x - c.x;
  const cdY = d.y - c.y;
  const determinant = abX * cdY - abY * cdX;
  if (determinant !== 0) {
    const fraction = ((c.x - a.x) * cdY - (c.y - a.y) * cdX) / determinant;
    const x = a.x + fraction * abX;
    const y = a.y + fraction * abY;
    return x >= zone.x && x <= zone.x + zone.width
      && y >= zone.y && y <= zone.y + zone.height;
  }
  const axis = Math.abs(abX) >= Math.abs(abY) ? 'x' : 'y';
  const ordered = [a, b, c, d].sort((left, right) => left[axis] - right[axis]);
  return segmentInsideZone(ordered[1], ordered[2], zone);
}

interface RowSegment {
  rowIndex: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function rowCrossings(zone: InspectedZone): SeatingFinding[] {
  const geometry = zone.geometry;
  if (!framed(geometry)) return [];
  const segments: RowSegment[] = [];
  geometry.rows.forEach((row, rowIndex) => {
    for (let position = 1; position < row.positions.length; position++) {
      const start = row.positions[position - 1];
      const end = row.positions[position];
      segments.push({
        rowIndex, start, end,
        minX: Math.min(start.x, end.x), maxX: Math.max(start.x, end.x),
        minY: Math.min(start.y, end.y), maxY: Math.max(start.y, end.y),
      });
    }
  });
  segments.sort((left, right) => left.minX - right.minX);
  const active: RowSegment[] = [];
  const reported = new Set<string>();
  const findings: SeatingFinding[] = [];
  for (const segment of segments) {
    // По оси X в активном наборе остаются только отрезки с возможным пересечением.
    for (let i = active.length - 1; i >= 0; i--)
      if (active[i].maxX < segment.minX) active.splice(i, 1);
    for (const candidate of active) {
      if (candidate.rowIndex === segment.rowIndex
        || candidate.maxY < segment.minY || segment.maxY < candidate.minY) continue;
      const first = Math.min(candidate.rowIndex, segment.rowIndex);
      const second = Math.max(candidate.rowIndex, segment.rowIndex);
      const key = `${first}:${second}`;
      if (reported.has(key) || !segmentsCrossInside(
        candidate.start, candidate.end, segment.start, segment.end, geometry,
      )) continue;
      reported.add(key);
      findings.push({
        level: 'critical', code: 'RowsCross', zoneId: zone.zoneId,
        message: `Ряд «${geometry.rows[first].label}» и ряд «${geometry.rows[second].label}» зоны «${geometry.code}» пересекаются.`,
      });
    }
    active.push(segment);
  }
  return findings;
}

function seatOverlaps(zones: readonly InspectedZone[], seats: readonly IndexedSeat[]): SeatingFinding[] {
  if (seats.length < 2) return [];
  const diameter = SEATING_THEME.geometry.seatDiameterMm;
  const diameterUnits = millimetresToUnits(diameter);
  const x = new Float32Array(seats.length);
  const y = new Float32Array(seats.length);
  seats.forEach(({ seat }, index) => {
    // В индекс кладём целые ячейки: Float32 не теряет миллиметры на дальних координатах.
    x[index] = Math.floor(millimetresToUnits(seat.x) / diameterUnits);
    y[index] = Math.floor(millimetresToUnits(seat.y) / diameterUnits);
  });
  const index = buildSpatialIndex(x, y, 1);
  const groups = new Map<string, { first: IndexedSeat; second: IndexedSeat; count: number }>();
  const diameterSquared = diameter * diameter;
  seats.forEach((first, firstIndex) => {
    // Ближе диаметра могут быть только места своей или одной из восьми соседних ячеек.
    for (const secondIndex of querySpatial(index, x[firstIndex] - 1, y[firstIndex] - 1,
      x[firstIndex] + 1, y[firstIndex] + 1)) {
      if (secondIndex <= firstIndex) continue;
      const second = seats[secondIndex];
      const firstFloor = zones[first.zoneIndex].geometry.floorId;
      const secondFloor = zones[second.zoneIndex].geometry.floorId;
      if (firstFloor && secondFloor && firstFloor !== secondFloor) continue;
      const dx = first.seat.x - second.seat.x;
      const dy = first.seat.y - second.seat.y;
      if (dx * dx + dy * dy >= diameterSquared) continue;
      const leftKey = parentKey(first);
      const rightKey = parentKey(second);
      const key = leftKey < rightKey ? `${leftKey}|${rightKey}` : `${rightKey}|${leftKey}`;
      const group = groups.get(key);
      if (group) group.count++;
      else groups.set(key, { first, second, count: 1 });
    }
  });
  return [...groups.values()].map(({ first, second, count }): SeatingFinding => {
    const firstZone = zones[first.zoneIndex];
    const secondZone = zones[second.zoneIndex];
    const firstName = parentName(firstZone, first.seat);
    const secondName = parentName(secondZone, second.seat);
    return {
      level: 'critical', code: 'SeatsOverlap', zoneId: firstZone.zoneId,
      ...(first.zoneIndex !== second.zoneIndex ? { relatedZoneId: secondZone.zoneId } : {}),
      firstPairCoordinates: [
        { x: first.seat.x, y: first.seat.y }, { x: second.seat.x, y: second.seat.y },
      ],
      message: `${firstName}${parentKey(first) === parentKey(second) ? '' : ` и ${secondName}`}: `
        + `${count} пересекающихся мест. Первая пара: (${first.seat.x}, ${first.seat.y}) и `
        + `(${second.seat.x}, ${second.seat.y}) в координатах схемы.`,
    };
  });
}

/**
 * Разрыв нумерации — пролом в шаге, а не сам по себе непоследовательный номер.
 * Ряд 1, 3, 5 нумерован нечётными и разрыва не имеет; ряд 1, 2, 4, 5 — имеет.
 * Ряды с нечисловыми подписями не проверяются: у них своего порядка нет.
 */
function numberingGap(labels: readonly string[]): boolean {
  if (labels.length < 3) return false;
  const numbers: number[] = [];
  for (const label of labels) {
    const value = Number(label);
    if (!Number.isInteger(value)) return false;
    numbers.push(value);
  }
  const sorted = [...numbers].sort((left, right) => left - right);
  const step = sorted[1] - sorted[0];
  if (step <= 0) return false;
  return sorted.some((value, index) => index > 0 && value - sorted[index - 1] !== step);
}

/**
 * Отчёт по зонам одного этажа. Зоны разных этажей не сравниваются между собой:
 * их прямоугольники живут в одной системе координат, но в разных плоскостях зала.
 */
export function inspectZones(zones: readonly InspectedZone[]): SeatingFinding[] {
  const findings: SeatingFinding[] = [];
  const indexedSeats: IndexedSeat[] = [];

  for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex++) {
    const zone = zones[zoneIndex];
    const geometry = zone.geometry;
    const kind = zoneKindOf(geometry);
    const name = `${geometry.code} · ${geometry.name}`;
    const seats = flattenZone(geometry);
    for (const seat of seats) indexedSeats.push({ zoneIndex, seat });

    // Дублирование адреса позиции: адрес — это подпись родителя и подпись места.
    const addresses = new Set<string>();
    const reported = new Set<string>();
    for (const seat of seats) {
      const address = `${seat.parentLabel}\u0000${seat.label}`;
      if (addresses.has(address)) {
        if (reported.has(address)) continue;
        reported.add(address);
        findings.push({
          level: 'critical',
          code: 'PositionAddressDuplicated',
          zoneId: zone.zoneId,
          message: `Зона «${name}»: адрес «${seat.parentLabel} · ${seat.label}» занят двумя местами.`,
        });
        continue;
      }
      addresses.add(address);
    }

    // Позиция вне зоны: рамка задаёт контур, за который место выходить не может.
    if (framed(geometry)) {
      const outside = seats.filter((seat) =>
        seat.x < geometry.x || seat.x > geometry.x + geometry.width
        || seat.y < geometry.y || seat.y > geometry.y + geometry.height);
      if (outside.length) {
        findings.push({
          level: 'critical',
          code: 'PositionOutsideZone',
          zoneId: zone.zoneId,
          message: outside.length === 1
            ? `Зона «${name}»: место «${outside[0].parentLabel} · ${outside[0].label}» вне контура зоны.`
            : `Зона «${name}»: ${outside.length} мест вне контура зоны.`,
        });
      }
    }

    // Стол без вместимости: продажа по местам требует их числа.
    for (const table of geometry.tables ?? []) {
      if (table.capacity >= 1 && table.positions.length >= 1) continue;
      findings.push({
        level: 'critical',
        code: 'TableWithoutCapacity',
        zoneId: zone.zoneId,
        message: `Зона «${name}»: у стола «${table.label}» не задано число мест.`,
      });
    }

    // Разрыв нумерации — предупреждение: пропуск допустим, но подтверждается явно.
    for (const row of geometry.rows) {
      if (!numberingGap(row.positions.map((position) => position.label))) continue;
      findings.push({
        level: 'warning',
        code: 'NumberingGap',
        zoneId: zone.zoneId,
        message: `Зона «${name}»: в ряду «${row.label}» нумерация идёт с пропуском.`,
      });
    }

    // Пустая зона — предупреждение: ни мест, ни лимита вместимости.
    const empty = kind === 'Free' ? zoneCapacity(geometry) < 1 : seats.length === 0;
    if (empty) {
      findings.push({
        level: 'warning',
        code: 'EmptyZone',
        zoneId: zone.zoneId,
        message: kind === 'Free'
          ? `Зона «${name}»: свободная зона без лимита вместимости.`
          : `Зона «${name}»: ни одного места.`,
      });
    }
    findings.push(...rowCrossings(zone));
  }

  findings.push(...seatOverlaps(zones, indexedSeats));

  // Sweep line удаляет рамки, не доходящие до следующей зоны по X.
  const sorted = zones.filter((zone) => framed(zone.geometry))
    .sort((left, right) => left.geometry.x - right.geometry.x);
  const active: InspectedZone[] = [];
  for (const zone of sorted) {
    for (let index = active.length - 1; index >= 0; index--)
      if (active[index].geometry.x + active[index].geometry.width <= zone.geometry.x)
        active.splice(index, 1);
    for (const candidate of active) {
      const firstFloor = candidate.geometry.floorId;
      const secondFloor = zone.geometry.floorId;
      if (firstFloor && secondFloor && firstFloor !== secondFloor) continue;
      if (!overlaps(candidate.geometry, zone.geometry)) continue;
      findings.push({
        level: 'critical',
        code: 'ZonesOverlap',
        zoneId: candidate.zoneId,
        relatedZoneId: zone.zoneId,
        message: `Зоны «${candidate.geometry.code}» и «${zone.geometry.code}» накладываются друг на друга.`,
      });
    }
    active.push(zone);
  }

  return findings;
}

/** Схему с критическими находками сохранять нельзя. */
export function hasCritical(findings: readonly SeatingFinding[]): boolean {
  return findings.some((finding) => finding.level === 'critical');
}

/** Устойчивая подпись набора предупреждений: подтверждение относится к конкретному набору. */
export function warningSignature(findings: readonly SeatingFinding[]): string {
  return findings
    .filter((finding) => finding.level === 'warning')
    .map((finding) => `${finding.code}:${finding.zoneId}:${finding.message}`)
    .sort()
    .join('|');
}

import {
  type SeatingRowGeometry,
  coordinateLimit,
  maxLabelLength,
  maxZonePositions,
} from './model'

/**
 * Правила нумерации (артефакт 14, CFG-04): числовая с произвольным шагом — отсюда же
 * чётные и нечётные, — буквенная и произвольный список подписей. Отдельно для рядов
 * и для позиций. `skippedLabels` даёт разрыв нумерации без потери порядка: подпись
 * пропускается, а последовательность мест не меняется. `reverse` задаёт направление.
 */
export type StraightRowLabelOptions =
  | {
      format: 'numeric'
      start?: number
      /** Шаг нумерации: 2 от нечётного начала даёт нечётные, от чётного — чётные. */
      step?: number
      skippedLabels?: readonly number[]
      reverse?: boolean
    }
  | {
      format: 'alphabetic'
      start?: string
      skippedLabels?: readonly string[]
      reverse?: boolean
    }
  | { format: 'custom'; labels: readonly string[]; reverse?: boolean }

/**
 * Нумерация позиций от центрального прохода (CFG-04, «чётные и нечётные»): место слева
 * от прохода получает 2, дальше 4, 6 к краю; место справа — 1, затем 3, 5 к краю.
 * Точка деления берётся из первого продольного прохода, иначе из середины ряда.
 */
export type PositionNumbering =
  | { kind: 'sequential' }
  | { kind: 'oddEven'; splitAfter?: number }

/**
 * Проход: пустое место в координатах, а не сохраняемый объект. Продольный проход
 * (`axis: 'position'`) раздвигает соседние места внутри каждого ряда, поперечный
 * (`axis: 'row'`) — соседние ряды (CFG-05).
 */
export interface StraightRowsGap {
  axis: 'position' | 'row'
  /** Одноосновный индекс позиции либо ряда, после которого вставлен разрыв. */
  after: number
  /** Дополнительное целое расстояние между соседями. */
  width: number
}

/** A geometric gap inserted after the same seat index in every generated row. */
export interface StraightRowsAisle {
  /** One-based position index before the gap. */
  afterPosition: number
  /** Additional integer distance between the two adjacent positions. */
  width: number
}

/** Parameters for a new, straight, numbered zone structure. */
export interface StraightRowsOptions {
  rowCount: number
  positionsPerRow: number
  originX: number
  originY: number
  rowSpacing: number
  positionSpacing: number
  rowLabels?: StraightRowLabelOptions
  positionLabels?: StraightRowLabelOptions
  /** Нумерация позиций: подряд либо от центрального прохода. */
  positionNumbering?: PositionNumbering
  /** Продольные и поперечные проходы; можно задать несколько. */
  gaps?: readonly StraightRowsGap[]
  /** Краткая запись одного продольного прохода; равнозначна `gaps` с `axis: 'position'`. */
  aisle?: StraightRowsAisle
}

/** Generated row geometry and a frame that contains every generated position. */
export interface GeneratedStraightRows {
  rows: SeatingRowGeometry[]
  x: number
  y: number
  width: number
  height: number
}

/**
 * Builds a new straight numbered structure. It leaves row/position IDs unset so the
 * backend can assign identities when the zone is first saved. The aisle is represented
 * only as extra coordinate space; it is not persisted as a semantic passage object.
 */
export function generateStraightRows(
  options: StraightRowsOptions,
): GeneratedStraightRows {
  validateOptions(options)
  const totalPositions = options.rowCount * options.positionsPerRow
  const rowLabels = createLabels(
    options.rowLabels ?? { format: 'numeric' },
    options.rowCount,
    'row',
  )
  const gaps = normalizeGaps(options)
  const positionGaps = gaps.filter((gap) => gap.axis === 'position')
  const rowGaps = gaps.filter((gap) => gap.axis === 'row')
  const positionLabels = createPositionLabels(options, positionGaps)
  const rows: SeatingRowGeometry[] = []
  let maxX = options.originX
  let maxY = options.originY

  for (let rowIndex = 0; rowIndex < options.rowCount; rowIndex++) {
    const y =
      options.originY +
      rowIndex * options.rowSpacing +
      offsetBefore(rowGaps, rowIndex)
    const positions = []
    for (
      let positionIndex = 0;
      positionIndex < options.positionsPerRow;
      positionIndex++
    ) {
      const x =
        options.originX +
        positionIndex * options.positionSpacing +
        offsetBefore(positionGaps, positionIndex)
      positions.push({
        label: positionLabels[positionIndex],
        x,
        y,
        rotation: 0,
      })
      maxX = Math.max(maxX, x)
    }
    rows.push({ label: rowLabels[rowIndex], positions })
    maxY = Math.max(maxY, y)
  }

  // A single row/position still needs a positive frame under the zone contract.
  const width = Math.max(1, maxX - options.originX)
  const height = Math.max(1, maxY - options.originY)
  assertCoordinate(width, 'width')
  assertCoordinate(height, 'height')
  // Keep this explicit so arithmetic changes cannot silently exceed the structure limit.
  if (totalPositions > maxZonePositions)
    throw new Error(`Не более ${maxZonePositions} мест в зоне.`)
  return { rows, x: options.originX, y: options.originY, width, height }
}

function validateOptions(options: StraightRowsOptions): void {
  assertPositiveInteger(options.rowCount, 'Число рядов')
  assertPositiveInteger(options.positionsPerRow, 'Число мест в ряду')
  if (options.rowCount * options.positionsPerRow > maxZonePositions)
    throw new Error(`Не более ${maxZonePositions} мест в зоне.`)
  assertCoordinate(options.originX, 'originX')
  assertCoordinate(options.originY, 'originY')
  assertPositiveInteger(options.rowSpacing, 'Шаг между рядами')
  assertPositiveInteger(options.positionSpacing, 'Шаг между местами')
  if (options.aisle) {
    assertPositiveInteger(options.aisle.afterPosition, 'Позиция прохода')
    assertPositiveInteger(options.aisle.width, 'Ширина прохода')
    if (options.aisle.afterPosition >= options.positionsPerRow)
      throw new Error('Проход должен находиться между местами ряда.')
  }
  validateLabelOptions(
    options.rowLabels ?? { format: 'numeric' },
    'Подписи рядов',
  )
  validateLabelOptions(
    options.positionLabels ?? { format: 'numeric' },
    'Подписи мест',
  )
  const gaps = normalizeGaps(options)
  for (const gap of gaps) {
    assertPositiveInteger(gap.after, 'Позиция прохода')
    assertPositiveInteger(gap.width, 'Ширина прохода')
    const limit = gap.axis === 'position' ? options.positionsPerRow : options.rowCount
    if (gap.after >= limit)
      throw new Error(
        gap.axis === 'position'
          ? 'Продольный проход должен находиться между местами ряда.'
          : 'Поперечный проход должен находиться между рядами.',
      )
  }
  for (const axis of ['position', 'row'] as const) {
    const points = gaps.filter((gap) => gap.axis === axis).map((gap) => gap.after)
    if (new Set(points).size !== points.length)
      throw new Error('Два прохода не могут стоять в одном и том же месте.')
  }
  if (options.positionNumbering?.kind === 'oddEven') {
    const split =
      options.positionNumbering.splitAfter ?? defaultSplit(options, gaps)
    assertPositiveInteger(split, 'Точка деления нумерации')
    if (split >= options.positionsPerRow)
      throw new Error('Точка деления нумерации должна находиться внутри ряда.')
    if (options.positionLabels && options.positionLabels.format !== 'numeric')
      throw new Error(
        'Нумерация от прохода задаётся только числовыми подписями мест.',
      )
  }

  // Check the furthest possible points before allocating potentially large arrays.
  const finalX =
    options.originX +
    (options.positionsPerRow - 1) * options.positionSpacing +
    totalWidth(gaps, 'position')
  const finalY =
    options.originY +
    (options.rowCount - 1) * options.rowSpacing +
    totalWidth(gaps, 'row')
  assertCoordinate(finalX, 'Координата X последнего места')
  assertCoordinate(finalY, 'Координата Y последнего ряда')
}

/** Краткая запись `aisle` и список `gaps` сводятся к одному представлению. */
function normalizeGaps(options: StraightRowsOptions): StraightRowsGap[] {
  const gaps = [...(options.gaps ?? [])]
  if (options.aisle)
    gaps.push({
      axis: 'position',
      after: options.aisle.afterPosition,
      width: options.aisle.width,
    })
  return gaps
}

/** Суммарная ширина проходов, стоящих перед элементом с этим индексом. */
function offsetBefore(gaps: readonly StraightRowsGap[], index: number): number {
  let offset = 0
  for (const gap of gaps) if (index >= gap.after) offset += gap.width
  return offset
}

function totalWidth(
  gaps: readonly StraightRowsGap[],
  axis: StraightRowsGap['axis'],
): number {
  let total = 0
  for (const gap of gaps) if (gap.axis === axis) total += gap.width
  return total
}

function defaultSplit(
  options: StraightRowsOptions,
  gaps: readonly StraightRowsGap[],
): number {
  const longitudinal = gaps
    .filter((gap) => gap.axis === 'position')
    .map((gap) => gap.after)
    .sort((left, right) => left - right)
  if (longitudinal.length > 0) return longitudinal[Math.floor((longitudinal.length - 1) / 2)]
  return Math.floor(options.positionsPerRow / 2)
}

/**
 * Подписи мест: подряд по общим правилам либо от центрального прохода, где левая
 * половина получает чётные номера, а правая — нечётные, обе от прохода к краю.
 */
function createPositionLabels(
  options: StraightRowsOptions,
  positionGaps: readonly StraightRowsGap[],
): string[] {
  const numbering = options.positionNumbering ?? { kind: 'sequential' }
  if (numbering.kind === 'sequential')
    return createLabels(
      options.positionLabels ?? { format: 'numeric' },
      options.positionsPerRow,
      'position',
      true,
    )

  const split = numbering.splitAfter ?? defaultSplit(options, positionGaps)
  const labels = new Array<string>(options.positionsPerRow)
  const skipped = new Set(
    ((options.positionLabels?.format === 'numeric'
      ? options.positionLabels.skippedLabels
      : undefined) ?? []
    ).map(String),
  )
  const next = (value: number) => {
    let candidate = value
    while (skipped.has(String(candidate))) candidate += 2
    return candidate
  }

  let even = next(2)
  for (let index = split - 1; index >= 0; index--) {
    labels[index] = String(even)
    even = next(even + 2)
  }
  let odd = next(1)
  for (let index = split; index < options.positionsPerRow; index++) {
    labels[index] = String(odd)
    odd = next(odd + 2)
  }
  if (new Set(labels).size !== labels.length)
    throw new Error('Подписи мест: подписи должны быть уникальными.')
  return labels
}

function validateLabelOptions(
  options: StraightRowLabelOptions,
  field: string,
): void {
  if (options.format === 'custom') {
    if (options.labels.length === 0)
      throw new Error(`${field}: список подписей пуст.`)
    for (const label of options.labels)
      if (label.trim().length === 0)
        throw new Error(`${field}: подпись не может быть пустой.`)
    return
  }
  if (options.format === 'numeric') {
    const start = options.start ?? 1
    assertPositiveInteger(start, `${field}: начальный номер`)
    assertPositiveInteger(options.step ?? 1, `${field}: шаг нумерации`)
    for (const label of options.skippedLabels ?? [])
      assertPositiveInteger(label, `${field}: пропуск`)
    return
  }
  const start = options.start ?? 'A'
  if (!isAlphabeticLabel(start))
    throw new Error(`${field}: начальная буква должна содержать только A–Z.`)
  for (const label of options.skippedLabels ?? []) {
    if (!isAlphabeticLabel(label))
      throw new Error(`${field}: пропуск должен содержать только A–Z.`)
  }
}

/**
 * Подписи по правилу CFG-04 отдельно от построения геометрии: тем же правилом
 * перенумеровывается уже существующий ряд, поэтому генератор и перенумерация
 * не могут разойтись в поведении.
 */
export function createStructureLabels(
  options: StraightRowLabelOptions,
  count: number,
  field = 'Подписи',
): string[] {
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error(`${field}: требуется хотя бы одна подпись.`);
  validateLabelOptions(options, field)
  return createLabels(options, count, field, true)
}

function createLabels(
  options: StraightRowLabelOptions,
  count: number,
  field: string,
  enforceUnique = false,
): string[] {
  const result =
    options.format === 'custom'
      ? takeCustomLabels(options.labels, count, field)
      : generateSequence(options, count, field)
  // Направление меняет только порядок выдачи готовых подписей: разрыв нумерации
  // при этом не теряет порядок мест, он лишь пропускает подпись.
  if (options.reverse) result.reverse()
  if (enforceUnique && new Set(result).size !== result.length)
    throw new Error(`${field}: подписи должны быть уникальными.`)
  if (result.some((label) => label.length > maxLabelLength))
    throw new Error(`${field}: подпись длиннее ${maxLabelLength} символов.`)
  return result
}

function takeCustomLabels(
  labels: readonly string[],
  count: number,
  field: string,
): string[] {
  if (labels.length < count)
    throw new Error(
      `${field}: задано ${labels.length} подписей, требуется ${count}.`,
    )
  return labels.slice(0, count).map((label) => label.trim())
}

function generateSequence(
  options: Exclude<StraightRowLabelOptions, { format: 'custom' }>,
  count: number,
  field: string,
): string[] {
  const skipped = new Set(
    (options.skippedLabels ?? []).map((label) => String(label).toUpperCase()),
  )
  const result: string[] = []
  const step = options.format === 'numeric' ? (options.step ?? 1) : 1
  let numeric = options.format === 'numeric' ? (options.start ?? 1) : 0
  let alphabetic =
    options.format === 'alphabetic' ? (options.start ?? 'A').toUpperCase() : ''
  let attempts = 0
  const maxAttempts = count + skipped.size
  while (result.length < count) {
    const label = options.format === 'numeric' ? String(numeric) : alphabetic
    if (!skipped.has(label.toUpperCase())) result.push(label)
    if (options.format === 'numeric') {
      numeric += step
      if (result.length < count && !Number.isSafeInteger(numeric))
        throw new Error(
          `${field}: числовая подпись выходит за допустимый диапазон.`,
        )
    } else alphabetic = incrementLabel(alphabetic)
    attempts++
    if (attempts > maxAttempts)
      throw new Error(`${field}: не удалось подобрать подписи.`)
  }
  return result
}

function isAlphabeticLabel(value: string): boolean {
  return /^[A-Za-z]+$/.test(value)
}

function incrementLabel(value: string): string {
  const letters = [...value].map((character) => character.charCodeAt(0) - 65)
  for (let index = letters.length - 1; index >= 0; index--) {
    if (letters[index] < 25) {
      letters[index]++
      return letters.map((letter) => String.fromCharCode(65 + letter)).join('')
    }
    letters[index] = 0
  }
  return (
    'A' + letters.map((letter) => String.fromCharCode(65 + letter)).join('')
  )
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${field}: положительное целое число.`)
}

function assertCoordinate(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || Math.abs(value) > coordinateLimit)
    throw new Error(`${field}: целое число в пределах ±${coordinateLimit}.`)
}

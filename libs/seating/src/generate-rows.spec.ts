import { describe, expect, it } from 'vitest'

import { generateStraightRows } from './generate-rows'
import { type SeatingZoneGeometry, validateZoneGeometry } from './model'

function options(
  overrides: Partial<Parameters<typeof generateStraightRows>[0]> = {},
) {
  return {
    rowCount: 2,
    positionsPerRow: 3,
    originX: 10_000,
    originY: 20_000,
    rowSpacing: 5_000,
    positionSpacing: 1_000,
    ...overrides,
  }
}

function asZone(
  result: ReturnType<typeof generateStraightRows>,
): SeatingZoneGeometry {
  return {
    code: 'NEW',
    name: 'New zone',
    color: '#4275DB',
    kind: 'Numbered',
    capacity: null,
    ...result,
  }
}

describe('generateStraightRows', () => {
  it('generates a straight grid with server-assigned identities omitted', () => {
    const result = generateStraightRows(options())

    expect(result).toMatchObject({
      x: 10_000,
      y: 20_000,
      width: 2_000,
      height: 5_000,
    })
    expect(result.rows.map((row) => row.label)).toEqual(['1', '2'])
    expect(
      result.rows[0].positions.map(({ label, x, y, rotation }) => ({
        label,
        x,
        y,
        rotation,
      })),
    ).toEqual([
      { label: '1', x: 10_000, y: 20_000, rotation: 0 },
      { label: '2', x: 11_000, y: 20_000, rotation: 0 },
      { label: '3', x: 12_000, y: 20_000, rotation: 0 },
    ])
    expect(
      result.rows.every(
        (row) =>
          row.id === undefined &&
          row.positions.every((position) => position.id === undefined),
      ),
    ).toBe(true)
    expect(() => validateZoneGeometry(asZone(result))).not.toThrow()
  })

  it('supports alphabetic labels including the transition from Z to AA', () => {
    const result = generateStraightRows(
      options({
        rowCount: 3,
        rowLabels: { format: 'alphabetic', start: 'Y' },
        positionLabels: { format: 'alphabetic', start: 'Y' },
      }),
    )

    expect(result.rows.map((row) => row.label)).toEqual(['Y', 'Z', 'AA'])
    expect(result.rows[0].positions.map((position) => position.label)).toEqual([
      'Y',
      'Z',
      'AA',
    ])
  })

  it('skips requested labels while keeping the requested number and order of positions', () => {
    const result = generateStraightRows(
      options({
        rowCount: 2,
        positionsPerRow: 4,
        rowLabels: { format: 'numeric', start: 1, skippedLabels: [2] },
        positionLabels: { format: 'numeric', start: 1, skippedLabels: [2, 4] },
      }),
    )

    expect(result.rows.map((row) => row.label)).toEqual(['1', '3'])
    expect(result.rows[0].positions.map((position) => position.label)).toEqual([
      '1',
      '3',
      '5',
      '6',
    ])
    expect(result.rows[0].positions.map((position) => position.x)).toEqual([
      10_000, 11_000, 12_000, 13_000,
    ])
  })

  it('represents an aisle as additional distance after its one-based position boundary', () => {
    const result = generateStraightRows(
      options({
        aisle: { afterPosition: 2, width: 7_500 },
      }),
    )

    expect(result.rows[0].positions.map((position) => position.x)).toEqual([
      10_000, 11_000, 19_500,
    ])
    expect(result.width).toBe(9_500)
    expect(() => validateZoneGeometry(asZone(result))).not.toThrow()
  })

  it('rejects invalid counts, spacing, labels, and aisle placement', () => {
    expect(() => generateStraightRows(options({ rowCount: 0 }))).toThrow(
      'Число рядов',
    )
    expect(() => generateStraightRows(options({ positionSpacing: 0 }))).toThrow(
      'Шаг между местами',
    )
    expect(() =>
      generateStraightRows(
        options({ aisle: { afterPosition: 3, width: 100 } }),
      ),
    ).toThrow('между местами')
    expect(() =>
      generateStraightRows(
        options({ rowLabels: { format: 'alphabetic', start: 'A1' } }),
      ),
    ).toThrow('только A–Z')
  })

  it('enforces the 54,000-position zone limit before allocating rows', () => {
    expect(() =>
      generateStraightRows(options({ rowCount: 1_001, positionsPerRow: 54 })),
    ).toThrow('Не более 54000 мест')
    expect(
      generateStraightRows(options({ rowCount: 1_000, positionsPerRow: 54 }))
        .rows,
    ).toHaveLength(1_000)
  })

  it('rejects generated coordinates or frame dimensions beyond the geometry contract', () => {
    expect(() =>
      generateStraightRows(
        options({ originX: 1_000_000_000, positionsPerRow: 2 }),
      ),
    ).toThrow('Координата X последнего места')
    expect(() =>
      generateStraightRows(
        options({ originY: 999_999_999, rowCount: 2, rowSpacing: 2 }),
      ),
    ).toThrow('Координата Y последнего ряда')
    expect(() =>
      generateStraightRows(
        options({
          originX: -900_000_000,
          positionsPerRow: 3,
          positionSpacing: 550_000_000,
        }),
      ),
    ).toThrow('width')
  })
})

describe('Numbering rules (CFG-04)', () => {
  it('numbers seats with an arbitrary step, which is how odd and even rows are expressed', () => {
    const odd = generateStraightRows(
      options({ positionLabels: { format: 'numeric', start: 1, step: 2 } }),
    )
    expect(odd.rows[0].positions.map((position) => position.label)).toEqual(['1', '3', '5'])

    const even = generateStraightRows(
      options({ positionLabels: { format: 'numeric', start: 2, step: 2 } }),
    )
    expect(even.rows[0].positions.map((position) => position.label)).toEqual(['2', '4', '6'])
  })

  it('reverses the direction without moving a single seat', () => {
    const forward = generateStraightRows(options())
    const backward = generateStraightRows(
      options({
        positionLabels: { format: 'numeric', reverse: true },
        rowLabels: { format: 'alphabetic', reverse: true },
      }),
    )

    expect(backward.rows.map((row) => row.label)).toEqual(['B', 'A'])
    expect(backward.rows[0].positions.map((position) => position.label)).toEqual(['3', '2', '1'])
    expect(backward.rows[0].positions.map((position) => position.x))
      .toEqual(forward.rows[0].positions.map((position) => position.x))
  })

  it('skips a label without losing the order of seats', () => {
    const result = generateStraightRows(
      options({
        rowCount: 3,
        positionsPerRow: 4,
        rowLabels: { format: 'alphabetic', skippedLabels: ['B'] },
        positionLabels: { format: 'numeric', skippedLabels: [3] },
      }),
    )

    expect(result.rows.map((row) => row.label)).toEqual(['A', 'C', 'D'])
    expect(result.rows[0].positions.map((position) => position.label))
      .toEqual(['1', '2', '4', '5'])
    // Пропуск подписи не сдвигает координаты: места стоят подряд.
    expect(result.rows[0].positions.map((position) => position.x))
      .toEqual([10_000, 11_000, 12_000, 13_000])
  })

  it('takes an arbitrary list of labels', () => {
    const result = generateStraightRows(
      options({ rowLabels: { format: 'custom', labels: ['Ложа', 'Бельэтаж'] } }),
    )
    expect(result.rows.map((row) => row.label)).toEqual(['Ложа', 'Бельэтаж'])
    expect(() =>
      generateStraightRows(options({ rowLabels: { format: 'custom', labels: ['A'] } })),
    ).toThrow('требуется 2')
  })

  it('numbers seats outward from the central aisle: even to the left, odd to the right', () => {
    const result = generateStraightRows(
      options({
        positionsPerRow: 8,
        gaps: [{ axis: 'position', after: 4, width: 2_000 }],
        positionNumbering: { kind: 'oddEven' },
      }),
    )

    expect(result.rows[0].positions.map((position) => position.label))
      .toEqual(['8', '6', '4', '2', '1', '3', '5', '7'])
    expect(() =>
      generateStraightRows(
        options({
          positionsPerRow: 4,
          positionNumbering: { kind: 'oddEven', splitAfter: 4 },
        }),
      ),
    ).toThrow('внутри ряда')
    expect(() =>
      generateStraightRows(
        options({
          positionNumbering: { kind: 'oddEven' },
          positionLabels: { format: 'alphabetic' },
        }),
      ),
    ).toThrow('числовыми подписями')
  })
})

describe('Aisles and gaps (CFG-05)', () => {
  it('inserts several longitudinal aisles and counts them in the frame', () => {
    const result = generateStraightRows(
      options({
        positionsPerRow: 6,
        gaps: [
          { axis: 'position', after: 2, width: 3_000 },
          { axis: 'position', after: 4, width: 3_000 },
        ],
      }),
    )

    expect(result.rows[0].positions.map((position) => position.x))
      .toEqual([10_000, 11_000, 15_000, 16_000, 20_000, 21_000])
    expect(result.width).toBe(11_000)
    expect(() => validateZoneGeometry(asZone(result))).not.toThrow()
  })

  it('inserts a transverse aisle between rows', () => {
    const result = generateStraightRows(
      options({ rowCount: 4, gaps: [{ axis: 'row', after: 2, width: 4_000 }] }),
    )

    expect(result.rows.map((row) => row.positions[0].y))
      .toEqual([20_000, 25_000, 34_000, 39_000])
    expect(result.height).toBe(19_000)
  })

  it('keeps the old single-aisle shorthand working and rejects impossible gaps', () => {
    const shorthand = generateStraightRows(
      options({ positionsPerRow: 4, aisle: { afterPosition: 2, width: 2_000 } }),
    )
    const explicit = generateStraightRows(
      options({ positionsPerRow: 4, gaps: [{ axis: 'position', after: 2, width: 2_000 }] }),
    )
    expect(shorthand.rows[0].positions.map((position) => position.x))
      .toEqual(explicit.rows[0].positions.map((position) => position.x))

    expect(() =>
      generateStraightRows(options({ gaps: [{ axis: 'row', after: 2, width: 1_000 }] })),
    ).toThrow('между рядами')
    expect(() =>
      generateStraightRows(
        options({
          positionsPerRow: 4,
          gaps: [
            { axis: 'position', after: 2, width: 1_000 },
            { axis: 'position', after: 2, width: 1_000 },
          ],
        }),
      ),
    ).toThrow('в одном и том же месте')
  })
})

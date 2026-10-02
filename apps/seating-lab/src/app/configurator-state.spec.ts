import { describe, expect, it, vi } from 'vitest'

import {
  moveHistory,
  pendingSaveFor,
  preserveConcurrentGeometry,
  rebaseConfirmedZone,
} from './configurator-state'

describe('Configurator save recovery', () => {
  it('reuses the idempotency key for an uncertain retry of the same body', () => {
    const pending = new Map()
    const createKey = vi
      .fn()
      .mockReturnValueOnce('key-1')
      .mockReturnValueOnce('key-2')
    expect(pendingSaveFor(pending, 'zone', 'body-a', createKey).key).toBe(
      'key-1',
    )
    expect(pendingSaveFor(pending, 'zone', 'body-a', createKey).key).toBe(
      'key-1',
    )
    expect(createKey).toHaveBeenCalledTimes(1)
  })

  it('uses a new key after the request body changes', () => {
    const pending = new Map()
    const createKey = vi
      .fn()
      .mockReturnValueOnce('key-1')
      .mockReturnValueOnce('key-2')
    pendingSaveFor(pending, 'zone', 'body-a', createKey)
    expect(pendingSaveFor(pending, 'zone', 'body-b', createKey).key).toBe(
      'key-2',
    )
  })

  it('preserves the expected version for a retry and a changed body with a new key', () => {
    const pending = new Map()
    const createKey = vi
      .fn()
      .mockReturnValueOnce('key-1')
      .mockReturnValueOnce('key-2')
    const first = pendingSaveFor(pending, 'zone', 'body-a', createKey, 7)

    expect(
      pendingSaveFor(pending, 'zone', 'body-a', createKey, 9).expectedVersion,
    ).toBe(7)

    const changed = pendingSaveFor(
      pending,
      'zone',
      'body-b',
      createKey,
      first.expectedVersion,
    )
    expect(changed.key).toBe('key-2')
    expect(changed.expectedVersion).toBe(7)
    expect(createKey).toHaveBeenCalledTimes(2)
  })

  it('never assigns identities by index after a concurrent structural edit', () => {
    const geometry = (labels: string[], ids: (string | undefined)[] = []) => ({
      code: 'A',
      name: 'Zone',
      color: '#4275DB',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rows: [
        {
          label: '1',
          positions: labels.map((seatLabel, index) => ({
            label: seatLabel,
            x: index + 1,
            y: 1,
            rotation: 0,
            id: ids[index],
          })),
        },
      ],
    })
    const local = geometry(['2'])
    const stored = geometry(['1', '2'], ['deleted-seat-id', 'kept-seat-id'])
    const preserved = preserveConcurrentGeometry(local)
    expect(preserved.rows[0].positions[0].id).toBeUndefined()
    expect(preserved.rows[0].positions[0].id).not.toBe(
      stored.rows[0].positions[0].id,
    )
  })
})

describe('Configurator history', () => {
  it('restores active zone and selection on undo and redo', () => {
    const before = { zones: ['a'], activeZoneId: 'a', selection: [3] }
    const after = { zones: ['a', 'b'], activeZoneId: 'b', selection: [1, 2] }
    const undone = moveHistory(
      { present: after, past: [before], future: [] },
      'undo',
    )
    expect(undone.present).toEqual(before)
    expect(moveHistory(undone, 'redo').present).toEqual(after)
  })

  it('never resurrects a confirmed zone as a new POST after another zone fails', () => {
    const zone = (zoneId: string, isNew: boolean, dirty = true) => ({
      zoneId,
      zoneVersion: isNew ? 0 : 1,
      isNew,
      dirty,
      structureDirty: dirty,
    })
    const snapshots = [
      {
        zones: [zone('temporary-a', true), zone('temporary-b', true)],
        activeZoneId: 'temporary-a',
        selection: [0],
      },
      {
        zones: [zone('temporary-a', true), zone('temporary-b', true)],
        activeZoneId: 'temporary-b',
        selection: [1],
      },
    ]
    const rebased = rebaseConfirmedZone(snapshots, 'temporary-a', 'server-a', 1)
    for (const snapshot of rebased) {
      expect(snapshot.zones[0]).toMatchObject({
        zoneId: 'server-a',
        zoneVersion: 1,
        isNew: false,
        dirty: true,
        structureDirty: true,
      })
      expect(snapshot.zones[1]).toMatchObject({
        zoneId: 'temporary-b',
        isNew: true,
        dirty: true,
      })
    }
    expect(rebased[0].activeZoneId).toBe('server-a')
    expect(rebased[1].activeZoneId).toBe('temporary-b')
    const restored = moveHistory(
      { present: rebased[1], past: [rebased[0]], future: [] },
      'undo',
    ).present
    expect(restored.zones[0].isNew).toBe(false)
    expect(restored.zones[0].zoneVersion).toBe(1)
    expect(restored.zones[1]).toMatchObject({
      zoneId: 'temporary-b',
      isNew: true,
      dirty: true,
    })
  })
})

import type { SeatingZoneGeometry } from '@tickets/seating'

export interface PendingSave {
  fingerprint: string
  key: string
  expectedVersion?: number
}

export function pendingSaveFor(
  pending: Map<string, PendingSave>,
  zoneId: string,
  fingerprint: string,
  createKey: () => string,
  expectedVersion?: number,
): PendingSave {
  const existing = pending.get(zoneId)
  if (existing?.fingerprint === fingerprint) return existing
  const created = { fingerprint, key: createKey(), expectedVersion }
  pending.set(zoneId, created)
  return created
}

/** A concurrent structural edit cannot safely adopt identities from a differently shaped response. */
export function preserveConcurrentGeometry(
  local: SeatingZoneGeometry,
): SeatingZoneGeometry {
  return local
}

export interface HistoryState<T> {
  present: T
  past: T[]
  future: T[]
}

export function moveHistory<T>(
  state: HistoryState<T>,
  direction: 'undo' | 'redo',
): HistoryState<T> {
  if (direction === 'undo') {
    const target = state.past[state.past.length - 1]
    return target === undefined
      ? state
      : {
          present: target,
          past: state.past.slice(0, -1),
          future: [state.present, ...state.future],
        }
  }
  const target = state.future[0]
  return target === undefined
    ? state
    : {
        present: target,
        past: [...state.past, state.present],
        future: state.future.slice(1),
      }
}

export interface IdentifiedDraft {
  zoneId: string
  zoneVersion: number
  isNew: boolean
  dirty: boolean
  structureDirty: boolean
}

export function rebaseConfirmedZone<
  T extends IdentifiedDraft,
  S extends { zones: T[]; activeZoneId?: string | null },
>(snapshots: readonly S[], temporaryId: string, serverId: string, serverVersion: number): S[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    activeZoneId:
      snapshot.activeZoneId === temporaryId ? serverId : snapshot.activeZoneId,
    zones: snapshot.zones.map((zone) =>
      zone.zoneId === temporaryId
        ? {
            ...zone,
            zoneId: serverId,
            zoneVersion: serverVersion,
            isNew: false,
            dirty: true,
            structureDirty: true,
          }
        : zone,
    ),
  })) as S[]
}

import type { SeatingZoneGeometry } from '@tickets/seating';
import { zoneKindOf } from '@tickets/seating';
import { rebaseConfirmedZone } from './configurator-state';

export interface WorkZone {
  zoneId: string;
  zoneVersion: number;
  geometry: SeatingZoneGeometry;
  dirty: boolean;
  /** Затронут состав зоны — ряды, места, рамка или вид: сохраняется полным PUT. */
  structureDirty: boolean;
  isNew: boolean;
}

export interface EditorSnapshot {
  zones: WorkZone[];
  activeZoneId: string | null;
  selection: number[];
}

export interface DocumentState {
  zones: WorkZone[] | null;
  activeZoneId: string | null;
  selection: number[];
  history: EditorSnapshot[];
  future: EditorSnapshot[];
}

export const initialDocumentState: DocumentState = {
  zones: null,
  activeZoneId: null,
  selection: [],
  history: [],
  future: [],
};

export function touchesComposition(before: SeatingZoneGeometry, after: SeatingZoneGeometry): boolean {
  return (
    before.rows !== after.rows ||
    before.tables !== after.tables ||
    before.floorId !== after.floorId ||
    zoneKindOf(before) !== zoneKindOf(after) ||
    before.x !== after.x ||
    before.y !== after.y ||
    before.width !== after.width ||
    before.height !== after.height
  );
}

export type DocumentAction =
  | { type: 'LOAD_ZONES'; zones: WorkZone[]; activeZoneId?: string | null }
  | { type: 'RESET' }
  | { type: 'SET_ACTIVE_ZONE'; zoneId: string | null }
  | { type: 'SET_SELECTION'; selection: number[] }
  | { type: 'EDIT_ACTIVE'; change: (geometry: SeatingZoneGeometry) => SeatingZoneGeometry }
  | { type: 'COMMIT_ZONES'; zones: WorkZone[]; nextActiveZoneId?: string }
  | { type: 'DELETE_ZONE'; zoneId: string }
  | { type: 'REBASE_ZONE'; temporaryId: string; serverId: string; serverVersion: number }
  | { type: 'MARK_SAVED'; zoneId: string; newVersion: number }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export function documentReducer(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case 'LOAD_ZONES': {
      const activeId = action.activeZoneId !== undefined
        ? action.activeZoneId
        : (action.zones[0]?.zoneId ?? null);
      return {
        zones: action.zones,
        activeZoneId: activeId,
        selection: [],
        history: [],
        future: [],
      };
    }

    case 'RESET': {
      return initialDocumentState;
    }

    case 'SET_ACTIVE_ZONE': {
      return {
        ...state,
        activeZoneId: action.zoneId,
        selection: [],
      };
    }

    case 'SET_SELECTION': {
      return {
        ...state,
        selection: action.selection,
      };
    }

    case 'EDIT_ACTIVE': {
      if (!state.zones || !state.activeZoneId) return state;
      const snapshot: EditorSnapshot = {
        zones: state.zones,
        activeZoneId: state.activeZoneId,
        selection: state.selection,
      };
      const nextZones = state.zones.map((zone) => {
        if (zone.zoneId !== state.activeZoneId) return zone;
        const geometry = action.change(zone.geometry);
        return {
          ...zone,
          geometry,
          dirty: true,
          structureDirty: zone.structureDirty || touchesComposition(zone.geometry, geometry),
        };
      });

      return {
        ...state,
        zones: nextZones,
        history: [...state.history.slice(-49), snapshot],
        future: [],
      };
    }

    case 'COMMIT_ZONES': {
      if (!state.zones) return state;
      const snapshot: EditorSnapshot = {
        zones: state.zones,
        activeZoneId: state.activeZoneId,
        selection: state.selection,
      };
      return {
        ...state,
        zones: action.zones,
        activeZoneId: action.nextActiveZoneId !== undefined ? action.nextActiveZoneId : state.activeZoneId,
        selection: [],
        history: [...state.history.slice(-49), snapshot],
        future: [],
      };
    }

    case 'DELETE_ZONE': {
      if (!state.zones) return state;
      const nextZones = state.zones.filter((z) => z.zoneId !== action.zoneId);
      const nextActive = state.activeZoneId === action.zoneId
        ? (nextZones[0]?.zoneId ?? null)
        : state.activeZoneId;
      return {
        ...state,
        zones: nextZones,
        activeZoneId: nextActive,
        selection: [],
      };
    }

    case 'REBASE_ZONE': {
      if (!state.zones) return state;
      const rebasedHistory = rebaseConfirmedZone(state.history, action.temporaryId, action.serverId, action.serverVersion);
      const rebasedFuture = rebaseConfirmedZone(state.future, action.temporaryId, action.serverId, action.serverVersion);
      const rebasedPresent = rebaseConfirmedZone(
        [{ zones: state.zones, activeZoneId: state.activeZoneId, selection: state.selection }],
        action.temporaryId,
        action.serverId,
        action.serverVersion,
      )[0];

      return {
        ...state,
        zones: rebasedPresent.zones,
        activeZoneId: rebasedPresent.activeZoneId ?? null,
        history: rebasedHistory,
        future: rebasedFuture,
      };
    }

    case 'MARK_SAVED': {
      if (!state.zones) return state;
      return {
        ...state,
        zones: state.zones.map((zone) =>
          zone.zoneId === action.zoneId
            ? { ...zone, zoneVersion: action.newVersion, dirty: false, structureDirty: false }
            : zone,
        ),
      };
    }

    case 'UNDO': {
      if (!state.history.length || !state.zones) return state;
      const previous = state.history[state.history.length - 1];
      const currentSnapshot: EditorSnapshot = {
        zones: state.zones,
        activeZoneId: state.activeZoneId,
        selection: state.selection,
      };
      return {
        ...state,
        zones: previous.zones,
        activeZoneId: previous.activeZoneId,
        selection: previous.selection,
        history: state.history.slice(0, -1),
        future: [currentSnapshot, ...state.future],
      };
    }

    case 'REDO': {
      if (!state.future.length || !state.zones) return state;
      const next = state.future[0];
      const currentSnapshot: EditorSnapshot = {
        zones: state.zones,
        activeZoneId: state.activeZoneId,
        selection: state.selection,
      };
      return {
        ...state,
        zones: next.zones,
        activeZoneId: next.activeZoneId,
        selection: next.selection,
        history: [...state.history, currentSnapshot],
        future: state.future.slice(1),
      };
    }

    default:
      return state;
  }
}

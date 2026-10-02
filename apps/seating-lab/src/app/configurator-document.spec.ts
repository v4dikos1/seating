import { describe, expect, it } from 'vitest';
import {
  documentReducer,
  initialDocumentState,
  touchesComposition,
  type WorkZone,
} from './configurator-document';
import type { SeatingZoneGeometry } from '@tickets/seating';

function makeZone(id: string, name = 'Zone'): WorkZone {
  const geometry: SeatingZoneGeometry = {
    code: id,
    name,
    color: '#346bcb',
    kind: 'Numbered',
    capacity: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rows: [],
  };
  return {
    zoneId: id,
    zoneVersion: 1,
    geometry,
    dirty: false,
    structureDirty: false,
    isNew: false,
  };
}

describe('configurator-document reducer', () => {
  it('loads zones and sets default active zone', () => {
    const z1 = makeZone('z1');
    const z2 = makeZone('z2');
    const state = documentReducer(initialDocumentState, {
      type: 'LOAD_ZONES',
      zones: [z1, z2],
    });

    expect(state.zones).toHaveLength(2);
    expect(state.activeZoneId).toBe('z1');
    expect(state.history).toHaveLength(0);
    expect(state.future).toHaveLength(0);
  });

  it('selects active zone and clears selection', () => {
    const z1 = makeZone('z1');
    const z2 = makeZone('z2');
    let state = documentReducer(initialDocumentState, {
      type: 'LOAD_ZONES',
      zones: [z1, z2],
    });
    state = documentReducer(state, { type: 'SET_SELECTION', selection: [1, 2] });
    expect(state.selection).toEqual([1, 2]);

    state = documentReducer(state, { type: 'SET_ACTIVE_ZONE', zoneId: 'z2' });
    expect(state.activeZoneId).toBe('z2');
    expect(state.selection).toEqual([]);
  });

  it('edits active zone, records snapshot in history and marks dirty', () => {
    const z1 = makeZone('z1', 'Original');
    let state = documentReducer(initialDocumentState, {
      type: 'LOAD_ZONES',
      zones: [z1],
    });

    state = documentReducer(state, {
      type: 'EDIT_ACTIVE',
      change: (geom) => ({ ...geom, name: 'Updated' }),
    });

    expect(state.zones?.[0].geometry.name).toBe('Updated');
    expect(state.zones?.[0].dirty).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].zones[0].geometry.name).toBe('Original');
  });

  it('supports undo and redo', () => {
    const z1 = makeZone('z1', 'Step 0');
    let state = documentReducer(initialDocumentState, {
      type: 'LOAD_ZONES',
      zones: [z1],
    });

    state = documentReducer(state, {
      type: 'EDIT_ACTIVE',
      change: (geom) => ({ ...geom, name: 'Step 1' }),
    });
    expect(state.zones?.[0].geometry.name).toBe('Step 1');

    // Undo
    state = documentReducer(state, { type: 'UNDO' });
    expect(state.zones?.[0].geometry.name).toBe('Step 0');
    expect(state.future).toHaveLength(1);

    // Redo
    state = documentReducer(state, { type: 'REDO' });
    expect(state.zones?.[0].geometry.name).toBe('Step 1');
    expect(state.future).toHaveLength(0);
  });

  it('marks zone as saved and clears dirty flags', () => {
    const z1 = makeZone('z1');
    let state = documentReducer(initialDocumentState, {
      type: 'LOAD_ZONES',
      zones: [z1],
    });
    state = documentReducer(state, {
      type: 'EDIT_ACTIVE',
      change: (geom) => ({ ...geom, name: 'Draft' }),
    });
    expect(state.zones?.[0].dirty).toBe(true);

    state = documentReducer(state, {
      type: 'MARK_SAVED',
      zoneId: 'z1',
      newVersion: 2,
    });
    expect(state.zones?.[0].dirty).toBe(false);
    expect(state.zones?.[0].structureDirty).toBe(false);
    expect(state.zones?.[0].zoneVersion).toBe(2);
  });

  it('uses the confirmed server version after saving a new zone', () => {
    const draft = { ...makeZone('zone-a'), zoneVersion: 0, isNew: true, dirty: true };
    let state = documentReducer(initialDocumentState, { type: 'LOAD_ZONES', zones: [draft] });
    state = documentReducer(state, {
      type: 'REBASE_ZONE', temporaryId: 'zone-a', serverId: 'zone-a', serverVersion: 1,
    });
    expect(state.zones?.[0]).toMatchObject({ zoneId: 'zone-a', zoneVersion: 1, isNew: false });
  });

  it('detects touchesComposition correctly', () => {
    const base: SeatingZoneGeometry = {
      code: 'A',
      name: 'Base',
      color: '#000',
      kind: 'Numbered',
      capacity: null,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rows: [],
    };

    // Name change does not touch composition
    expect(touchesComposition(base, { ...base, name: 'New Name' })).toBe(false);

    // Dimension or row changes touch composition
    expect(touchesComposition(base, { ...base, width: 20 })).toBe(true);
    expect(touchesComposition(base, { ...base, rows: [{ label: '1', positions: [] }] })).toBe(true);
  });
});

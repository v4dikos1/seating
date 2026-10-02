import {
  addRow, addSeat, addSeatToRow, alignSeats, createZone, defaultSeatStep, defaultZoneFrameHeight,
  defaultZoneFrameWidth, distributeSeats, documentBounds, fitFrame,
  fitCamera,
  flattenZone, framePadding, measureSeatPitch,
  moveSeats, moveZone, nearestSeat, addTable, nextRowLabel, plural, removeRow, removeSeats, removeTable,
  renumberRow, rotateSeatsBy, scaleZone, selectedRotation, selectInRect, setRowStep, setSeatPosition,
  renumberRowWithRule, setZoneFrame,
  resizeZoneFrame,
  snapPointToGrid, snapRowPlan, snapSelectionToGrid, snapToGrid, straightenRow, updateTable,
} from './editor-model';

import { validateZoneGeometry, type SeatingZoneGeometry } from './model';

function zone(): SeatingZoneGeometry {
  return {
    code: 'A', name: 'Партер', color: '#4275DB',
    x: 0, y: 0, width: 200_000, height: 200_000, kind: 'Numbered', capacity: null, rows: [],
  };
}

const straightRow = { from: { x: 20_000, y: 40_000 }, to: { x: 92_000, y: 40_000 }, count: 5, label: '1', firstSeat: 1 };

describe('Editor operations', () => {
  it('fits an empty scene and then real bounds with finite camera coordinates', () => {
    expect(fitCamera(documentBounds([]), 800, 600)).toEqual({ scale: 25, x: 60, y: 60 });
    const bounds = documentBounds([{ x: 0, y: 0, width: 200_000, height: 100_000 }]);
    expect(bounds).toEqual({ x: 0, y: 0, width: 200_000, height: 100_000 });
    expect(fitCamera(bounds, 800, 600))
      .toEqual({ scale: 3.6, x: 40, y: 120 });
    expect(fitCamera(documentBounds([{ x: NaN, y: 0, width: 200_000, height: 100_000 }]), 800, 600))
      .toEqual({ scale: 25, x: 60, y: 60 });
  });

  it('resizes all eight sides and corners without moving seats', () => {
    const source = addRow(zone(), straightRow);
    const seats = flattenZone(source).map((seat) => ({ x: seat.x, y: seat.y }));
    const cases = [
      ['nw', -5_000, -6_000, -5_000, -6_000, 205_000, 206_000],
      ['n', 0, -6_000, 0, -6_000, 200_000, 206_000],
      ['ne', 205_000, -6_000, 0, -6_000, 205_000, 206_000],
      ['e', 205_000, 0, 0, 0, 205_000, 200_000],
      ['se', 205_000, 206_000, 0, 0, 205_000, 206_000],
      ['s', 0, 206_000, 0, 0, 200_000, 206_000],
      ['sw', -5_000, 206_000, -5_000, 0, 205_000, 206_000],
      ['w', -5_000, 0, -5_000, 0, 205_000, 200_000],
    ] as const;
    for (const [handle, x, y, expectedX, expectedY, width, height] of cases) {
      const resized = resizeZoneFrame(source, handle, x, y);
      expect([resized.x, resized.y, resized.width, resized.height]).toEqual([expectedX, expectedY, width, height]);
      expect(flattenZone(resized).map((seat) => ({ x: seat.x, y: seat.y }))).toEqual(seats);
      expect(() => validateZoneGeometry(resized)).not.toThrow();
    }
  });

  it('keeps a minimum frame and all existing seats inside', () => {
    const source = addRow(zone(), straightRow);
    const resized = resizeZoneFrame(source, 'se', -100, -100);
    expect(resized.width).toBe(92_000);
    expect(resized.height).toBe(40_000);
    expect(() => validateZoneGeometry(resized)).not.toThrow();
    const empty = resizeZoneFrame(zone(), 'se', 0, 0);
    expect([empty.width, empty.height]).toEqual([500, 500]);
  });
  it('spreads a row evenly along the drawn segment', () => {
    const result = addRow(zone(), straightRow);
    const seats = flattenZone(result);
    expect(seats.map((seat) => seat.x)).toEqual([20_000, 38_000, 56_000, 74_000, 92_000]);
    expect(seats.map((seat) => seat.label)).toEqual(['1', '2', '3', '4', '5']);
    expect(seats.every((seat) => seat.id === null)).toBe(true);
    expect(() => validateZoneGeometry(result)).not.toThrow();
  });

  it('keeps a single-seat row on the starting point instead of dividing by zero', () => {
    const result = addRow(zone(), { ...straightRow, count: 1 });
    expect(flattenZone(result).map((seat) => [seat.x, seat.y])).toEqual([[20_000, 40_000]]);
  });

  it('moves only the selected seats and grows the frame to keep the zone valid', () => {
    const source = addRow({ ...zone(), width: 100_000, height: 100_000 }, straightRow);
    const moved = moveSeats(source, [0, 1], -40_000, -30_000);
    const seats = flattenZone(moved);
    expect([seats[0].x, seats[0].y]).toEqual([-20_000, 10_000]);
    expect([seats[2].x, seats[2].y]).toEqual([56_000, 40_000]);
    expect(moved.x).toBeLessThanOrEqual(-20_000);
    expect(() => validateZoneGeometry(moved)).not.toThrow();
  });

  it('selects by rectangle and by proximity', () => {
    const source = addRow(zone(), straightRow);
    expect(selectInRect(source, { x: 30_000, y: 30_000, width: 30_000, height: 20_000 })).toEqual([1, 2]);
    expect(nearestSeat(source, 57_000, 41_000, 5_000)).toBe(2);
    expect(nearestSeat(source, 57_000, 41_000, 500)).toBeNull();
  });

  it('drops a row that lost its last seat', () => {
    const source = addRow(zone(), { ...straightRow, count: 2 });
    expect(removeSeats(source, [0]).rows).toHaveLength(1);
    expect(removeSeats(source, [0, 1]).rows).toHaveLength(0);
  });

  it('renumbers a row without touching seat identity', () => {
    const source = addRow(zone(), straightRow);
    const withKeys: SeatingZoneGeometry = {
      ...source,
      rows: source.rows.map((row) => ({
        ...row,
        positions: row.positions.map((position, index) => ({ ...position, id: '00000000-0000-7000-8000-00000000000' + index })),
      })),
    };
    const renumbered = renumberRow(withKeys, 0, 10, 2, true);
    expect(flattenZone(renumbered).map((seat) => seat.label)).toEqual(['18', '16', '14', '12', '10']);
    expect(flattenZone(renumbered).map((seat) => seat.id)).toEqual(flattenZone(withKeys).map((seat) => seat.id));
  });

  it('adds a seat with a free label inside the chosen row', () => {
    const source = addRow(zone(), { ...straightRow, count: 2 });
    const result = addSeat(source, 0, 120_000, 40_000);
    expect(flattenZone(result).map((seat) => seat.label)).toEqual(['1', '2', '3']);
  });

  it('increments selected rotations and reports mixed values', () => {
    const source = addRow(zone(), { ...straightRow, count: 2 });
    const once = rotateSeatsBy(source, [0], 90_000);
    const twice = rotateSeatsBy(once, [0], 90_000);
    expect(selectedRotation(twice, [0])).toBe(180_000);
    expect(selectedRotation(twice, [0, 1])).toBeNull();
  });

  it('uses the first free numeric row label', () => {
    const source = { ...zone(), rows: [
      addRow(zone(), { ...straightRow, label: '1' }).rows[0],
      addRow(zone(), { ...straightRow, label: '3' }).rows[0],
    ] };
    expect(nextRowLabel(source)).toBe('2');
  });

  it('creates and edits a table without rows', () => {
    const created = addTable(zone(), 30_000, 40_000);
    expect(created.kind).toBe('Tables');
    expect(created.rows).toEqual([]);
    const edited = updateTable(created, 0, { rotation: 90_000, saleMode: 'Individual', capacity: 6 });
    expect(edited.tables?.[0]).toMatchObject({ rotation: 90_000, saleMode: 'Individual', capacity: 6 });
    expect(() => validateZoneGeometry(edited)).not.toThrow();
  });

  it('removes row and table cleanly', () => {
    const withRow = addRow(zone(), straightRow);
    expect(removeRow(withRow, 0).rows).toHaveLength(0);
    const withTable = addTable(zone(), 30_000, 40_000);
    expect(removeTable(withTable, 0).tables).toHaveLength(0);
  });

  it('adds a seat to an existing row extending its direction', () => {
    const withRow = addRow(zone(), straightRow);
    const extended = addSeatToRow(withRow, 0);
    expect(extended.rows[0].positions).toHaveLength(6);
    expect(extended.rows[0].positions[5].x).toBe(110_000);
  });

  it('moves table center together with its seats', () => {
    const created = addTable(zone(), 50_000, 60_000);
    const slots = flattenZone(created).map((s) => s.slot);
    const moved = moveSeats(created, slots, 10_000, 20_000);
    expect(moved.tables?.[0].x).toBe(60_000);
    expect(moved.tables?.[0].y).toBe(80_000);
  });

  it('names a new zone by the first free code and colour', () => {
    const first = createZone({ x: 0, y: 0, width: 10_000, height: 10_000 }, { codes: [], colors: [] });
    expect(first.geometry.code).toBe('A');
    const second = createZone({ x: 0, y: 0, width: 10_000, height: 10_000 },
      { codes: ['A'], colors: [first.geometry.color] });
    expect(second.geometry.code).toBe('B');
    expect(second.geometry.color).not.toBe(first.geometry.color);
    expect(second.zoneId).not.toBe(first.zoneId);
  });

  it('fits the frame around the seats that remain', () => {
    const source = addRow(zone(), straightRow);
    const fitted = fitFrame(source);
    // Отступ в метр добавляется с обеих сторон: слева от первого места и справа от последнего.
    expect(fitted.x).toBe(straightRow.from.x - framePadding);
    expect(fitted.width).toBe(straightRow.to.x - straightRow.from.x + framePadding * 2);
    expect(() => validateZoneGeometry(fitted)).not.toThrow();
  });

  it('gives a frameless zone a reasonable frame centred on a chosen point', () => {
    const frameless: SeatingZoneGeometry = { ...zone(), kind: 'Free', capacity: 100, width: 0, height: 0 };
    const framed = setZoneFrame(frameless, { x: 100_000, y: 50_000 });
    expect(framed.width).toBe(defaultZoneFrameWidth);
    expect(framed.height).toBe(defaultZoneFrameHeight);
    expect(framed.x).toBe(100_000 - defaultZoneFrameWidth / 2);
    expect(framed.y).toBe(50_000 - defaultZoneFrameHeight / 2);
    // Места и вместимость не трогает: у зоны без рамки их и не может быть.
    expect(framed.rows).toEqual(frameless.rows);
    expect(framed.capacity).toBe(frameless.capacity);
    expect(() => validateZoneGeometry(framed)).not.toThrow();
  });

  it('lets setZoneFrame pick a custom size too', () => {
    const framed = setZoneFrame(zone(), { x: 0, y: 0 }, 4_000, 2_000);
    expect(framed).toMatchObject({ x: -2_000, y: -1_000, width: 4_000, height: 2_000 });
  });
});

describe('Snapping and alignment operations', () => {
  it('snaps numbers and points to the grid step', () => {
    expect(snapToGrid(17_900, 18_000)).toBe(18_000);
    expect(snapToGrid(1_000, 18_000)).toBe(0);
    expect(snapPointToGrid({ x: 19_000, y: 35_000 }, 18_000)).toEqual({ x: 18_000, y: 36_000 });
  });

  it('snaps row plan with axis locking (Shift)', () => {
    // Почти горизонтальный отрезок с небольшим уклоном
    const rawFrom = { x: 10_000, y: 20_000 };
    const rawTo = { x: 64_000, y: 23_000 };
    const plan = snapRowPlan(rawFrom, rawTo, { lockAxis: true });
    expect(plan.angleDeg).toBe(0);
    expect(plan.to.y).toBe(rawFrom.y);
    // 54 метра отрезка при шаге в полметра дают 109 мест.
    const steps = Math.round((rawTo.x - rawFrom.x) / defaultSeatStep);
    expect(plan.count).toBe(steps + 1);
    expect(plan.to.x).toBe(rawFrom.x + steps * defaultSeatStep);
  });

  it('snaps row plan with 15-degree angle snap', () => {
    const rawFrom = { x: 0, y: 0 };
    // Угол ~14 градусов -> притягивается к 15 градусам
    const dist = defaultSeatStep * 2;
    const rawTo = { x: Math.round(dist * Math.cos(14 * Math.PI / 180)), y: Math.round(dist * Math.sin(14 * Math.PI / 180)) };
    const plan = snapRowPlan(rawFrom, rawTo, { snapAngle: true });
    expect(plan.angleDeg).toBe(15);
    expect(plan.count).toBe(3);
  });

  it('aligns selected seats horizontally and vertically', () => {
    // Ряд с кривыми координатами
    const crooked: SeatingZoneGeometry = {
      ...zone(),
      rows: [{
        id: null, label: '1', positions: [
          { id: null, label: '1', x: 10_000, y: 21_000, rotation: 0 },
          { id: null, label: '2', x: 28_000, y: 19_000, rotation: 0 },
          { id: null, label: '3', x: 46_000, y: 20_000, rotation: 0 },
        ],
      }],
    };
    const alignedH = alignSeats(crooked, [0, 1, 2], 'horizontal');
    const seatsH = flattenZone(alignedH);
    expect(seatsH.map((s) => s.y)).toEqual([20_000, 20_000, 20_000]);

    const alignedV = alignSeats(crooked, [0, 1, 2], 'vertical');
    const seatsV = flattenZone(alignedV);
    expect(seatsV.map((s) => s.x)).toEqual([28_000, 28_000, 28_000]);
  });

  it('distributes selected seats evenly between endpoints', () => {
    const uneven: SeatingZoneGeometry = {
      ...zone(),
      rows: [{
        id: null, label: '1', positions: [
          { id: null, label: '1', x: 0, y: 0, rotation: 0 },
          { id: null, label: '2', x: 10_000, y: 0, rotation: 0 },
          { id: null, label: '3', x: 60_000, y: 0, rotation: 0 },
        ],
      }],
    };
    const distributed = distributeSeats(uneven, [0, 1, 2]);
    const seats = flattenZone(distributed);
    expect(seats.map((s) => s.x)).toEqual([0, 30_000, 60_000]);
  });

  it('straightens an entire row between its first and last seat', () => {
    const crookedRow: SeatingZoneGeometry = {
      ...zone(),
      rows: [{
        id: null, label: '1', positions: [
          { id: null, label: '1', x: 10_000, y: 10_000, rotation: 0 },
          { id: null, label: '2', x: 30_000, y: 15_000, rotation: 0 },
          { id: null, label: '3', x: 50_000, y: 10_000, rotation: 0 },
        ],
      }],
    };
    const straightened = straightenRow(crookedRow, 0);
    const seats = flattenZone(straightened);
    expect(seats.map((s) => s.y)).toEqual([10_000, 10_000, 10_000]);
    expect(seats.map((s) => s.x)).toEqual([10_000, 30_000, 50_000]);
  });

  it('sets exact row step along row angle', () => {
    const baseRow: SeatingZoneGeometry = {
      ...zone(),
      rows: [{
        id: null, label: '1', positions: [
          { id: null, label: '1', x: 10_000, y: 10_000, rotation: 0 },
          { id: null, label: '2', x: 20_000, y: 10_000, rotation: 0 },
          { id: null, label: '3', x: 30_000, y: 10_000, rotation: 0 },
        ],
      }],
    };
    const stepped = setRowStep(baseRow, 0, 18_000);
    const seats = flattenZone(stepped);
    expect(seats.map((s) => s.x)).toEqual([10_000, 28_000, 46_000]);
  });

  it('snaps selected seats to grid', () => {
    const offGrid: SeatingZoneGeometry = {
      ...zone(),
      rows: [{
        id: null, label: '1', positions: [
          { id: null, label: '1', x: 17_500, y: 19_100, rotation: 0 },
          { id: null, label: '2', x: 35_800, y: 18_200, rotation: 0 },
        ],
      }],
    };
    const snapped = snapSelectionToGrid(offGrid, [0, 1], 18_000);
    const seats = flattenZone(snapped);
    expect(seats.map((s) => [s.x, s.y])).toEqual([
      [18_000, 18_000],
      [36_000, 18_000],
    ]);
  });

  it('redistributes seats evenly without overlap when table capacity changes', () => {
    const tableZone = addTable(zone(), 50_000, 50_000);
    expect(tableZone.tables?.[0].positions.length).toBe(4);

    const updated = updateTable(tableZone, 0, { capacity: 8 });
    const positions = updated.tables?.[0].positions ?? [];
    expect(positions.length).toBe(8);

    // Verify all positions have unique coordinates and no two seats overlap
    const coordSet = new Set(positions.map((p) => `${p.x},${p.y}`));
    expect(coordSet.size).toBe(8);
  });

  it('moves entire zone with rows and tables synchronously', () => {
    let z = addRow(zone(), straightRow);
    z = { ...z, kind: 'Tables', tables: [{ id: null, label: '1', x: 10_000, y: 10_000, rotation: 0, capacity: 1, saleMode: 'Whole', positions: [{ id: null, label: '1', x: 10_000, y: 10_000, rotation: 0 }], minimumQuantity: null }] };

    const moved = moveZone(z, 5_000, 10_000);
    expect(moved.x).toBe(5_000);
    expect(moved.y).toBe(10_000);
    expect(moved.rows[0].positions[0].x).toBe(25_000);
    expect(moved.rows[0].positions[0].y).toBe(50_000);
    expect(moved.tables?.[0].x).toBe(15_000);
    expect(moved.tables?.[0].y).toBe(20_000);
    expect(moved.tables?.[0].positions[0].x).toBe(15_000);
    expect(moved.tables?.[0].positions[0].y).toBe(20_000);
  });

  it('sets exact seat position by slot', () => {
    const z = addRow(zone(), straightRow);
    const updated = setSeatPosition(z, 0, 15_000, 25_000);
    const seats = flattenZone(updated);
    expect(seats[0].x).toBe(15_000);
    expect(seats[0].y).toBe(25_000);
    expect(seats[1].x).toBe(38_000); // other seats unchanged
  });
});


describe('Russian plural agreement', () => {
  it('agrees the noun with the number', () => {
    expect(plural(1, 'ряд', 'ряда', 'рядов')).toBe('1 ряд');
    expect(plural(2, 'ряд', 'ряда', 'рядов')).toBe('2 ряда');
    expect(plural(5, 'ряд', 'ряда', 'рядов')).toBe('5 рядов');
    expect(plural(11, 'ряд', 'ряда', 'рядов')).toBe('11 рядов');
    expect(plural(21, 'ряд', 'ряда', 'рядов')).toBe('21 ряд');
    expect(plural(112, 'место', 'места', 'мест')).toBe('112 мест');
  });
});

describe('Zone scale', () => {
  it('measures the real seat pitch of a zone and reports nothing for a lonely seat', () => {
    // Ряд построен с шагом 18 000 мм — восемнадцать метров между креслами.
    expect(measureSeatPitch(addRow(zone(), straightRow))).toBe(18_000);
    expect(measureSeatPitch(zone())).toBeNull();
  });

  it('scales a zone about its own corner, keeping rows, seats and tables together', () => {
    const source = addTable(addRow(zone(), straightRow), 60_000, 40_000);
    const before = flattenZone(source);
    const scaled = scaleZone(source, 0.5);

    expect(scaled.x).toBe(source.x);
    expect(scaled.y).toBe(source.y);
    expect(scaled.width).toBe(Math.round(source.width * 0.5));
    expect(scaled.height).toBe(Math.round(source.height * 0.5));

    const after = flattenZone(scaled);
    expect(after).toHaveLength(before.length);
    for (let index = 0; index < before.length; index++) {
      expect(after[index].x).toBe(Math.round(source.x + (before[index].x - source.x) * 0.5));
      expect(after[index].y).toBe(Math.round(source.y + (before[index].y - source.y) * 0.5));
    }
    expect(scaled.tables?.[0].x).toBe(Math.round(source.x + (60_000 - source.x) * 0.5));
    expect(() => validateZoneGeometry(scaled)).not.toThrow();
  });

  it('brings a zone drawn in foreign units to the real seat pitch', () => {
    const source = addRow(zone(), straightRow);
    const pitch = measureSeatPitch(source);
    if (pitch === null) throw new Error('шаг не измерен');
    const brought = scaleZone(source, defaultSeatStep / pitch);
    expect(measureSeatPitch(brought)).toBe(defaultSeatStep);
  });

  it('refuses a non-positive factor and returns the same object for factor one', () => {
    const source = addRow(zone(), straightRow);
    expect(scaleZone(source, 1)).toBe(source);
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => scaleZone(source, factor)).toThrow();
  });
});

describe('Row renumbering rules (CFG-04)', () => {
  it('renumbers an existing row by the same rules as the structure generator', () => {
    const source = addRow(zone(), straightRow);
    const before = flattenZone(source).map((seat) => [seat.x, seat.y]);

    const letters = renumberRowWithRule(source, 0, { format: 'alphabetic', start: 'A' });
    expect(letters.rows[0].positions.map((position) => position.label))
      .toEqual(['A', 'B', 'C', 'D', 'E']);

    const odd = renumberRowWithRule(source, 0, { format: 'numeric', start: 1, step: 2 });
    expect(odd.rows[0].positions.map((position) => position.label))
      .toEqual(['1', '3', '5', '7', '9']);

    const reversed = renumberRowWithRule(source, 0, { format: 'numeric', reverse: true });
    expect(reversed.rows[0].positions.map((position) => position.label))
      .toEqual(['5', '4', '3', '2', '1']);

    const skipping = renumberRowWithRule(source, 0, { format: 'numeric', skippedLabels: [3] });
    expect(skipping.rows[0].positions.map((position) => position.label))
      .toEqual(['1', '2', '4', '5', '6']);

    const custom = renumberRowWithRule(source, 0,
      { format: 'custom', labels: ['I', 'II', 'III', 'IV', 'V'] });
    expect(custom.rows[0].positions.map((position) => position.label))
      .toEqual(['I', 'II', 'III', 'IV', 'V']);

    // Ни одно правило не двигает места: меняются только подписи.
    for (const result of [letters, odd, reversed, skipping, custom])
      expect(flattenZone(result).map((seat) => [seat.x, seat.y])).toEqual(before);
  });

  it('leaves an empty or missing row alone and rejects an impossible rule', () => {
    const source = addRow(zone(), straightRow);
    expect(renumberRowWithRule(source, 5, { format: 'numeric' })).toBe(source);
    expect(() => renumberRowWithRule(source, 0, { format: 'custom', labels: ['A'] }))
      .toThrow('требуется 5');
  });
});

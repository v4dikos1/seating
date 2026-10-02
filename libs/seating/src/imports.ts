import { decodeScene } from './codec';
import { newIdentity } from './generate';
import {
  geometryFormatVersion, maxZonePositions, validateScene,
  type SeatingRowGeometry, type SeatingScene, type SeatingZoneGeometry,
} from './model';
import { SEATING_THEME } from './theme';

/** Колонки соответствуют полям тела запроса зоны; координаты абсолютные. */
export const csvHeader = 'zone_code,zone_name,row_label,seat_label,x,y,rotation';
const maxInputLength = 32 * 1024 * 1024;
const framePadding = SEATING_THEME.geometry.framePaddingMm;

/** Строгие кавычки в стиле RFC, включая запятые и переводы строк внутри подписей. */
export function parseCsv(text: string): string[][] {
  if (text.length > maxInputLength) throw new Error('Импорт превышает 32 МиБ.');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  const input = text.replace(/^\uFEFF/, '');
  function finishField() {
    row.push(field);
    field = '';
    closed = false;
  }
  function finishRow() {
    finishField();
    if (row.some((value) => value.length)) rows.push(row);
    row = [];
    if (rows.length > maxZonePositions + 1) throw new Error('Слишком много строк CSV.');
  }
  for (let i = 0; i < input.length; i++) {
    const character = input[i];
    if (quoted) {
      if (character !== '"') field += character;
      else if (input[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (character === ',') finishField();
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[i + 1] === '\n') i++;
      finishRow();
    } else if (character === '"' && !field && !closed) quoted = true;
    else {
      if (closed || character === '"') throw new Error('Нарушены кавычки CSV.');
      field += character;
    }
    if (field.length > 1_000) throw new Error('Поле CSV слишком длинное.');
    if (row.length > 7) throw new Error('Слишком много колонок CSV.');
  }
  if (quoted) throw new Error('Незакрытая кавычка CSV.');
  if (field || row.length || closed) finishRow();
  return rows;
}

interface Draft {
  geometry: SeatingZoneGeometry;
  rows: Map<string, SeatingRowGeometry>;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function integer(value: string, line: number, field: string): number {
  if (!/^-?\d+$/.test(value)) throw new Error('Строка CSV ' + line + ': ' + field + ' — целое число.');
  return Number(value);
}

/**
 * Ключи рядов и мест не задаются: импортируемый файл описывает новую идентичность,
 * которую выдаст сервер. Серверного импорта и его происхождения пока нет.
 */
export function importCsvZones(text: string): SeatingZoneGeometry[] {
  const rows = parseCsv(text);
  const header = rows.shift()?.join(',');
  if (header !== csvHeader && header !== csvHeader.replace(',rotation', ''))
    throw new Error('Ожидается заголовок CSV: ' + csvHeader);
  const drafts = new Map<string, Draft>();
  const palette = ['#4275DB', '#2B9983', '#B77B36', '#9862C5', '#D05B76'];
  for (let i = 0; i < rows.length; i++) {
    const values = rows[i];
    const line = i + 2;
    if (values.length !== 6 && values.length !== 7)
      throw new Error('Строка CSV ' + line + ': ожидается шесть или семь полей.');
    const [code, name, rowLabel, seatLabel, rawX, rawY, rawRotation] = values;
    const x = integer(rawX, line, 'x');
    const y = integer(rawY, line, 'y');
    const rotation = values.length === 7 ? integer(rawRotation, line, 'rotation') : 0;
    let draft = drafts.get(code);
    if (!draft) {
      draft = {
        geometry: {
          code, name, color: palette[drafts.size % palette.length],
          x: 0, y: 0, width: 0, height: 0, kind: 'Numbered', capacity: null, rows: [],
        },
        rows: new Map(), minX: x, minY: y, maxX: x, maxY: y,
      };
      drafts.set(code, draft);
    }
    if (draft.geometry.name !== name) throw new Error('Строка CSV ' + line + ': противоречивые названия зоны.');
    let row = draft.rows.get(rowLabel);
    if (!row) {
      row = { id: null, label: rowLabel, positions: [] };
      draft.rows.set(rowLabel, row);
      draft.geometry.rows.push(row);
    }
    row.positions.push({ id: null, label: seatLabel, x, y, rotation });
    draft.minX = Math.min(draft.minX, x);
    draft.minY = Math.min(draft.minY, y);
    draft.maxX = Math.max(draft.maxX, x);
    draft.maxY = Math.max(draft.maxY, y);
  }
  if (!drafts.size) throw new Error('CSV не содержит мест.');
  return [...drafts.values()].map((draft) => ({
    ...draft.geometry,
    x: draft.minX - framePadding,
    y: draft.minY - framePadding,
    width: draft.maxX - draft.minX + framePadding * 2,
    height: draft.maxY - draft.minY + framePadding * 2,
  }));
}

/** JSON принимается в формате состава редакции, CSV — в табличном контракте выше. */
export function importScene(text: string, format: 'json' | 'csv', configurationId: string): SeatingScene {
  if (text.length > maxInputLength) throw new Error('Импорт превышает 32 МиБ.');
  if (format === 'json') return decodeScene(new TextEncoder().encode(text), 'json');
  const scene: SeatingScene = {
    formatVersion: geometryFormatVersion,
    configurationId,
    revision: 1,
    zones: importCsvZones(text).map((geometry) => ({ zoneId: newIdentity(), zoneVersion: 1, geometry })),
  };
  validateScene(scene);
  return scene;
}

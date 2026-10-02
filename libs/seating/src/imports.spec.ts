import { csvHeader, importCsvZones, importScene, parseCsv } from './imports';
import { generateScene } from './generate';
import { canonicalScene } from './codec';
import { validateZoneGeometry } from './model';

describe('Structured import', () => {
  it('groups rows by label and fits the frame around absolute coordinates', () => {
    const zones = importCsvZones(
      `${csvHeader}\r\nA,"Сектор, А",Ա,01,30000,60000,0\r\nA,"Сектор, А",Ա,02,48000,60000,0\r\n`);
    expect(zones).toHaveLength(1);
    expect(zones[0].name).toBe('Сектор, А');
    expect(zones[0].rows).toHaveLength(1);
    expect(zones[0].rows[0].label).toBe('Ա');
    expect(zones[0].rows[0].positions.map((position) => position.label)).toEqual(['01', '02']);
    // Ключи не придумываются клиентом: их выдаст сервер при записи зоны.
    expect(zones[0].rows[0].positions.every((position) => position.id === null)).toBe(true);
    // Рамка охватывает места с отступом в метр с каждой стороны.
    expect(zones[0].x).toBe(29_000);
    expect(zones[0].width).toBe(20_000);
    expect(() => validateZoneGeometry(zones[0])).not.toThrow();
  });

  it('accepts the header without rotation and rejects broken files', () => {
    const short = importCsvZones(`${csvHeader.replace(',rotation', '')}\nA,Zone,1,1,0,0\n`);
    expect(short[0].rows[0].positions[0].rotation).toBe(0);
    for (const value of ['"missing', 'a"b,c', '"a"b,c']) expect(() => parseCsv(value)).toThrow();
    expect(() => importCsvZones(`${csvHeader}\nA,Zone,1,1,0,0,0\nA,Other,1,2,0,0,0`))
      .toThrow('противоречивые названия');
    expect(() => importCsvZones(`${csvHeader}\nA,Zone,1,1,NaN,0,0`)).toThrow('целое число');
    expect(() => importCsvZones(`${csvHeader}\n`)).toThrow('не содержит мест');
  });

  it('does not execute spreadsheet formulas and retains multiline labels as data', () => {
    expect(parseCsv('a,"b\nc","say ""yes""",=1+1\n')).toEqual([['a', 'b\nc', 'say "yes"', '=1+1']]);
  });

  it('imports JSON in the same shape the codec produces', () => {
    const scene = canonicalScene(generateScene(12));
    expect(importScene(JSON.stringify(scene), 'json', 'unused')).toEqual(scene);
    expect(() => importScene('{"formatVersion":1}', 'json', 'draft')).toThrow('версия формата');
  });
});

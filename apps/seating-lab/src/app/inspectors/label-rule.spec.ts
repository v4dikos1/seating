import { describe, expect, it } from 'vitest';
import { createStructureLabels } from '@tickets/seating';

import { emptyLabelRule, hasSkippedLabels, splitList, toLabelOptions } from './label-rule';

describe('Правило нумерации из формы', () => {
  it('разбирает список подписей по запятой, точке с запятой и переводу строки', () => {
    expect(splitList(' 13, 14 ;15\n16 ,, ')).toEqual(['13', '14', '15', '16']);
    expect(splitList('   ')).toEqual([]);
  });

  it('переводит числовое правило вместе с шагом и пропусками', () => {
    const rule = { ...emptyLabelRule(), numericStart: 2, numericStep: 2, skipped: '6, 8' };
    expect(toLabelOptions(rule)).toEqual({
      format: 'numeric', start: 2, step: 2, skippedLabels: [6, 8], reverse: false,
    });
    expect(createStructureLabels(toLabelOptions(rule), 4)).toEqual(['2', '4', '10', '12']);
  });

  it('приводит буквенное правило к верхнему регистру и подставляет A по умолчанию', () => {
    const rule = { ...emptyLabelRule(), format: 'alphabetic' as const, alphabeticStart: ' c ', skipped: 'd' };
    expect(toLabelOptions(rule)).toEqual({
      format: 'alphabetic', start: 'C', skippedLabels: ['D'], reverse: false,
    });
    expect(createStructureLabels(toLabelOptions(rule), 3)).toEqual(['C', 'E', 'F']);
    expect(toLabelOptions({ ...rule, alphabeticStart: '' })).toMatchObject({ start: 'A' });
  });

  it('переводит произвольный список и не считает его разрывом нумерации', () => {
    const rule = { ...emptyLabelRule(), format: 'custom' as const, customLabels: 'Ложа, Бельэтаж', skipped: '13' };
    expect(toLabelOptions(rule)).toEqual({
      format: 'custom', labels: ['Ложа', 'Бельэтаж'], reverse: false,
    });
    expect(hasSkippedLabels(rule)).toBe(false);
  });

  it('отмечает разрыв нумерации, который интерфейс просит подтвердить', () => {
    expect(hasSkippedLabels(emptyLabelRule())).toBe(false);
    expect(hasSkippedLabels({ ...emptyLabelRule(), skipped: '13' })).toBe(true);
  });

  it('отбрасывает пропуски, которые не являются положительными числами', () => {
    const rule = { ...emptyLabelRule(), skipped: '13, abc, -2, 0' };
    expect(toLabelOptions(rule)).toMatchObject({ skippedLabels: [13] });
  });
});

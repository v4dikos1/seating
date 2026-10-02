import { useState } from 'react';
import { flattenZone, type SeatingZoneGeometry, type StraightRowLabelOptions } from '@tickets/seating';
import { Button, Note } from '../ui';
import { LabelRuleFields, emptyLabelRule, hasSkippedLabels, toLabelOptions, type LabelRule } from './label-rule';

/**
 * Перенумерация мест выбранного ряда по тем же правилам, что и построение структуры
 * (артефакт 14, CFG-04): числовая с шагом — отсюда чётные и нечётные, — буквенная,
 * произвольный список, направление и разрыв нумерации. Разрыв допустим, но требует
 * подтверждения, поэтому кнопка ждёт отметки.
 */
export function RowNumbering({
  positionCount,
  onApply,
}: {
  positionCount: number;
  onApply: (rule: StraightRowLabelOptions) => void;
}) {
  const [rule, setRule] = useState<LabelRule>(emptyLabelRule);
  const [confirmed, setConfirmed] = useState(false);
  const skips = hasSkippedLabels(rule);

  return (
    <div className='numbering-box'>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
        Перенумерация мест ряда
      </div>
      <p className='inspector-note' style={{ margin: 0 }}>
        Места не двигаются — меняются только подписи. Мест в ряду: {positionCount}.
      </p>

      <LabelRuleFields title='Правило подписей' rule={rule} onChange={setRule} />

      {skips ? (
        <label className='check'>
          <input
            type='checkbox'
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>Подтверждаю разрыв нумерации</span>
        </label>
      ) : null}

      {rule.format === 'custom' ? (
        <Note tone='info'>
          Для ряда нужно {positionCount} подписей; лишние в конце списка не используются.
        </Note>
      ) : null}

      <Button
        full
        kind='secondary'
        disabled={skips && !confirmed}
        onClick={() => onApply(toLabelOptions(rule))}
      >
        Применить нумерацию
      </Button>
    </div>
  );
}

export function rowOfSelection(geometry: SeatingZoneGeometry, selection: readonly number[]): number {
  const seats = flattenZone(geometry);
  const first = selection.length ? seats[selection[0]] : undefined;
  return first?.parent === 'row' ? first.parentIndex : geometry.rows.length - 1;
}

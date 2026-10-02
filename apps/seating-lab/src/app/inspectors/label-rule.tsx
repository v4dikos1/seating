import type { StraightRowLabelOptions } from '@tickets/seating';

import { Numeric, Select, Text } from '../ui';

/**
 * Правила нумерации (артефакт 14, CFG-04) в виде, пригодном для формы: числовая
 * с произвольным шагом — отсюда чётные и нечётные, — буквенная и произвольный список.
 * Одни и те же поля используют генератор структуры и перенумерация готового ряда,
 * поэтому два экрана не могут разойтись в правилах.
 */

export type LabelFormat = 'numeric' | 'alphabetic' | 'custom';

export interface LabelRule {
  format: LabelFormat;
  numericStart: number;
  numericStep: number;
  alphabeticStart: string;
  customLabels: string;
  skipped: string;
  reverse: boolean;
}

export function emptyLabelRule(): LabelRule {
  return {
    format: 'numeric',
    numericStart: 1,
    numericStep: 1,
    alphabeticStart: 'A',
    customLabels: '',
    skipped: '',
    reverse: false,
  };
}

export function splitList(value: string): string[] {
  return value.split(/[,;\n]/).map((item) => item.trim()).filter((item) => item.length > 0);
}

/** Правило формы переводится в параметры библиотеки без догадок о значениях. */
export function toLabelOptions(rule: LabelRule): StraightRowLabelOptions {
  const skipped = splitList(rule.skipped);
  if (rule.format === 'custom')
    return { format: 'custom', labels: splitList(rule.customLabels), reverse: rule.reverse };
  if (rule.format === 'alphabetic')
    return {
      format: 'alphabetic',
      start: rule.alphabeticStart.trim().toUpperCase() || 'A',
      skippedLabels: skipped.map((item) => item.toUpperCase()),
      reverse: rule.reverse,
    };
  return {
    format: 'numeric',
    start: Math.max(1, Math.round(rule.numericStart)),
    step: Math.max(1, Math.round(rule.numericStep)),
    skippedLabels: skipped.map(Number).filter((item) => Number.isSafeInteger(item) && item > 0),
    reverse: rule.reverse,
  };
}

/** Разрыв нумерации допустим, но по артефакту 14 §12 требует подтверждения. */
export function hasSkippedLabels(rule: LabelRule): boolean {
  return rule.format !== 'custom' && splitList(rule.skipped).length > 0;
}

export function LabelRuleFields({
  title,
  rule,
  onChange,
  allowCustom = true,
}: {
  title: string;
  rule: LabelRule;
  onChange: (next: LabelRule) => void;
  allowCustom?: boolean;
}) {
  const patch = (change: Partial<LabelRule>) => onChange({ ...rule, ...change });
  return (
    <div className='numbering-box'>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
      <Select
        label='Правило'
        value={rule.format}
        options={[
          { value: 'numeric' as const, title: 'Числовая' },
          { value: 'alphabetic' as const, title: 'Буквенная (A, B, C…)' },
          ...(allowCustom ? [{ value: 'custom' as const, title: 'Произвольный список' }] : []),
        ]}
        onChange={(format) => patch({ format })}
      />

      {rule.format === 'numeric' ? (
        <>
          <div className='pair'>
            <Numeric
              label='С номера'
              value={rule.numericStart}
              min={1}
              onChange={(numericStart) => patch({ numericStart })}
            />
            <Numeric
              label='Шаг'
              value={rule.numericStep}
              min={1}
              hint={rule.numericStep === 2
                ? (rule.numericStart % 2 === 0 ? 'чётные' : 'нечётные')
                : undefined}
              onChange={(numericStep) => patch({ numericStep })}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {[
              { title: 'Подряд', start: 1, step: 1 },
              { title: 'Нечётные', start: 1, step: 2 },
              { title: 'Чётные', start: 2, step: 2 },
            ].map((preset) => (
              <button
                key={preset.title}
                type='button'
                className='btn btn-studio'
                onClick={() => patch({ numericStart: preset.start, numericStep: preset.step })}
              >
                {preset.title}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {rule.format === 'alphabetic' ? (
        <Text
          label='С буквы'
          value={rule.alphabeticStart}
          maxLength={3}
          onChange={(alphabeticStart) => patch({ alphabeticStart })}
        />
      ) : null}

      {rule.format === 'custom' ? (
        <Text
          label='Подписи через запятую'
          value={rule.customLabels}
          placeholder='Ложа, Бельэтаж, Балкон'
          maxLength={2_000}
          hint={`Задано подписей: ${splitList(rule.customLabels).length}`}
          onChange={(customLabels) => patch({ customLabels })}
        />
      ) : (
        <Text
          label='Пропустить подписи'
          value={rule.skipped}
          placeholder={rule.format === 'numeric' ? '13' : 'З, Й'}
          maxLength={200}
          hint='Разрыв нумерации: подпись пропускается, порядок мест сохраняется'
          onChange={(skipped) => patch({ skipped })}
        />
      )}

      <label className='check'>
        <input
          type='checkbox'
          checked={rule.reverse}
          onChange={(event) => patch({ reverse: event.target.checked })}
        />
        <span>В обратном порядке</span>
      </label>
    </div>
  );
}

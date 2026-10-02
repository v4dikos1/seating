import { useMemo, useState } from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import {
  defaultRowStep, defaultSeatStep, formatLength, generateStraightRows, plural,
  type GeneratedStraightRows, type SeatingZoneGeometry, type StraightRowsGap,
} from '@tickets/seating';

import { Button, Note, Numeric, Select, Text } from '../ui';
import {
  LabelRuleFields, emptyLabelRule, hasSkippedLabels, splitList, toLabelOptions,
  type LabelRule,
} from './label-rule';

/**
 * Генератор структуры зоны (артефакт 14: CFG-03 «Генератор структуры»,
 * CFG-04 «Правила нумерации», CFG-05 «Проходы и разрывы»).
 *
 * Ручного размещения мест по координатам здесь нет намеренно: структура строится
 * по параметрам. Разрыв нумерации допустим, но по §12 требует подтверждения —
 * поэтому кнопка генерации ждёт явной отметки, когда подписи пропускаются.
 */

type PositionMode = 'sequential' | 'oddEven';

export function StructureGenerator({
  zone,
  onApply,
}: {
  zone: SeatingZoneGeometry;
  onApply: (generated: GeneratedStraightRows) => void;
}) {
  const [rowCount, setRowCount] = useState(8);
  const [positionsPerRow, setPositionsPerRow] = useState(16);
  const [rowSpacing, setRowSpacing] = useState(defaultRowStep);
  const [positionSpacing, setPositionSpacing] = useState(defaultSeatStep);
  const [rowRule, setRowRule] = useState<LabelRule>(emptyLabelRule);
  const [positionRule, setPositionRule] = useState<LabelRule>(emptyLabelRule);
  const [positionMode, setPositionMode] = useState<PositionMode>('sequential');
  const [gaps, setGaps] = useState<StraightRowsGap[]>([]);
  const [skipConfirmed, setSkipConfirmed] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);

  const skipsNumbering = hasSkippedLabels(rowRule) || hasSkippedLabels(positionRule);
  // Зона уже что-то содержит (ряды или столы) — генератор заменит это целиком,
  // поэтому требуем явного подтверждения, а не полагаемся на то, что статичный
  // текст под шапкой кто-то прочитал.
  const hasExistingComposition = zone.rows.length > 0 || (zone.tables?.length ?? 0) > 0;
  const existingSeatCount = zone.rows.reduce((total, row) => total + row.positions.length, 0)
    + (zone.tables?.reduce((total, table) => total + table.capacity, 0) ?? 0);

  // Предпросмотр считается тем же кодом, что и результат: расхождению взяться неоткуда.
  const preview = useMemo<
    { ok: true; value: GeneratedStraightRows } | { ok: false; message: string }
  >(() => {
    try {
      return {
        ok: true,
        value: generateStraightRows({
          rowCount: Math.max(1, Math.round(rowCount)),
          positionsPerRow: Math.max(1, Math.round(positionsPerRow)),
          originX: zone.x,
          originY: zone.y,
          rowSpacing: Math.max(1, Math.round(rowSpacing)),
          positionSpacing: Math.max(1, Math.round(positionSpacing)),
          rowLabels: toLabelOptions(rowRule),
          positionLabels: positionMode === 'oddEven'
            ? { format: 'numeric', skippedLabels: splitList(positionRule.skipped).map(Number) }
            : toLabelOptions(positionRule),
          positionNumbering: positionMode === 'oddEven' ? { kind: 'oddEven' } : undefined,
          gaps,
        }),
      };
    } catch (reason) {
      return { ok: false, message: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [rowCount, positionsPerRow, rowSpacing, positionSpacing, rowRule, positionRule,
    positionMode, gaps, zone.x, zone.y]);

  const blocked = !preview.ok || (skipsNumbering && !skipConfirmed)
    || (hasExistingComposition && !replaceConfirmed);

  return (
    <div className='inspector-panel'>
      <div className='inspector-panel-head'>
        <h3><Wand2 size={15} color='var(--primary)' /> Структура зоны</h3>
      </div>
      <p className='inspector-note'>
        Ряды и места строятся по параметрам и заменяют текущий состав зоны целиком.
        Отменяется через Ctrl+Z.
      </p>
      {hasExistingComposition ? (
        <Note tone='warn'>
          В зоне уже есть {plural(existingSeatCount, 'место', 'места', 'мест')}
          {' '}({zone.rows.length ? `${zone.rows.length} ряд(ов)` : ''}
          {zone.rows.length && zone.tables?.length ? ', ' : ''}
          {zone.tables?.length ? `${zone.tables.length} стол(ов)` : ''}) — генератор заменит их новой
          структурой целиком, старый состав будет потерян (кроме отмены через Ctrl+Z).
        </Note>
      ) : null}

      <div className='pair'>
        <Numeric label='Рядов' value={rowCount} min={1} max={1_000} onChange={setRowCount} />
        <Numeric label='Мест в ряду' value={positionsPerRow} min={1} max={500} onChange={setPositionsPerRow} />
      </div>
      <div className='pair'>
        <Numeric
          label='Шаг рядов, мм'
          value={rowSpacing}
          min={100}
          step={50}
          hint={formatLength(rowSpacing)}
          onChange={setRowSpacing}
        />
        <Numeric
          label='Шаг мест, мм'
          value={positionSpacing}
          min={100}
          step={50}
          hint={formatLength(positionSpacing)}
          onChange={setPositionSpacing}
        />
      </div>

      <LabelRuleFields title='Подписи рядов' rule={rowRule} onChange={setRowRule} />

      <Select
        label='Нумерация мест'
        value={positionMode}
        options={[
          { value: 'sequential' as const, title: 'Подряд по правилу' },
          { value: 'oddEven' as const, title: 'От центрального прохода: чётные и нечётные' },
        ]}
        hint={positionMode === 'oddEven'
          ? 'Слева от прохода чётные к краю, справа нечётные к краю. Точка деления — первый продольный проход, иначе середина ряда.'
          : undefined}
        onChange={setPositionMode}
      />

      {positionMode === 'sequential' ? (
        <LabelRuleFields title='Подписи мест' rule={positionRule} onChange={setPositionRule} />
      ) : (
        <Text
          label='Пропустить номера мест'
          value={positionRule.skipped}
          placeholder='13'
          maxLength={200}
          hint='Разрыв нумерации: номер пропускается, порядок мест сохраняется'
          onChange={(skipped) => setPositionRule({ ...positionRule, skipped })}
        />
      )}

      <div className='field'>
        <label>Проходы</label>
        {gaps.length === 0 ? (
          <p className='inspector-note'>Проходов нет: места и ряды стоят сплошь.</p>
        ) : null}
        {gaps.map((gap, index) => (
          <div
            key={`${gap.axis}-${index}`}
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, alignItems: 'end', marginBottom: 8 }}
          >
            <Select
              label='Ось'
              value={gap.axis}
              options={[
                { value: 'position' as const, title: 'Продольный' },
                { value: 'row' as const, title: 'Поперечный' },
              ]}
              onChange={(axis) =>
                setGaps(gaps.map((item, current) => (current === index ? { ...item, axis } : item)))}
            />
            <Numeric
              label={gap.axis === 'position' ? 'После места' : 'После ряда'}
              value={gap.after}
              min={1}
              onChange={(after) =>
                setGaps(gaps.map((item, current) =>
                  (current === index ? { ...item, after: Math.max(1, Math.round(after)) } : item)))}
            />
            <Numeric
              label='Ширина, мм'
              value={gap.width}
              min={100}
              step={100}
              onChange={(width) =>
                setGaps(gaps.map((item, current) =>
                  (current === index ? { ...item, width: Math.max(1, Math.round(width)) } : item)))}
            />
            <Button
              kind='ghost'
              icon={<Trash2 size={13} />}
              title='Убрать проход'
              onClick={() => setGaps(gaps.filter((_, current) => current !== index))}
            />
          </div>
        ))}
        <Button
          kind='secondary'
          icon={<Plus size={13} />}
          onClick={() => setGaps([
            ...gaps,
            { axis: 'position', after: Math.max(1, Math.floor(positionsPerRow / 2)), width: 1_200 },
          ])}
        >
          Добавить проход
        </Button>
      </div>

      {preview.ok ? (
        <div className='numbering-box'>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Что получится</div>
          <p className='inspector-note' style={{ margin: 0 }}>
            {preview.value.rows.length} рядов ·{' '}
            {preview.value.rows.reduce((total, row) => total + row.positions.length, 0)} мест ·{' '}
            {formatLength(preview.value.width)} × {formatLength(preview.value.height)}
          </p>
          <p className='inspector-note' style={{ margin: 0 }}>
            Ряды: {preview.value.rows.slice(0, 6).map((row) => row.label).join(', ')}
            {preview.value.rows.length > 6 ? '…' : ''}
          </p>
          <p className='inspector-note' style={{ margin: 0 }}>
            Первый ряд:{' '}
            {preview.value.rows[0].positions.slice(0, 10).map((position) => position.label).join(', ')}
            {preview.value.rows[0].positions.length > 10 ? '…' : ''}
          </p>
        </div>
      ) : (
        <Note tone='warn'>{preview.message}</Note>
      )}

      {skipsNumbering ? (
        <label className='check'>
          <input
            type='checkbox'
            checked={skipConfirmed}
            onChange={(event) => setSkipConfirmed(event.target.checked)}
          />
          <span>Подтверждаю разрыв нумерации: пропуск подписи задан намеренно</span>
        </label>
      ) : null}

      {hasExistingComposition ? (
        <label className='check'>
          <input
            type='checkbox'
            checked={replaceConfirmed}
            onChange={(event) => setReplaceConfirmed(event.target.checked)}
          />
          <span>Подтверждаю замену: текущий состав зоны будет удалён и построен заново</span>
        </label>
      ) : null}

      <Button
        full
        kind='primary'
        disabled={blocked}
        title={blocked && preview.ok
          ? (hasExistingComposition && !replaceConfirmed
            ? 'Подтвердите замену текущего состава зоны'
            : 'Подтвердите разрыв нумерации')
          : undefined}
        onClick={() => {
          if (preview.ok) onApply(preview.value);
        }}
      >
        {hasExistingComposition ? 'Заменить структуру' : 'Построить структуру'}
      </Button>
    </div>
  );
}

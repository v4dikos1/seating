import { useState } from 'react';
import { Plus, Ruler, SquareDashed, Trash2 } from 'lucide-react';
import {
  addTable,
  defaultSeatStep,
  fitFrame,
  formatArea,
  formatLength,
  measureSeatPitch,
  moveZone,
  removeTable,
  scaleZone,
  updateTable,
  zoneKindOf,
  type SeatingFloorResult,
  type SeatingZoneGeometry,
} from '@tickets/seating';
import type { WorkZone } from '../configurator-document';
import { Button, ColorPickerPreset, Note, Numeric, Select, Text } from '../ui';
import { StructureGenerator } from './structure-generator';

export function ZoneInspector({
  zone,
  floors,
  selectedTableIndex,
  onSelectTable,
  onChange,
  onDelete,
  onSetFrame,
}: {
  zone: WorkZone;
  floors?: SeatingFloorResult[];
  selectedTableIndex?: number | null;
  onSelectTable?: (tableIndex: number) => void;
  onChange: (change: (geometry: SeatingZoneGeometry) => SeatingZoneGeometry) => void;
  onDelete: () => void;
  /** Ставит зоне рамку разумного размера в центре видимой области холста. */
  onSetFrame: () => void;
}) {
  const kind = zoneKindOf(zone.geometry);
  const seatPitch = measureSeatPitch(zone.geometry);
  // Шаг больше двух метров не бывает у кресел: значит, зона построена не в метрах.
  const outOfScale = seatPitch !== null && seatPitch > 2_000;
  const [targetPitch, setTargetPitch] = useState(defaultSeatStep);
  const hasFrame = zone.geometry.width > 0 && zone.geometry.height > 0;
  const seatCount = zone.geometry.rows.reduce((total, row) => total + row.positions.length, 0);


  return (
    <div className='inspector-panel'>
      <div className='inspector-panel-head'>
        <h3>Параметры зоны</h3>
      </div>

      <details className='inspector-section' open>
        <summary>Основное</summary>
        <div className='inspector-section-body'>
          <Text
            label='Название зоны'
            value={zone.geometry.name}
            maxLength={200}
            onChange={(value) => onChange((geometry) => ({ ...geometry, name: value }))}
          />

          <div className='pair'>
            <Text
              label='Код зоны'
              value={zone.geometry.code}
              maxLength={64}
              onChange={(value) => onChange((geometry) => ({ ...geometry, code: value }))}
            />
          </div>

          {hasFrame ? (
            <>
              <div className='pair'>
                <Numeric
                  label='Позиция X, м'
                  value={Math.round(zone.geometry.x / 10) / 100}
                  step={0.1}
                  onChange={(value) => {
                    const targetX = Math.round(value * 1_000);
                    const dx = targetX - zone.geometry.x;
                    if (dx !== 0) onChange((geometry) => moveZone(geometry, dx, 0));
                  }}
                />
                <Numeric
                  label='Позиция Y, м'
                  value={Math.round(zone.geometry.y / 10) / 100}
                  step={0.1}
                  onChange={(value) => {
                    const targetY = Math.round(value * 1_000);
                    const dy = targetY - zone.geometry.y;
                    if (dy !== 0) onChange((geometry) => moveZone(geometry, 0, dy));
                  }}
                />
              </div>

              <p className='inspector-note'>
                Размер зоны: {formatLength(zone.geometry.width)} × {formatLength(zone.geometry.height)}
                {' '}· {formatArea(zone.geometry.width, zone.geometry.height)}
              </p>
            </>
          ) : (
            <div className='empty-state-card'>
              <SquareDashed size={18} color='var(--primary)' />
              <p><strong>У зоны нет рамки</strong></p>
              <span>
                На холсте её не видно и не выбрать иначе, чем из этого списка. «Задать рамку»
                поставит границы разумного размера в центре видимой сейчас области холста —
                их можно будет подвинуть и растянуть как обычно.
              </span>
              <Button kind='secondary' icon={<SquareDashed size={13} />} onClick={onSetFrame}>
                Задать рамку
              </Button>
            </div>
          )}

          {floors && floors.length > 1 ? (
            <Select
              label='Этаж'
              value={zone.geometry.floorId ?? ''}
              options={floors.map((f) => ({ value: f.id, title: f.name }))}
              onChange={(floorId) => onChange((geometry) => ({ ...geometry, floorId }))}
            />
          ) : null}

          <ColorPickerPreset
            id={`color-${zone.zoneId}`}
            value={zone.geometry.color}
            onChange={(color) => onChange((geometry) => ({ ...geometry, color }))}
          />
        </div>
      </details>

      <details className='inspector-section' open>
        <summary>Тип размещения</summary>
        <div className='inspector-section-body'>
      <Select
        label='Тип размещения'
        value={kind}
        options={[
          { value: 'Numbered', title: 'С местами (нумерованная рассадка)' },
          { value: 'Free', title: 'Без мест (свободная вместимость)' },
          { value: 'Tables', title: 'Столы' },
        ]}
        onChange={(value) =>
          onChange((geometry) =>
            value === 'Free'
              ? { ...geometry, kind: 'Free', capacity: geometry.capacity ?? 100, rows: [] }
              : value === 'Tables'
                ? { ...geometry, kind: 'Tables', capacity: null, rows: [], tables: geometry.tables ?? [] }
                : { ...geometry, kind: 'Numbered', capacity: null, tables: [] },
          )
        }
        hint={
          kind === 'Free'
            ? 'Продаются билеты на количество посетителей без фиксации места'
            : 'Ряды и места размечаются на схеме'
        }
      />

      {kind === 'Numbered' && seatCount === 0 ? (
        <Note tone='info'>
          В зоне пока нет мест. Постройте структуру ниже или возьмите инструмент «Ряд» (R)
          и проведите линию на холсте — места равномерно распределятся по ней.
        </Note>
      ) : null}

      {kind === 'Numbered' ? (
        <StructureGenerator
          zone={zone.geometry}
          onApply={(generated) =>
            onChange((geometry) => ({
              ...geometry,
              kind: 'Numbered',
              capacity: null,
              tables: [],
              rows: generated.rows,
              x: generated.x,
              y: generated.y,
              width: generated.width,
              height: generated.height,
            }))
          }
        />
      ) : null}


      {kind === 'Free' ? (
        <Numeric
          label='Максимальная вместимость'
          value={zone.geometry.capacity ?? 0}
          min={1}
          onChange={(value) =>
            onChange((geometry) => ({
              ...geometry,
              capacity: Math.max(1, Math.round(value)),
            }))
          }
        />
      ) : kind === 'Tables' ? (
        <>
          <Note>Инструмент «Стол» (T) добавляет стол по клику на холсте.</Note>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <Button
              kind='secondary'
              icon={<Plus size={13} />}
              onClick={() => {
                const cx = Math.round(zone.geometry.x + zone.geometry.width / 2);
                const cy = Math.round(zone.geometry.y + zone.geometry.height / 2);
                onChange((geometry) => addTable(geometry, cx, cy));
              }}
            >
              Добавить стол
            </Button>
            <Button
              kind='ghost'
              onClick={() => onChange((geometry) => fitFrame(geometry))}
            >
              Подогнать границы
            </Button>
          </div>
          {selectedTableIndex !== null &&
          selectedTableIndex !== undefined &&
          (zone.geometry.tables ?? [])[selectedTableIndex] ? (
            (() => {
              const table = (zone.geometry.tables ?? [])[selectedTableIndex];
              const index = selectedTableIndex;
              return (
                <div
                  className='inspector-panel'
                  style={{
                    border: '1px solid var(--primary-light)',
                    padding: 12,
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div className='inspector-panel-head'>
                    <h4>Стол «{table.label}» (выбран)</h4>
                    <button
                      type='button'
                      className='link'
                      style={{ fontSize: 11 }}
                      onClick={() => onSelectTable?.(-1)}
                    >
                      Все столы
                    </button>
                  </div>
                  <Text
                    label='Подпись стола'
                    value={table.label}
                    maxLength={64}
                    onChange={(label) =>
                      onChange((geometry) => updateTable(geometry, index, { label }))
                    }
                  />
                  <div className='pair'>
                    <Numeric
                      label='Центр X, м'
                      value={Math.round(table.x / 10) / 100}
                      step={0.1}
                      onChange={(x) =>
                        onChange((geometry) => updateTable(geometry, index, { x: Math.round(x * 1_000) }))
                      }
                    />
                    <Numeric
                      label='Центр Y, м'
                      value={Math.round(table.y / 10) / 100}
                      step={0.1}
                      onChange={(y) =>
                        onChange((geometry) => updateTable(geometry, index, { y: Math.round(y * 1_000) }))
                      }
                    />
                  </div>
                  <Numeric
                    label='Поворот стола, градусы'
                    value={table.rotation / 1_000}
                    min={0}
                    max={359}
                    onChange={(rotation) =>
                      onChange((geometry) =>
                        updateTable(geometry, index, { rotation: Math.round(rotation * 1_000) }),
                      )
                    }
                  />
                  <Numeric
                    label='Вместимость (число мест)'
                    value={table.capacity}
                    min={1}
                    onChange={(capacity) =>
                      onChange((geometry) =>
                        updateTable(geometry, index, { capacity: Math.max(1, Math.round(capacity)) }),
                      )
                    }
                  />
                  <Select
                    label='Режим продажи'
                    value={table.saleMode}
                    options={[
                      { value: 'Whole', title: 'Стол целиком (единый билет на весь стол)' },
                      { value: 'Individual', title: 'По местам (каждое место продаётся отдельно)' },
                      { value: 'MinimumQuantity', title: 'Минимальное количество мест за раз' },
                    ]}
                    onChange={(saleMode) =>
                      onChange((geometry) =>
                        updateTable(geometry, index, {
                          saleMode,
                          minimumQuantity:
                            saleMode === 'MinimumQuantity'
                              ? Math.min(table.capacity, table.minimumQuantity ?? 1)
                              : null,
                        }),
                      )
                    }
                  />
                  {table.saleMode === 'MinimumQuantity' ? (
                    <Numeric
                      label='Минимальное количество'
                      value={table.minimumQuantity ?? 1}
                      min={1}
                      max={table.capacity}
                      onChange={(minimumQuantity) =>
                        onChange((geometry) =>
                          updateTable(geometry, index, {
                            minimumQuantity: Math.max(
                              1,
                              Math.min(table.capacity, Math.round(minimumQuantity)),
                            ),
                          }),
                        )
                      }
                    />
                  ) : null}
                  <div style={{ marginTop: 8 }}>
                    <Button
                      kind='danger'
                      full
                      icon={<Trash2 size={13} />}
                      onClick={() => {
                        onChange((geometry) => removeTable(geometry, index));
                        onSelectTable?.(-1);
                      }}
                    >
                      Удалить стол «{table.label}»
                    </Button>
                  </div>
                </div>
              );
            })()
          ) : (
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--ink-secondary)',
                  marginBottom: 6,
                }}
              >
                Столы зоны ({(zone.geometry.tables ?? []).length})
              </div>
              {(zone.geometry.tables ?? []).length === 0 ? (
                <Note tone='info'>
                  В этой зоне пока нет столов. Нажмите «Добавить стол» или используйте инструмент «Стол» (T).
                </Note>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    maxHeight: 220,
                    overflowY: 'auto',
                  }}
                >
                  {(zone.geometry.tables ?? []).map((t, idx) => (
                    <button
                      key={t.id ?? idx}
                      type='button'
                      className='btn btn-studio'
                      style={{ justifyContent: 'space-between', width: '100%', textAlign: 'left' }}
                      onClick={() => onSelectTable?.(idx)}
                    >
                      <span>
                        <b>Стол {t.label}</b> · {t.capacity} мест ·{' '}
                        {t.saleMode === 'Whole'
                          ? 'Целиком'
                          : t.saleMode === 'Individual'
                            ? 'По местам'
                            : `Мин. ${t.minimumQuantity}`}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                        {t.rotation / 1_000}°
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <Button
          full
          kind='secondary'
          onClick={() => onChange((geometry) => fitFrame(geometry))}
        >
          Подогнать границы под места
        </Button>
      )}
        </div>
      </details>

      {kind === 'Numbered' && seatPitch !== null ? (
        <details className='inspector-section' open={outOfScale}>
          <summary>
            Масштаб зоны
            {outOfScale ? <span className='inspector-section-count'>!</span> : null}
          </summary>
          <div className='inspector-section-body'>
            <div className='numbering-box'>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Ruler size={13} /> Масштаб зоны
              </div>
              <p className='inspector-note'>
                Единица схемы равна метру. Сейчас между соседними местами{' '}
                <strong>{formatLength(seatPitch)}</strong>
                {outOfScale
                  ? ' — для кресел это неправдоподобно много, значит зона нарисована в чужих единицах.'
                  : '.'}
              </p>
              <Numeric
                label='Привести шаг мест к, мм'
                value={targetPitch}
                min={100}
                max={5_000}
                step={50}
                hint={`Зона изменится в ${(targetPitch / seatPitch).toFixed(3)} раза относительно левого верхнего угла`}
                onChange={setTargetPitch}
              />
              <Button
                full
                kind={outOfScale ? 'primary' : 'secondary'}
                disabled={targetPitch <= 0 || targetPitch === seatPitch}
                title='Пересчитать координаты рядов, мест и столов зоны; отменяется через Ctrl+Z'
                onClick={() => onChange((geometry) => scaleZone(geometry, targetPitch / seatPitch))}
              >
                Пересчитать зону
              </Button>
            </div>
          </div>
        </details>
      ) : null}

      <Button
        kind='danger'
        full
        icon={<Trash2 size={14} />}
        onClick={onDelete}
        title={
          zone.isNew
            ? 'Убрать новую зону'
            : 'Удалить сохранённую зону: сервер допишет новую редакцию черновика без неё'
        }
      >
        Убрать зону из схемы
      </Button>
    </div>
  );
}

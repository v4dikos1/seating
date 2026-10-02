import { Accessibility } from 'lucide-react';
import {
  declaresNothing,
  type ResolvedSeatingProperties,
  type SeatingAccessibility,
  type SeatingProperties,
  type SeatingViewObstruction,
} from '@tickets/seating';
import { Badge } from '../ui';

/**
 * Панель редактирования иерархических свойств с Segmented селекторами.
 */
export function PropertiesEditor(props: {
  title: string;
  hint: string;
  properties: SeatingProperties | null | undefined;
  inherited: { accessibility: string; viewObstruction: string; sellable: string };
  onChange: (properties: SeatingProperties | null) => void;
}) {
  const declared = props.properties ?? {};
  const patch = (change: SeatingProperties) => {
    const next: SeatingProperties = { ...declared, ...change };
    props.onChange(declaresNothing(next) ? null : next);
  };

  const isAccessOverridden = declared.accessibility !== null && declared.accessibility !== undefined;
  const isObstructionOverridden = declared.viewObstruction !== null && declared.viewObstruction !== undefined;
  const isSellableOverridden = declared.sellable !== null && declared.sellable !== undefined;

  return (
    <div className='inspector-panel'>
      <div className='inspector-panel-head'>
        <h3>
          <Accessibility size={15} color='var(--primary)' /> {props.title}
        </h3>
        {!declaresNothing(declared) ? (
          <button
            type='button'
            className='link'
            style={{ fontSize: 11 }}
            onClick={() => props.onChange(null)}
          >
            Сбросить всё
          </button>
        ) : null}
      </div>

      <p className='inspector-note'>{props.hint}</p>

      {/* Доступность */}
      <div className='prop-selector'>
        <div className='prop-selector-label'>
          <span>Доступность</span>
          <span className='prop-selector-status'>
            {isAccessOverridden ? (
              <Badge tone='brand'>Своё</Badge>
            ) : (
              `Наследуется (${props.inherited.accessibility})`
            )}
          </span>
        </div>
        <div className='prop-options'>
          <button
            type='button'
            className={`prop-option-btn ${!isAccessOverridden ? 'active' : ''}`}
            onClick={() => patch({ accessibility: null })}
          >
            Наследовать
          </button>
          <button
            type='button'
            className={`prop-option-btn ${declared.accessibility === 'None' ? 'active-custom' : ''}`}
            onClick={() => patch({ accessibility: 'None' as SeatingAccessibility })}
          >
            Обычное
          </button>
          <button
            type='button'
            className={`prop-option-btn ${declared.accessibility === 'Wheelchair' ? 'active-custom' : ''}`}
            onClick={() => patch({ accessibility: 'Wheelchair' as SeatingAccessibility })}
            title='Кресло-коляска'
          >
            <span role='img' aria-label='Кресло-коляска'>♿</span> Коляска
          </button>
          <button
            type='button'
            className={`prop-option-btn ${declared.accessibility === 'Companion' ? 'active-custom' : ''}`}
            onClick={() => patch({ accessibility: 'Companion' as SeatingAccessibility })}
            title='Сопровождающий'
          >
            Сопровожд.
          </button>
        </div>
      </div>

      {/* Обзор */}
      <div className='prop-selector'>
        <div className='prop-selector-label'>
          <span>Обзор сцены</span>
          <span className='prop-selector-status'>
            {isObstructionOverridden ? (
              <Badge tone='brand'>Своё</Badge>
            ) : (
              `Наследуется (${props.inherited.viewObstruction})`
            )}
          </span>
        </div>
        <div className='prop-options'>
          <button
            type='button'
            className={`prop-option-btn ${!isObstructionOverridden ? 'active' : ''}`}
            onClick={() => patch({ viewObstruction: null })}
          >
            Наследовать
          </button>
          <button
            type='button'
            className={`prop-option-btn ${declared.viewObstruction === 'None' ? 'active-custom' : ''}`}
            onClick={() => patch({ viewObstruction: 'None' as SeatingViewObstruction })}
          >
            Полный
          </button>
          <button
            type='button'
            className={`prop-option-btn ${declared.viewObstruction === 'Partial' ? 'active-custom' : ''}`}
            onClick={() => patch({ viewObstruction: 'Partial' as SeatingViewObstruction })}
          >
            Частичный
          </button>
          <button
            type='button'
            className={`prop-option-btn ${declared.viewObstruction === 'Severe' ? 'active-custom' : ''}`}
            onClick={() => patch({ viewObstruction: 'Severe' as SeatingViewObstruction })}
          >
            Закрытый
          </button>
        </div>
      </div>

      {/* Продажа */}
      <div className='prop-selector'>
        <div className='prop-selector-label'>
          <span>Статус продажи</span>
          <span className='prop-selector-status'>
            {isSellableOverridden ? (
              <Badge tone='brand'>Своё</Badge>
            ) : (
              `Наследуется (${props.inherited.sellable})`
            )}
          </span>
        </div>
        <div className='prop-options'>
          <button
            type='button'
            className={`prop-option-btn ${!isSellableOverridden ? 'active' : ''}`}
            onClick={() => patch({ sellable: null })}
          >
            Наследовать
          </button>
          <button
            type='button'
            className={`prop-option-btn ${declared.sellable === true ? 'active-custom' : ''}`}
            onClick={() => patch({ sellable: true })}
          >
            В продаже
          </button>
          <button
            type='button'
            className={`prop-option-btn ${declared.sellable === false ? 'active-custom' : ''}`}
            onClick={() => patch({ sellable: false })}
          >
            Служебное
          </button>
        </div>
      </div>
    </div>
  );
}

export function inheritedTitles(resolved: ResolvedSeatingProperties) {
  const accessibility: Record<SeatingAccessibility, string> = {
    None: 'обычное место',
    Wheelchair: 'кресло-коляска',
    Companion: 'сопровождающий',
    ReducedMobility: 'ограниченная подвижность',
  };
  const obstruction: Record<SeatingViewObstruction, string> = {
    None: 'обзор не ограничен',
    Partial: 'частично закрыт',
    Severe: 'закрыт в значительной части',
  };
  return {
    accessibility: accessibility[resolved.accessibility],
    viewObstruction: obstruction[resolved.viewObstruction],
    sellable: resolved.sellable ? 'продаётся' : 'вне продажи',
  };
}

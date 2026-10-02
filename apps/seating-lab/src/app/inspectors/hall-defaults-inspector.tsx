import { useEffect, useState } from 'react';
import { Save, Settings2 } from 'lucide-react';
import {
  declaresNothing,
  newIdempotencyKey,
  type ResolvedSeatingProperties,
  type SeatingConfigurationResult,
  type SeatingProperties,
} from '@tickets/seating';
import { useLab, useRequest } from '../state';
import { Button, Problem } from '../ui';
import { PropertiesEditor, inheritedTitles } from './properties-editor';

export function HallDefaultsInspector(props: {
  hall: SeatingConfigurationResult;
  version: number;
  onHallChanged: (hall: SeatingConfigurationResult) => void;
  onVersionChanged: (version: number) => void;
}) {
  const { api } = useLab();
  const saving = useRequest();
  const [properties, setProperties] = useState<SeatingProperties | null>(props.hall.properties ?? null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setProperties(props.hall.properties ?? null);
    setDirty(false);
  }, [props.hall.properties]);

  async function saveProperties() {
    await saving.run(async () => {
      const updated = await api.setConfigurationProperties(
        props.hall.id,
        {
          expectedVersion: props.version,
          properties: declaresNothing(properties) ? null : properties,
        },
        newIdempotencyKey(),
      );
      props.onVersionChanged(updated.versions.configurationVersion);
      props.onHallChanged(updated);
      setDirty(false);
    });
  }

  const defaultResolved: ResolvedSeatingProperties = {
    accessibility: 'None',
    viewObstruction: 'None',
    sellable: true,
  };

  return (
    <div className='inspector-panel'>
      <div className='inspector-panel-head'>
        <h3>
          <Settings2 size={15} color='var(--primary)' /> Свойства зала
        </h3>
      </div>
      <p className='inspector-note'>
        Общие значения по умолчанию для всего зала. Если в зоне, ряду или месте свойство не задано,
        применяется значение отсюда.
      </p>

      <details className='inspector-section' open>
        <summary>Умолчания зала</summary>
        <div className='inspector-section-body'>
          <PropertiesEditor
            title='Умолчания зала'
            hint='Базовые свойства мест зала, если они не переопределены на уровне зон или рядов.'
            properties={properties}
            inherited={inheritedTitles(defaultResolved)}
            onChange={(next) => {
              setProperties(next);
              setDirty(true);
            }}
          />
        </div>
      </details>

      <div style={{ marginTop: 12 }}>
        <Button
          kind='primary'
          full
          disabled={!dirty || saving.busy}
          icon={<Save size={14} />}
          onClick={() => void saveProperties()}
        >
          {saving.busy ? 'Сохранение свойств…' : 'Сохранить свойства зала'}
        </Button>
      </div>
      <Problem error={saving.error} />
    </div>
  );
}

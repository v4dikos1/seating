import { HelpCircle, X } from 'lucide-react';

interface SeatKindInfo {
  id: string;
  symbol: string;
  name: string;
  description: string;
  color: string;
  border?: string;
}

const SEAT_KINDS: SeatKindInfo[] = [
  {
    id: 'regular',
    symbol: '●',
    name: 'Обычное место',
    description: 'Стандартное кресло в продаже',
    color: '#346bcb',
  },
  {
    id: 'wheelchair',
    symbol: '♿',
    name: 'Кресло-коляска',
    description: 'Специальная зона для инвалидной коляски',
    color: '#0284c7',
  },
  {
    id: 'companion',
    symbol: '＋',
    name: 'Сопровождающий',
    description: 'Место рядом со зрителем на коляске',
    color: '#0ea5e9',
  },
  {
    id: 'reducedMobility',
    symbol: '⊞',
    name: 'Маломобильный',
    description: 'Место с дополнительным пространством/поручнями',
    color: '#2563eb',
  },
  {
    id: 'obstructedPartial',
    symbol: '◐',
    name: 'Частичный обзор',
    description: 'Частичное препятствие видимости сцены',
    color: '#d97706',
  },
  {
    id: 'obstructedSevere',
    symbol: '⊘',
    name: 'Закрытый обзор',
    description: 'Существенно ограниченный обзор сцены',
    color: '#dc2626',
  },
  {
    id: 'unsellable',
    symbol: '✕',
    name: 'Вне продажи',
    description: 'Служебное или технически заблокированное место',
    color: '#64748b',
  },
];

/**
 * Продажный статус показа (артефакт 20 §6): те же не-цветовые обозначения, что и на схеме
 * (`seat-textures.ts` — пунктирная обводка удержания, тёмная заливка с крестом продажи).
 */
const SALES_KINDS: SeatKindInfo[] = [
  {
    id: 'salesAvailable',
    symbol: '○',
    name: 'Свободно',
    description: 'Можно выбрать и забронировать',
    color: '#16a34a',
  },
  {
    id: 'salesSelected',
    symbol: '◉',
    name: 'Выбрано вами',
    description: 'Тёмное место с оранжевым кольцом — попадёт в бронь',
    color: '#ff5c39',
  },
  {
    id: 'salesHeld',
    symbol: '⧗',
    name: 'Удержано',
    description: 'Место забронировано другим покупателем и освободится, если бронь истечёт',
    color: '#d97706',
  },
  {
    id: 'salesSold',
    symbol: '✕',
    name: 'Продано',
    description: 'Билет на это место уже куплен',
    color: '#334155',
  },
  {
    id: 'salesNotForSale',
    symbol: '—',
    name: 'Не продаётся онлайн',
    description: 'Серая зона со штриховкой или место вне продажи этого показа',
    color: '#94a3b8',
  },
];

export function SeatLegend({
  open,
  onClose,
  sales = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Показать легенду продажных статусов (виджет покупателя) вместо свойств геометрии. */
  sales?: boolean;
}) {
  if (!open) return null;
  const kinds = sales ? SALES_KINDS : SEAT_KINDS;

  return (
    <div className='seat-legend-card' role='region' aria-label='Легенда обозначений мест'>
      <div className='seat-legend-header'>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <HelpCircle size={14} color='var(--primary)' />
          <strong>{sales ? 'Статусы мест' : 'Обозначения мест'}</strong>
        </div>
        <button
          type='button'
          className='icon'
          onClick={onClose}
          aria-label='Закрыть легенду'
          style={{ width: 20, height: 20, padding: 0 }}
        >
          <X size={14} />
        </button>
      </div>

      <div className='seat-legend-list'>
        {kinds.map((kind) => (
          <div key={kind.id} className='seat-legend-row'>
            <span
              className='seat-legend-badge'
              style={{
                background: kind.color,
                color: '#ffffff',
              }}
            >
              {kind.symbol}
            </span>
            <div className='seat-legend-info'>
              <div className='seat-legend-name'>{kind.name}</div>
              <div className='seat-legend-desc'>{kind.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

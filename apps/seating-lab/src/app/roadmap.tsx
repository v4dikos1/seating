import { Milestone } from 'lucide-react';
import { Badge, Section } from './ui';

type Surface = 'organizer' | 'admin' | 'customer';

interface Item {
  area: string;
  detail: string;
  stage: string;
  surfaces: Surface[];
}

const all: Surface[] = ['organizer', 'admin', 'customer'];

/** Источник: артефакт 20 §8–§9 и таблица замечаний руководства backend. */
const items: Item[] = [
  {
    area: 'Утверждение и публикация схемы',
    detail:
      'Схема живёт черновиком: состояний «на проверке», «утверждена» и «опубликована» нет, ' +
      'как и защиты опубликованной версии от правки.',
    stage: 'S2',
    surfaces: all,
  },
  {
    area: 'Доступность мест в реальном времени',
    detail:
      'Покупатель и организатор опрашивают снимок доступности каждые несколько секунд ' +
      '(по умолчанию 5 с); потока изменений (SignalR/WebSocket) нет — обновление не мгновенное.',
    stage: 'S6',
    surfaces: all,
  },
  {
    area: 'Столы и банкетная рассадка',
    detail:
      'Столы (Tables) с режимами продажи Whole, Individual, MinimumQuantity и свободная вместимость (Free) ' +
      'реализованы в схеме зала и редакторе. Продаётся только Individual: Whole, MinimumQuantity и ' +
      'квота Free-зоны в первый срез продаж не входят.',
    stage: 'S3',
    surfaces: ['organizer', 'admin'],
  },
  {
    area: 'Промокоды, групповые и динамические правила цены',
    detail:
      'Ценовой шаблон считает только процентные/фиксированные скидки и наценки по приоритету и ' +
      'окну действия. Промокодов, групповых тарифов и правил спроса нет.',
    stage: 'S4',
    surfaces: ['organizer', 'admin', 'customer'],
  },
  {
    area: 'Настоящий провайдер оплаты и возврат',
    detail:
      'Оплата — только тестовый Mock-адаптер (стенд подтверждает исход тремя кнопками); ' +
      'настоящего провайдера нет. Возврат при оплате уже занятого места фиксируется записью ' +
      '«требуется возврат», но не исполняется.',
    stage: 'S4',
    surfaces: ['organizer', 'admin', 'customer'],
  },
  {
    area: 'QR, передача и печать билета',
    detail: 'Билет — запись с ценой и адресом места; мандата прохода, QR-кода и передачи билета нет.',
    stage: 'S5',
    surfaces: ['admin', 'customer'],
  },
  {
    area: 'Импорт схемы файлом',
    detail:
      'Разбор JSON, CSV, SVG и подложек выполняется только на клиенте: серверного импорта, ' +
      'отчёта и происхождения файла нет.',
    stage: 'S1',
    surfaces: ['organizer', 'admin'],
  },
  {
    area: 'Одновременная работа над схемой',
    detail:
      'Позональная оптимистическая блокировка (expectedZoneVersion) реализована: параллельные правки разных зон не конфликтуют. ' +
      'Конфликт версий возникает только при одновременной модификации одной и той же зоны.',
    stage: 'S1',
    surfaces: ['organizer', 'admin'],
  },
  {
    area: 'Общие схемы площадки',
    detail: 'Администратор не может подготовить схему один раз и выдать организаторам копию.',
    stage: 'S1/S2',
    surfaces: ['admin', 'organizer'],
  },
  {
    area: 'Очередь проверки схем',
    detail: 'Отправить схему на утверждение и рассмотреть её администратору пока негде.',
    stage: 'S2',
    surfaces: ['admin'],
  },
  {
    area: 'Замена места в проданном билете',
    detail: 'Административный сценарий перевыпуска билета с уведомлением не реализован.',
    stage: 'S5',
    surfaces: ['admin'],
  },
  {
    area: 'Безопасное встраивание',
    detail:
      'Сервер не выдаёт короткоживущую сессию показа: виджет получает обычный токен, ' +
      'а списка разрешённых сайтов нет.',
    stage: 'S6',
    surfaces: ['customer', 'admin'],
  },
  {
    area: 'Языки витрины',
    detail: 'Виджет принимает язык, но переведён только на русский.',
    stage: 'S6',
    surfaces: ['customer'],
  },
];

const titles: Record<Surface, string> = {
  organizer: 'организатора',
  admin: 'администратора',
  customer: 'витрины покупателя',
};

export function RoadmapPage({ surface }: { surface: Surface }) {
  const visible = items.filter((item) => item.surfaces.includes(surface));
  return (
    <Section
      title='Что появится позже'
      description={`Возможности рабочего места ${titles[surface]}, которых сервис пока не поддерживает. В интерфейсе они обозначены пометкой «скоро» рядом с соответствующими действиями.`}
    >
      <ul className='roadmap'>
        {visible.map((item) => (
          <li key={item.area}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--primary-light)',
                  color: 'var(--primary)',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                <Milestone size={18} />
              </div>
              <div>
                <b>{item.area}</b>
                <p>{item.detail}</p>
              </div>
            </div>
            <Badge tone='purple'>{item.stage}</Badge>
          </li>
        ))}
      </ul>
    </Section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Code2,
  Copy,
  Monitor,
  ShoppingBag,
  Smartphone,
  Tablet,
} from 'lucide-react';
import {
  SeatingWidget,
  formatMoney,
  type SalesCurrency,
  type SeatingConfigurationResult,
  type WidgetContext,
  type WidgetMessage,
  type WidgetSeat,
} from '@tickets/seating';

import { useLab, useRequest } from './state';
import { Badge, Button, Empty, Note, Planned, Problem, Section, SegmentedControl, Select, Spinner, Text }
  from './ui';

const widgetSource = '/widget.html';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DeviceMode = 'desktop' | 'tablet' | 'mobile';
type ShowcaseMode = 'sales' | 'preview';

interface CartReservation {
  reservationId: string;
  expiresAt: string;
  totalAmountMinor: number;
  currency: string;
}

interface CartPurchase {
  orderId: string;
  ticketIds: string[];
}

/** Строка журнала для события виджета: суммы и срок читаются глазами, а не сырым JSON. */
export function describeWidgetEvent(message: WidgetMessage): string {
  switch (message.type) {
    case 'selectionChanged':
      return `${message.selection.length} мест выбрано`;
    case 'resize':
      return `${message.height} px высота`;
    case 'error':
      return message.message;
    case 'reservationCreated':
      return `бронь ${message.reservationId} · ${formatMoney(message.totalAmountMinor, message.currency as SalesCurrency)}`
        + ` · до ${new Date(message.expiresAt).toLocaleTimeString('ru-RU')}`;
    case 'expired':
      return `бронь ${message.reservationId} истекла или отменена`;
    case 'purchaseCompleted':
      return `заказ ${message.orderId} оплачен · билетов: ${message.ticketIds.length}`;
    default:
      return '';
  }
}

export function ShowcasePage({ initialHallId }: { initialHallId?: string }) {
  const { api, connection, signedIn } = useLab();
  const [mode, setMode] = useState<ShowcaseMode>('sales');
  const [halls, setHalls] = useState<SeatingConfigurationResult[] | null>(null);
  const [hallId, setHallId] = useState(initialHallId ?? '');
  const [occurrenceInput, setOccurrenceInput] = useState('');
  const [occurrenceId, setOccurrenceId] = useState('');
  const [device, setDevice] = useState<DeviceMode>('desktop');
  const [copied, setCopied] = useState(false);
  const [events, setEvents] = useState<{ id: number; type: string; detail: string; at: string }[]>(
    [],
  );
  const [selection, setSelection] = useState<WidgetSeat[]>([]);
  const [reservation, setReservation] = useState<CartReservation | null>(null);
  const [purchase, setPurchase] = useState<CartPurchase | null>(null);
  const { busy, error, run } = useRequest();

  const preview = mode === 'preview';

  useEffect(() => {
    if (!signedIn || !preview) return;
    void run(async () => {
      const page = await api.listConfigurations({
        limit: 100,
        sortBy: 'UpdatedAt',
        sortDirection: 'Desc',
      });
      setHalls(page.items);
      setHallId((current) => current || page.items[0]?.id || '');
      return page;
    });
  }, [api, signedIn, preview, run]);

  const hall = halls?.find((item) => item.id === hallId) ?? null;
  const occurrenceValid = uuidPattern.test(occurrenceInput.trim());

  const context = useMemo<WidgetContext | null>(() => {
    if (preview) {
      return hall
        ? {
            apiRoot: connection.baseUrl,
            configurationId: hall.id,
            revision: hall.versions.configurationRevision ?? null,
            token: connection.token,
            locale: 'ru',
            maxSelection: 10,
          }
        : null;
    }
    return occurrenceId
      ? {
          apiRoot: connection.baseUrl,
          occurrenceId,
          testMode: true,
          token: connection.token,
          locale: 'ru',
          maxSelection: 10,
        }
      : null;
  }, [preview, hall, occurrenceId, connection.baseUrl, connection.token]);

  function resetSession() {
    setSelection([]);
    setReservation(null);
    setPurchase(null);
    setEvents([]);
  }

  function openOccurrence() {
    if (!occurrenceValid) return;
    resetSession();
    setOccurrenceId(occurrenceInput.trim().toLowerCase());
  }

  function changeMode(next: ShowcaseMode) {
    if (next === mode) return;
    resetSession();
    setMode(next);
  }

  function record(message: WidgetMessage) {
    if (message.type === 'reservationCreated') {
      setReservation({
        reservationId: message.reservationId,
        expiresAt: message.expiresAt,
        totalAmountMinor: message.totalAmountMinor,
        currency: message.currency,
      });
      setPurchase(null);
    } else if (message.type === 'expired') {
      setReservation((current) => (current?.reservationId === message.reservationId ? null : current));
    } else if (message.type === 'purchaseCompleted') {
      setReservation(null);
      setPurchase({ orderId: message.orderId, ticketIds: message.ticketIds });
    }
    setEvents((current) =>
      [
        {
          id: (current[0]?.id ?? 0) + 1,
          type: message.type,
          detail: describeWidgetEvent(message),
          at: new Date().toLocaleTimeString('ru-RU'),
        },
        ...current,
      ].slice(0, 30),
    );
  }

  const widgetUrlForSnippet = new URL(widgetSource, window.location.origin).href;
  const embedCode = preview
    ? `import { SeatingWidget } from '@tickets/seating/embed';

<SeatingWidget
  src="${widgetUrlForSnippet}"
  context={{
    apiRoot: '${connection.baseUrl}',
    configurationId: '${hall?.id ?? 'HALL_ID'}',
    revision: ${hall?.versions.configurationRevision ?? 'null'},
    token: '${connection.token ? '***' : ''}',
    locale: 'ru',
    maxSelection: 10,
  }}
  onSelectionChange={(seats) => console.log('Выбраны места:', seats)}
/>`
    : `import { SeatingWidget } from '@tickets/seating/embed';

<SeatingWidget
  src="${widgetUrlForSnippet}"
  context={{
    apiRoot: '${connection.baseUrl}',
    occurrenceId: '${occurrenceId || 'OCCURRENCE_ID'}',
    testMode: true,
    token: '${connection.token ? '***' : ''}',
    locale: 'ru',
    maxSelection: 10,
  }}
  onEvent={(message) => console.log(message.type, message)}
/>`;

  function copyCode() {
    navigator.clipboard.writeText(embedCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const reservedCurrency = (reservation?.currency ?? 'AMD') as SalesCurrency;

  return (
    <Section
      title='Витрина покупателя'
      description={preview
        ? 'Предпросмотр схемы конфигурации организатором: без показа, цен и брони.'
        : 'Продажа мест показа через виджет: схема, цены, бронь и тестовая оплата. Виджет встраивается через изолированный iframe и протокол postMessage.'}
    >
      <div className='showcase-toolbar'>
        <SegmentedControl<ShowcaseMode>
          value={mode}
          onChange={changeMode}
          options={[
            { value: 'sales', label: 'Продажи показа' },
            { value: 'preview', label: 'Предпросмотр конфигурации' },
          ]}
        />
      </div>

      <Problem error={error} />

      {preview ? (
        <>
          {busy && halls === null ? <Spinner label='Загружаем схемы залов…' /> : null}

          {halls !== null && halls.length === 0 ? (
            <Empty title='Показывать нечего' icon={<ShoppingBag size={40} />}>
              Сначала создайте зал и нарисуйте в нём схему мест в конфигураторе.
            </Empty>
          ) : null}

          {halls !== null && halls.length > 0 ? (
            <div className='showcase-toolbar'>
              <div style={{ maxWidth: 360, width: '100%' }}>
                <Select
                  label='Схема зала для витрины'
                  value={hallId}
                  onChange={setHallId}
                  options={halls.map((item) => ({
                    value: item.id,
                    title: `${item.name} (${item.versions.configurationRevision != null ? `редакция ${item.versions.configurationRevision}` : 'без зон'})`,
                  }))}
                />
              </div>
            </div>
          ) : null}

          {hall && hall.versions.configurationRevision == null ? (
            <Note tone='warn'>
              В выбранном зале пока нет ни одной сохранённой зоны. Покупателю нечего показать.
            </Note>
          ) : null}
        </>
      ) : (
        <form
          className='showcase-toolbar'
          onSubmit={(event) => {
            event.preventDefault();
            openOccurrence();
          }}
        >
          <div style={{ maxWidth: 460, width: '100%' }}>
            <Text
              label='Идентификатор показа'
              value={occurrenceInput}
              onChange={setOccurrenceInput}
              placeholder='00000000-0000-0000-0000-000000000000'
              error={occurrenceInput.trim() && !occurrenceValid ? 'Нужен UUID показа.' : undefined}
              hint={signedIn ? undefined : 'Войдите: без токена бронь и оплата недоступны.'}
            />
          </div>
          <Button kind='primary' type='submit' disabled={!occurrenceValid}>
            Открыть
          </Button>
        </form>
      )}

      <div className='showcase-toolbar'>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}>
            Режим устройства:
          </span>
          <div className='segmented'>
            <button
              type='button'
              className={`segmented-btn ${device === 'desktop' ? 'on' : ''}`}
              onClick={() => setDevice('desktop')}
              title='Десктоп (1200px)'
            >
              <Monitor size={14} /> Desktop
            </button>
            <button
              type='button'
              className={`segmented-btn ${device === 'tablet' ? 'on' : ''}`}
              onClick={() => setDevice('tablet')}
              title='Планшет (768px)'
            >
              <Tablet size={14} /> Tablet
            </button>
            <button
              type='button'
              className={`segmented-btn ${device === 'mobile' ? 'on' : ''}`}
              onClick={() => setDevice('mobile')}
              title='Смартфон (375px)'
            >
              <Smartphone size={14} /> Mobile
            </button>
          </div>
        </div>
      </div>

      {/* Device Frame Simulator */}
      {context ? (
        <div className='showcase-frame-container'>
          <div className={`showcase-device ${device}`}>
            <SeatingWidget
              src={widgetSource}
              context={context}
              title='Схема зала TomCell'
              onEvent={record}
              onSelectionChange={setSelection}
            />
          </div>
        </div>
      ) : null}

      {/* Side Panels: Customer Selection & Dev Logs */}
      <div className='showcase-side'>
        {/* Cart Panel */}
        <div className='inspector-panel'>
          <div className='inspector-panel-head'>
            <h3>
              <ShoppingBag size={16} color='var(--primary)' /> Корзина покупателя
            </h3>
            <Badge tone={selection.length > 0 ? 'brand' : 'neutral'}>
              {selection.length} мест
            </Badge>
          </div>

          {selection.length === 0 ? (
            <p className='inspector-note'>Места ещё не выбраны на схеме выше.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {selection.map((seat) => (
                <li
                  key={seat.slot}
                  style={{
                    background: 'var(--card-subtle)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-md)',
                    padding: '8px 12px',
                    fontSize: 12.5,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong>{seat.zoneName}</strong> · Ряд {seat.row}, Место {seat.label}
                  </div>
                  <Badge tone='brand'>Выбрано</Badge>
                </li>
              ))}
            </ul>
          )}

          {reservation ? (
            <div style={{ marginTop: 8 }} role='status'>
              <Badge tone='brand'>Бронь</Badge>{' '}
              {formatMoney(reservation.totalAmountMinor, reservedCurrency)} · до{' '}
              {new Date(reservation.expiresAt).toLocaleTimeString('ru-RU')}
              <p className='inspector-note' style={{ fontSize: 11.5 }}>{reservation.reservationId}</p>
            </div>
          ) : null}

          {purchase ? (
            <div style={{ marginTop: 8 }} role='status'>
              <Badge tone='brand'>Заказ оплачен</Badge> билетов: {purchase.ticketIds.length}
              <p className='inspector-note' style={{ fontSize: 11.5 }}>{purchase.orderId}</p>
            </div>
          ) : null}

          {preview ? (
            <>
              <div style={{ marginTop: 8 }}>
                <Planned why='Предпросмотр конфигурации не привязан к показу: цен и брони в нём нет'>
                  Оформить заказ ({selection.length} шт.)
                </Planned>
              </div>
              <p className='inspector-note' style={{ fontSize: 11.5 }}>
                Выбор мест в предпросмотре не блокирует инвентарь. Для реальной продажи откройте режим
                «Продажи показа».
              </p>
            </>
          ) : (
            <p className='inspector-note' style={{ fontSize: 11.5 }}>
              Бронь и оплата выполняются внутри виджета; корзина отражает его события. Оплата тестовая.
            </p>
          )}
        </div>

        {/* Integration Code Snippet */}
        <div className='inspector-panel'>
          <div className='inspector-panel-head'>
            <h3>
              <Code2 size={16} color='var(--primary)' /> Код для встраивания
            </h3>
            <Button
              kind='studio'
              icon={copied ? <Check size={13} color='var(--success)' /> : <Copy size={13} />}
              onClick={copyCode}
            >
              {copied ? 'Скопировано!' : 'Копировать'}
            </Button>
          </div>
          <pre className='embed-code-box'>{embedCode}</pre>
        </div>

        {/* Iframe Event Log */}
        <div className='inspector-panel'>
          <div className='inspector-panel-head'>
            <h3>
              <Activity size={16} color='var(--primary)' /> Журнал postMessage
            </h3>
            <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
              Последние {events.length} событий
            </span>
          </div>

          {events.length === 0 ? (
            <p className='inspector-note'>События виджета пока не поступали.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
              {events.map((event) => (
                <div
                  key={event.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 12,
                    padding: '4px 8px',
                    background: 'var(--card-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--line-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                    <code style={{ color: 'var(--primary)', fontWeight: 600 }}>{event.type}</code>
                    <span style={{ color: 'var(--ink-secondary)', overflowWrap: 'anywhere' }}>{event.detail}</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>{event.at}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import type { SeatingConfigurationResult } from '@tickets/seating';
import { CopyId } from './journey-id';
import { eventsRequest, pageItems, type EventCard, type EventListItem, type ReferenceItem } from './events-api';
import { useLab } from './state';
import { Button, Note, Problem, Section, Select, Spinner, Text } from './ui';

export interface JourneyStatus {
  hall: boolean; event: boolean; moderation: 'draft' | 'pending' | 'approved' | 'rejected';
  published: boolean; sales: boolean; embed: boolean; reason?: string;
}

/** Статусы считаются по серверным данным, а не по последней нажатой кнопке. */
export function deriveJourneyStatus(configurations: Pick<SeatingConfigurationResult, 'versions'>[], card: EventCard | null, pricingVersion: number | null): JourneyStatus {
  const hall = configurations.some((item) => (item.versions.configurationRevision ?? 0) > 0);
  const event = Boolean(card && (card.occurrences.length > 0 || (card.pendingChange?.attributes?.occurrences?.length ?? 0) > 0));
  const latest = card?.moderation?.[0];
  const rejected = card?.status === 'Rejected' || latest?.decision === 'Reject' || latest?.decision === 'RequestChanges' || latest?.decision === 'Block';
  const pending = card?.status === 'PendingModeration' || card?.pendingChange?.status === 'AwaitingModeration' || card?.pendingChange?.status === 'AwaitingAutomatedCheck';
  const approved = card?.status === 'Approved' || card?.pendingChange?.status === 'Approved' || card?.status === 'Published';
  const moderation = rejected ? 'rejected' : approved ? 'approved' : pending ? 'pending' : 'draft';
  const published = card?.status === 'Published' || Boolean(card?.isPublished);
  const sales = published && (pricingVersion ?? 0) > 0;
  return { hall, event, moderation, published, sales, embed: sales, reason: rejected ? latest?.reason ?? undefined : undefined };
}

interface JourneyProps {
  selectedEventId: string;
  selectedOccurrenceId: string;
  onSelect: (eventId: string, occurrenceId: string) => void;
  onHalls: () => void;
  onSales: () => void;
  onEmbed: () => void;
}

export function JourneyPage({ selectedEventId, selectedOccurrenceId, onSelect, onHalls, onSales, onEmbed }: JourneyProps) {
  const { api, connection } = useLab();
  const [configurations, setConfigurations] = useState<SeatingConfigurationResult[]>([]);
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [card, setCard] = useState<EventCard | null>(null);
  const [pricingVersion, setPricingVersion] = useState<number | null>(null);
  const [venues, setVenues] = useState<ReferenceItem[]>([]);
  const [categories, setCategories] = useState<ReferenceItem[]>([]);
  const [venueId, setVenueId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('Тестовое событие');
  const [description, setDescription] = useState('Проверка схемы зала и продажи билетов.');
  const [start, setStart] = useState(() => {
    const date = new Date(Date.now() + 48 * 60 * 60 * 1000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T18:00`;
  });
  const [duration, setDuration] = useState('120');
  const [language, setLanguage] = useState<'Ru' | 'Hy' | 'En'>('Ru');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async (eventId = selectedEventId, occurrenceId = selectedOccurrenceId) => {
    setBusy(true);
    setError(null);
    try {
      const [configPage, eventPage, venuePage, categoryPage] = await Promise.all([
        api.listConfigurations({ limit: 200 }),
        eventsRequest<{ items: EventListItem[] }>(connection, '/api/events?limit=200'),
        eventsRequest<{ items: ReferenceItem[] }>(connection, '/api/public/venues?limit=200&language=Ru'),
        eventsRequest<{ items: ReferenceItem[] }>(connection, '/api/public/event-categories?limit=200&language=Ru'),
      ]);
      setConfigurations(configPage.items);
      const list = pageItems(eventPage);
      setEvents(list);
      setVenues(pageItems(venuePage));
      setCategories(pageItems(categoryPage));
      const actualEventId = eventId && list.some((item) => item.id === eventId) ? eventId : '';
      if (!actualEventId) { setCard(null); setPricingVersion(null); return; }
      const nextCard = await eventsRequest<EventCard>(connection, `/api/events/${actualEventId}`);
      setCard(nextCard);
      const actualOccurrenceId = nextCard.occurrences.some((item) => item.id === occurrenceId) ? occurrenceId : nextCard.occurrences[0]?.id ?? '';
      if (actualOccurrenceId !== occurrenceId) onSelect(actualEventId, actualOccurrenceId);
      if (actualOccurrenceId) {
        try {
          const layout = await eventsRequest<{ pricingVersion: number }>(connection, `/api/occurrences/${actualOccurrenceId}/layout`);
          setPricingVersion(layout.pricingVersion);
        } catch (reason) {
          if (reason && typeof reason === 'object' && 'status' in reason && reason.status === 404) setPricingVersion(null);
          else throw reason;
        }
      } else setPricingVersion(null);
    } catch (reason) { setError(reason); }
    finally { setBusy(false); }
  }, [api, connection, onSelect, selectedEventId, selectedOccurrenceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function perform(action: () => Promise<unknown>, eventId = selectedEventId) {
    setBusy(true); setError(null);
    try { await action(); await refresh(eventId, ''); }
    catch (reason) { setError(reason); setBusy(false); }
  }

  async function createEvent() {
    const startDate = new Date(start);
    const minutes = Number(duration);
    if (!venueId || !categoryId || !title.trim() || !description.trim() || !Number.isFinite(startDate.getTime()) || startDate.getTime() <= Date.now() || !Number.isInteger(minutes) || minutes < 1 || minutes > 43200) {
      setError(new Error('Заполните площадку, категорию, название, описание, будущую дату и продолжительность от 1 до 43200 минут.'));
      return;
    }
    let createdId = '';
    await perform(async () => {
      const startsAt = startDate.toISOString();
      const result = await eventsRequest<{ id: string }>(connection, '/api/events', 'POST', {
        venueId, categoryId, title: title.trim(), description: description.trim(), startsAt,
        durationMinutes: minutes, sourceLanguage: language, format: 'Seated', isTest: false,
      });
      createdId = result.id;
      onSelect(createdId, '');
      await eventsRequest(connection, `/api/events/${createdId}`, 'PATCH', {
        occurrences: [{ startsAt, endsAt: new Date(startDate.getTime() + minutes * 60_000).toISOString() }],
      });
    }, createdId);
    if (createdId) await refresh(createdId, '');
  }

  async function addOccurrence() {
    if (!card) return;
    const startDate = new Date(start);
    const minutes = Number(duration);
    if (!Number.isFinite(startDate.getTime()) || startDate.getTime() <= Date.now() || !Number.isInteger(minutes) || minutes < 1 || minutes > 43200) {
      setError(new Error('Укажите будущую дату и продолжительность от 1 до 43200 минут.'));
      return;
    }
    await perform(() => eventsRequest(connection, `/api/events/${card.id}`, 'PATCH', {
      occurrences: [{ startsAt: startDate.toISOString(), endsAt: new Date(startDate.getTime() + minutes * 60_000).toISOString() }],
    }));
  }

  const status = deriveJourneyStatus(configurations, card, pricingVersion);
  const steps = [
    { title: 'Схема зала', ready: status.hall, blocked: false, hint: status.hall ? 'Сохранённая редакция есть.' : 'Создайте зал и сохраните хотя бы одну зону.' },
    { title: 'Событие и показ', ready: status.event, blocked: !status.hall, hint: !status.hall ? 'Сначала сохраните схему зала.' : status.event ? 'Расписание показа добавлено.' : 'Создайте или выберите событие и добавьте показ.' },
    { title: 'Модерация', ready: status.moderation === 'approved', blocked: !status.event, hint: !status.event ? 'Сначала создайте событие и показ.' : status.moderation === 'pending' ? 'На проверке: дождитесь администратора. Режим «Администратор» → «Модерация».' : status.moderation === 'approved' ? 'Одобрено.' : status.moderation === 'rejected' ? `Отклонено: ${status.reason || 'причина не указана'}` : 'Черновик: отправьте на проверку.' },
    { title: 'Публикация', ready: status.published, blocked: status.moderation !== 'approved', hint: status.published ? 'Событие опубликовано.' : status.moderation !== 'approved' ? 'Сначала дождитесь одобрения модерации.' : 'Теперь событие можно опубликовать.' },
    { title: 'Схема и цены показа', ready: status.sales, blocked: !status.published || !selectedOccurrenceId, hint: !status.published ? 'Сначала опубликуйте событие.' : !selectedOccurrenceId ? 'Сначала дождитесь появления ID показа.' : status.sales ? 'Компоновка привязана, цена применена.' : 'Привяжите схему и примените ценовой шаблон.' },
    { title: 'Встраивание', ready: status.embed, blocked: !status.sales, hint: !status.sales ? 'Сначала настройте схему и цены показа.' : 'Передайте ID показа разработчику сайта.' },
  ];

  return <Section title='Путь до продаж' description='Проверяйте каждый шаг по данным API. Учебное событие проходит обычную модерацию, чтобы проверить весь путь.' action={<Button onClick={() => void refresh()} disabled={busy} icon={<RefreshCw size={15} />}>Обновить статус</Button>}>
    <Problem error={error} />{busy ? <Spinner label='Обновляем данные…' /> : null}
    <ol className='journey-steps'>{steps.map((step, index) => <li key={step.title} className={`journey-step ${step.ready ? 'done' : ''} ${step.blocked ? 'blocked' : ''}`}>
      <span className='journey-marker'>{step.ready ? <CheckCircle2 size={21} /> : <Circle size={21} />}</span>
      <div className='journey-body'><h2>{index + 1}. {step.title}</h2><p>{step.hint}</p>
        {index === 0 ? <Button onClick={onHalls}>Открыть залы</Button> : null}
        {index === 1 ? <div className='journey-controls'>
          <Select label='Моё событие' value={selectedEventId} placeholder='Выберите событие' options={events.map((item) => ({ value: item.id, title: `${item.title || 'Без названия'} · ${item.status}` }))} onChange={(id) => { onSelect(id, ''); void refresh(id, ''); }} />
          {card ? <CopyId label='ID события' value={card.id} /> : null}
          {card?.occurrences.length ? <Select label='Показ' value={selectedOccurrenceId} placeholder='Выберите показ' options={card.occurrences.map((item) => ({ value: item.id, title: new Date(item.startsAt).toLocaleString('ru-RU') }))} onChange={(id) => { onSelect(selectedEventId, id); void refresh(selectedEventId, id); }} /> : null}
          {selectedOccurrenceId ? <CopyId label='ID показа' value={selectedOccurrenceId} /> : null}
          {card && !status.event && card.status === 'Draft' ? <details><summary>Добавить показ к выбранному событию</summary><div className='journey-form'>
            <Text label='Дата и время начала показа' type='datetime-local' value={start} onChange={setStart} />
            <Text label='Продолжительность, минут' type='number' value={duration} onChange={setDuration} />
            <Button kind='primary' disabled={busy} onClick={() => void addOccurrence()}>Добавить показ</Button>
          </div></details> : null}
          <details><summary>Создать тестовое событие</summary><div className='journey-form'>
            <Select label='Площадка' value={venueId} placeholder='Выберите площадку' options={venues.map((item) => ({ value: item.id, title: item.name }))} onChange={setVenueId} />
            <Select label='Категория' value={categoryId} placeholder='Выберите категорию' options={categories.map((item) => ({ value: item.id, title: item.name }))} onChange={setCategoryId} />
            <Text label='Название' value={title} onChange={setTitle} maxLength={200} /><Text label='Описание' value={description} onChange={setDescription} maxLength={8000} />
            <Text label='Дата и время начала' type='datetime-local' value={start} onChange={setStart} /><Text label='Продолжительность, минут' type='number' value={duration} onChange={setDuration} />
            <Select label='Язык' value={language} options={[{ value: 'Ru', title: 'Русский' }, { value: 'Hy', title: 'Армянский' }, { value: 'En', title: 'Английский' }]} onChange={setLanguage} />
            <Button kind='primary' disabled={!status.hall || busy} onClick={() => void createEvent()}>Создать событие и показ</Button>
          </div></details>
        </div> : null}
        {index === 2 && card ? <Button kind='primary' disabled={step.blocked || busy || status.moderation === 'pending' || status.moderation === 'approved'} onClick={() => void perform(() => eventsRequest(connection, `/api/events/${card.id}/moderation-requests`, 'POST'))}>Отправить на модерацию</Button> : null}
        {index === 3 && card ? <Button kind='primary' disabled={step.blocked || busy || status.published} onClick={() => void perform(() => eventsRequest(connection, `/api/events/${card.id}/publication`, 'POST'))}>Опубликовать</Button> : null}
        {index === 4 ? <Button disabled={step.blocked} onClick={onSales}>Открыть «Показ: продажи»</Button> : null}
        {index === 5 ? <><Button disabled={step.blocked} onClick={onEmbed}>Инструкция по встраиванию</Button>{selectedOccurrenceId ? <CopyId label='ID показа' value={selectedOccurrenceId} /> : null}</> : null}
      </div></li>)}</ol>
    {card?.pendingChange?.status === 'Approved' && !card.occurrences.length ? <Note tone='info'>Показ появится в карточке после публикации события. Обновите статус после публикации.</Note> : null}
  </Section>;
}

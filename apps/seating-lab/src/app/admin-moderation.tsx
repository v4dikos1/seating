import { useCallback, useEffect, useState } from 'react';
import { CopyId } from './journey-id';
import { decisionBody, eventsRequest, pageItems, type ModerationCard, type ModerationDecision, type ModerationItem } from './events-api';
import { useLab } from './state';
import { Button, Note, Problem, Section, Text } from './ui';

export function AdminModerationPage() {
  const { connection } = useLab();
  const [search, setSearch] = useState('');
  const [unclaimedOnly, setUnclaimedOnly] = useState(false);
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [card, setCard] = useState<ModerationCard | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [approved, setApproved] = useState(false);

  const refresh = useCallback(async (selectedId?: string) => {
    setBusy(true); setError(null);
    try {
      const query = new URLSearchParams({ limit: '200', searchQuery: search.trim(), unclaimedOnly: String(unclaimedOnly) });
      const result = await eventsRequest<{ items: ModerationItem[] }>(connection, `/api/admin/events/moderation-requests?${query}`);
      setItems(pageItems(result));
      if (selectedId) setCard(await eventsRequest<ModerationCard>(connection, `/api/admin/events/moderation-requests/${selectedId}`));
    } catch (reason) { setError(reason); }
    finally { setBusy(false); }
  }, [connection, search, unclaimedOnly]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function open(id: string) {
    setBusy(true); setError(null); setApproved(false);
    try { setCard(await eventsRequest<ModerationCard>(connection, `/api/admin/events/moderation-requests/${id}`)); }
    catch (reason) { setError(reason); }
    finally { setBusy(false); }
  }

  async function claim() {
    if (!card) return;
    setBusy(true); setError(null);
    try {
      await eventsRequest(connection, `/api/admin/events/moderation-requests/${card.id}/claim`, 'POST');
      await refresh(card.id);
    } catch (reason) { setError(reason); setBusy(false); }
  }

  async function decide(decision: ModerationDecision) {
    if (!card) return;
    if (decision === 'Reject' && !reason.trim()) { setError(new Error('Укажите причину отклонения.')); return; }
    setBusy(true); setError(null);
    try {
      await eventsRequest(connection, `/api/admin/events/moderation-requests/${card.id}/decision`, 'POST', decisionBody(decision, reason));
      setApproved(decision === 'Approved');
      setCard({ ...card, decision, reason: decision === 'Reject' ? reason.trim() : null });
      await refresh();
    } catch (reason) { setError(reason); setBusy(false); }
  }

  return <Section title='Модерация событий' description='Очередь заявок организаторов. После одобрения передайте ID события и показов организатору.' action={<Button disabled={busy} onClick={() => void refresh(card?.id)}>Обновить очередь</Button>}>
    <Problem error={error} />
    <div className='moderation-filters'><Text label='Поиск по названию' value={search} onChange={setSearch} /><label><input type='checkbox' checked={unclaimedOnly} onChange={(event) => setUnclaimedOnly(event.target.checked)} /> Только свободные</label></div>
    {items.length ? <ul className='moderation-list'>{items.map((item) => <li key={item.id}>
      <button type='button' onClick={() => void open(item.id)}>{item.title} · {item.eventStatus}{item.claimedBy ? ' · в работе' : ' · свободна'}</button>
      <CopyId label='ID события' value={item.eventId} />
    </li>)}</ul> : <Note tone='info'>В очереди нет заявок для выбранного фильтра.</Note>}
    {card ? <div className='inspector-panel moderation-card'>
      <h2>Заявка на проверку</h2>
      <CopyId label='ID заявки' value={card.id} /><CopyId label='ID события' value={card.eventId} />
      <p>Статус события: {card.eventStatus}. {card.organizer?.legalName || card.organizer?.name || ''}</p>
      <h3>{card.proposedContent?.title || 'Название не указано'}</h3>
      <p>{card.proposedContent?.description || 'Описание не указано'}</p>
      {card.proposedAttributes?.occurrences?.length ? <p>Показы в проверяемой редакции: {card.proposedAttributes.occurrences.map((item) => new Date(item.startsAt).toLocaleString('ru-RU')).join(', ')}</p> : null}
      {card.proposedAttributes?.occurrences?.filter((item) => item.occurrenceId).map((item) => <CopyId key={item.occurrenceId} label='ID показа' value={item.occurrenceId as string} />)}
      {card.claimedBy ? <p>Заявка взята в работу модератором до {card.claimExpiresAt ? new Date(card.claimExpiresAt).toLocaleString('ru-RU') : 'истечения срока'}.</p> : <Button disabled={busy || Boolean(card.decision)} onClick={() => void claim()}>Взять в работу</Button>}
      {!card.decision ? <div className='moderation-actions'>
        <Button kind='primary' disabled={busy || !card.claimedBy} onClick={() => void decide('Approved')}>Одобрить</Button>
        <Text label='Причина отклонения' value={reason} onChange={setReason} maxLength={1000} />
        <Button kind='danger' disabled={busy || !card.claimedBy || !reason.trim()} onClick={() => void decide('Reject')}>Отклонить с причиной</Button>
      </div> : null}
      {approved ? <Note tone='info'>Одобрено: организатор теперь может опубликовать событие. После публикации ID показов появятся в режиме «Организатор» → «Путь до продаж»; до публикации API модерации их не выдаёт.</Note> : null}
      {card.decision === 'Reject' ? <Note tone='warn'>Отклонено: {card.reason}</Note> : null}
    </div> : null}
  </Section>;
}

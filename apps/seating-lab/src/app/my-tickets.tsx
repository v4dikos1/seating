import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Ticket } from 'lucide-react';
import { SalesApi, formatMoney, type MyTicketResult } from '@tickets/seating';

import { useLab, useRequest } from './state';
import { Button, Empty, Problem, Section, Spinner } from './ui';

const pageSize = 50;

export function MyTicketsPage() {
  const { connection } = useLab();
  const api = useMemo(() => new SalesApi({
    baseUrl: connection.baseUrl,
    token: connection.token,
  }), [connection.baseUrl, connection.token]);
  const { busy, error, run } = useRequest();
  const [tickets, setTickets] = useState<MyTicketResult[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback((nextOffset: number) => {
    void run(async () => {
      const page = await api.getMyTickets({ offset: nextOffset, limit: pageSize,
        sortBy: 'IssuedAt', sortDirection: 'Desc' });
      setTickets(page.items);
      setTotal(page.totalItems);
      setOffset(nextOffset);
      setLoaded(true);
      return page;
    });
  }, [api, run]);

  useEffect(() => { load(0); }, [load]);

  return (
    <Section title='Мои билеты' description='Выданные билеты текущего покупателя.'>
      <Button kind='secondary' icon={<RefreshCw size={14} />} disabled={busy}
        onClick={() => load(offset)}>Обновить</Button>
      <Problem error={error} />
      {busy && !loaded ? <Spinner label='Загружаем билеты…' /> : null}
      {loaded && tickets.length === 0 ? (
        <Empty title='Билетов пока нет' icon={<Ticket size={40} />}>
          Оплатите заказ в виджете и обновите список.
        </Empty>
      ) : null}
      {tickets.length > 0 ? (
        <div className='table-wrap' style={{ marginTop: 16 }}>
          <table className='table'>
            <thead><tr><th>Показ</th><th>Место</th><th>Цена</th><th>Билет</th></tr></thead>
            <tbody>{tickets.map((ticket) => (
              <tr key={ticket.ticketId}>
                <td>{ticket.occurrence.name}<br />
                  <span className='inspector-note'>
                    {new Date(ticket.occurrence.startsAt).toLocaleString('ru-RU')}
                  </span>
                </td>
                <td>{ticket.address.zone.name}
                  {ticket.address.row ? ` · ряд ${ticket.address.row}` : ''}
                  {ticket.address.table ? ` · стол ${ticket.address.table}` : ''}
                  {` · место ${ticket.address.seat}`}
                </td>
                <td>{formatMoney(ticket.price.amountMinor, ticket.price.currency)}</td>
                <td><span className='mono'>{ticket.ticketId}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      {total > pageSize ? (
        <div className='showcase-toolbar' style={{ marginTop: 12 }}>
          <Button kind='secondary' disabled={busy || offset === 0}
            onClick={() => load(Math.max(0, offset - pageSize))}>Назад</Button>
          <span>{offset + 1}–{Math.min(offset + pageSize, total)} из {total}</span>
          <Button kind='secondary' disabled={busy || offset + pageSize >= total}
            onClick={() => load(offset + pageSize)}>Далее</Button>
        </div>
      ) : null}
    </Section>
  );
}

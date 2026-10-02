import { useMemo, useState } from 'react';
import { SalesApi, type OrderResult } from '@tickets/seating';

import { SessionExpired, SignIn } from '../app/auth';
import { useLab } from '../app/state';
import { Note, Section } from '../app/ui';
import { MockPaymentPanel } from '../shared/mock-payment-panel';

/**
 * Отдельная страница для `paymentPageUrl`, открытого вне виджета (в Development backend
 * отдаёт именно этот адрес — README). Виджет показывает ту же панель встроенной, без ухода
 * со страницы; сюда покупатель попадает, только если ссылку открыли напрямую.
 */
function readPaymentAttemptId(): string {
  return new URLSearchParams(window.location.search).get('paymentAttemptId') ?? '';
}

export function MockPaymentPage() {
  const { signedIn, expired, connection } = useLab();
  const [order, setOrder] = useState<OrderResult | null>(null);
  const paymentAttemptId = useMemo(readPaymentAttemptId, []);
  const api = useMemo(
    () => new SalesApi({ baseUrl: connection.baseUrl, token: connection.token }),
    [connection.baseUrl, connection.token],
  );

  if (!signedIn) return <SignIn />;

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: '0 16px' }}>
      <Section
        title='Тестовая оплата'
        description='Открыта отдельно от виджета: тот же исход можно выбрать и не покидая встраивание.'
      >
        {!paymentAttemptId ? (
          <Note tone='warn'>
            В адресе страницы нет <code>paymentAttemptId</code> — открыть её напрямую нечем оплатить.
          </Note>
        ) : order ? (
          order.status === 'Paid' ? (
            <Note tone='ok'>
              Оплата подтверждена: заказ {order.orderId} оплачен, билетов — {order.tickets.length}.
            </Note>
          ) : (
            <Note tone='warn'>
              Заказ {order.orderId}: статус «{order.status}». Вернитесь в приложение, из которого
              открыта эта страница, чтобы продолжить.
            </Note>
          )
        ) : (
          <MockPaymentPanel api={api} paymentAttemptId={paymentAttemptId} onOutcome={setOrder} />
        )}
      </Section>
      {expired ? <SessionExpired /> : null}
    </div>
  );
}

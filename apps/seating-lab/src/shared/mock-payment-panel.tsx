import { useState } from 'react';
import {
  SalesApi, SeatingApiError, formatMoney, newIdempotencyKey,
  type MockPaymentOutcome, type OrderResult, type SalesCurrency,
} from '@tickets/seating';

/**
 * Тестовая платёжная страница (спецификация продаж, `Application.Sales.Orders.
 * SubmitMockPaymentOutcome`): эмулирует обратный вызов поставщика тремя кнопками вместо
 * настоящей формы оплаты. Используется и внутри виджета (не покидая iframe), и на отдельной
 * стендовой странице `mock-payment.html` — для случая, когда `paymentPageUrl` открыт отдельно.
 */
export interface MockPaymentPanelProps {
  api: SalesApi;
  paymentAttemptId: string;
  onOutcome: (order: OrderResult) => void;
  amountMinor?: number;
  currency?: SalesCurrency;
}

const outcomes: { value: MockPaymentOutcome; label: string; busyLabel: string; kind: 'success' | 'decline' | 'expire' }[] = [
  { value: 'Succeeded', label: 'Успех', busyLabel: 'Подтверждаем…', kind: 'success' },
  { value: 'Declined', label: 'Отказ', busyLabel: 'Отклоняем…', kind: 'decline' },
  { value: 'Expired', label: 'Истечь', busyLabel: 'Истекаем…', kind: 'expire' },
];

export function MockPaymentPanel({ api, paymentAttemptId, onOutcome, amountMinor, currency }: MockPaymentPanelProps) {
  const [busy, setBusy] = useState<MockPaymentOutcome | null>(null);
  const [error, setError] = useState('');

  async function submit(outcome: MockPaymentOutcome) {
    setBusy(outcome);
    setError('');
    try {
      const order = await api.submitMockOutcome(paymentAttemptId, { outcome }, newIdempotencyKey());
      onOutcome(order);
    } catch (reason) {
      setError(
        reason instanceof SeatingApiError
          ? reason.message
          : reason instanceof Error
            ? reason.message
            : String(reason),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className='mock-payment-panel'>
      <div className='mock-payment-banner' role='alert'>
        ТЕСТОВАЯ ОПЛАТА — деньги не списываются
      </div>
      {amountMinor !== undefined ? (
        <p className='mock-payment-amount'>
          К оплате: {formatMoney(amountMinor, currency ?? 'AMD')}
        </p>
      ) : null}
      <p className='mock-payment-hint'>
        Тестовый адаптер эмулирует поставщика платежа: выберите исход, как будто это сделал бы
        покупатель на настоящей странице оплаты.
      </p>
      <div className='mock-payment-actions'>
        {outcomes.map((item) => (
          <button
            key={item.value}
            type='button'
            className={'mock-payment-' + item.kind}
            disabled={busy !== null}
            onClick={() => submit(item.value)}
          >
            {busy === item.value ? item.busyLabel : item.label}
          </button>
        ))}
      </div>
      {error ? <p className='mock-payment-error' role='alert'>{error}</p> : null}
    </div>
  );
}

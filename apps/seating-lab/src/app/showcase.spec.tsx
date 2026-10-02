import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WidgetContext, WidgetMessage } from '@tickets/seating';

const stub = vi.hoisted(() => {
  const listConfigurations = vi.fn();
  return {
    props: null as null | { src: string; context: WidgetContext; onEvent: (message: WidgetMessage) => void },
    listConfigurations,
    // Одна и та же ссылка на каждый рендер: иначе эффект загрузки залов зацикливается.
    lab: {
      api: { listConfigurations },
      connection: { baseUrl: 'http://api.test', token: 'jwt' },
      signedIn: true,
    },
  };
});

vi.mock('@tickets/seating', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tickets/seating')>()),
  SeatingWidget: (props: { src: string; context: WidgetContext; onEvent: (message: WidgetMessage) => void }) => {
    stub.props = props;
    return <div data-testid='widget' />;
  },
}));

vi.mock('./state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./state')>()),
  useLab: () => stub.lab,
}));

const { ShowcasePage } = await import('./showcase');

const occurrence = '11111111-1111-4111-8111-111111111111';
const envelope = { protocolVersion: 2, instanceId: 'i', requestId: 'r' };

async function emit(message: Record<string, unknown>) {
  await act(async () => { stub.props?.onEvent({ ...envelope, ...message } as WidgetMessage); });
}

afterEach(() => {
  stub.props = null;
  stub.listConfigurations.mockReset();
});

describe('Showcase', () => {
  it('opens the sales widget for an occurrence with the connection of the lab', () => {
    render(<ShowcasePage />);
    expect(screen.queryByTestId('widget')).toBeNull();
    expect(screen.queryByText(/следующем этапе/)).toBeNull();

    const open = screen.getByRole('button', { name: 'Открыть' });
    expect((open as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Идентификатор показа'), { target: { value: 'nope' } });
    expect(screen.getByText('Нужен UUID показа.')).toBeTruthy();
    expect((open as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Идентификатор показа'), { target: { value: occurrence } });
    fireEvent.click(open);

    expect(screen.getByTestId('widget')).toBeTruthy();
    expect(stub.props?.context).toMatchObject({
      apiRoot: 'http://api.test', occurrenceId: occurrence, testMode: true, token: 'jwt',
    });
    expect(stub.listConfigurations).not.toHaveBeenCalled();
  });

  it('puts the widget on the UI origin and keeps the API on its separate origin in embed code', () => {
    render(<ShowcasePage />);
    fireEvent.change(screen.getByLabelText('Идентификатор показа'), { target: { value: occurrence } });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));

    const widgetUrl = new URL('/widget.html', window.location.origin).href;
    const snippet = document.querySelector('.embed-code-box')?.textContent;
    expect(stub.props?.src).toBe('/widget.html');
    expect(snippet).toContain(`src="${widgetUrl}"`);
    expect(snippet).toContain("apiRoot: 'http://api.test'");
    expect(snippet).not.toContain('src="http://api.test/widget.html"');
  });

  it('reflects reservation, expiry and purchase events in the cart and the log', async () => {
    render(<ShowcasePage />);
    fireEvent.change(screen.getByLabelText('Идентификатор показа'), { target: { value: occurrence } });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));

    await emit({
      type: 'reservationCreated', reservationId: 'res-1', expiresAt: '2030-01-01T00:10:00Z',
      totalAmountMinor: 9000, currency: 'AMD',
    });
    expect(screen.getByText('Бронь')).toBeTruthy();
    expect(screen.getByText('res-1', { selector: 'p' })).toBeTruthy();
    expect(screen.getAllByText('reservationCreated').length).toBe(1);

    await emit({ type: 'expired', reservationId: 'res-1' });
    expect(screen.queryByText('Бронь')).toBeNull();
    expect(screen.getAllByText('expired').length).toBe(1);

    await emit({
      type: 'reservationCreated', reservationId: 'res-2', expiresAt: '2030-01-01T00:10:00Z',
      totalAmountMinor: 4500, currency: 'AMD',
    });
    await emit({ type: 'purchaseCompleted', orderId: 'ord-1', ticketIds: ['t-1', 't-2'] });

    expect(screen.queryByText('Бронь')).toBeNull();
    expect(screen.getByText('Заказ оплачен')).toBeTruthy();
    expect(screen.getByText('ord-1', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText(/заказ ord-1 оплачен · билетов: 2/)).toBeTruthy();
  });

  it('keeps the configuration preview as a separate mode', async () => {
    stub.listConfigurations.mockResolvedValue({
      items: [{ id: 'hall-1', name: 'Зал', versions: { configurationVersion: 1, configurationRevision: 3 } }],
    });
    render(<ShowcasePage />);

    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Предпросмотр конфигурации' })); });

    expect(await screen.findByTestId('widget')).toBeTruthy();
    expect(stub.props?.context).toMatchObject({ configurationId: 'hall-1', revision: 3 });
    expect(stub.props?.context.occurrenceId).toBeUndefined();
    expect(screen.queryByLabelText('Идентификатор показа')).toBeNull();
    expect(document.querySelector('.embed-code-box')?.textContent)
      .toContain(`src="${new URL('/widget.html', window.location.origin).href}"`);
  });
});

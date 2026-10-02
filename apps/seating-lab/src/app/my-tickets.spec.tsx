import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { MyTicketsPage } from './my-tickets';
import { LabProvider } from './state';

afterEach(() => vi.unstubAllGlobals());

it('shows the server occurrence and seat address without a searchQuery parameter', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => JSON.stringify({ baseUrl: 'https://api.test', token: 'jwt' }),
    setItem: () => undefined,
  });
  const urls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    urls.push(url);
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
      items: [{
        ticketId: 'ticket-1', orderId: 'order-1', positionId: 'seat-1', productId: 'product-1',
        occurrence: { id: 'occ-1', name: 'Концерт', startsAt: '2026-10-02T14:00:00Z' },
        address: { zone: { id: 'zone-1', code: 'A', name: 'Партер' }, row: '3', table: null, seat: '12' },
        price: { amountMinor: 4500, currency: 'AMD' }, status: 'Issued', issuedAt: '2026-10-01T12:00:00Z',
      }], totalItems: 1, offset: 0, limit: 50,
    })) } as Response);
  });

  render(<LabProvider><MyTicketsPage /></LabProvider>);

  expect(await screen.findByText('Концерт')).toBeTruthy();
  expect(screen.getByText('Партер · ряд 3 · место 12')).toBeTruthy();
  expect(screen.getByText('45 AMD')).toBeTruthy();
  expect(urls).toEqual([
    'https://api.test/api/me/tickets?offset=0&limit=50&sortBy=IssuedAt&sortDirection=Desc',
  ]);
});

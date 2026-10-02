import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminModerationPage } from './admin-moderation';
import { LabProvider } from './state';

const requests: { path: string; method: string; body?: unknown; key?: string }[] = [];
const card = {
  id: 'request-1', eventId: 'event-1', eventStatus: 'PendingModeration',
  claimedBy: null as string | null, claimExpiresAt: null, decision: null as string | null, reason: null,
  proposedContent: { title: 'Концерт', description: 'Описание' }, proposedAttributes: { occurrences: [] },
};

beforeEach(() => {
  requests.length = 0;
  card.claimedBy = null;
  card.decision = null;
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ baseUrl: 'http://localhost:5057', token: 'test' }), setItem: vi.fn() });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.replace('http://localhost:5057', '');
    const method = init?.method || 'GET';
    const headers = init?.headers as Record<string, string> | undefined;
    requests.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, key: headers?.['Idempotency-Key'] });
    if (path.endsWith('/claim')) card.claimedBy = 'admin-1';
    const body = path.endsWith('/decision') ? { eventId: 'event-1' }
      : path.includes('/moderation-requests/request-1') ? card
        : { items: card.decision ? [] : [{ id: card.id, eventId: card.eventId, title: 'Концерт', eventStatus: card.eventStatus, claimedBy: card.claimedBy }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
  });
});
afterEach(() => vi.unstubAllGlobals());

async function showCard() {
  render(<LabProvider><AdminModerationPage /></LabProvider>);
  await screen.findByRole('button', { name: /Концерт · PendingModeration/ });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Концерт · PendingModeration/ })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' })); });
}

describe('Модерация', () => {
  it('отправляет Approved без причины и с ключом повтора', async () => {
    await showCard();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Одобрить' })); });
    const call = requests.find((item) => item.path.endsWith('/decision'));
    expect(call).toMatchObject({ method: 'POST', body: { decision: 'Approved' } });
    expect(call?.key).toBeTruthy();
  });

  it('отправляет Reject с причиной', async () => {
    await showCard();
    fireEvent.change(screen.getByLabelText('Причина отклонения'), { target: { value: 'Исправьте описание' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отклонить с причиной' })); });
    expect(requests.find((item) => item.path.endsWith('/decision'))?.body).toEqual({ decision: 'Reject', reason: 'Исправьте описание' });
  });
});

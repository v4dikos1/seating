import { SeatingApiError } from '@tickets/seating';

export interface EventListItem {
  id: string;
  title: string | null;
  status: string;
  pendingChangeStatus?: string | null;
  pendingModerationRequestId?: string | null;
}

export interface EventOccurrence { id: string; startsAt: string; endsAt?: string | null; timeZone?: string }
export interface EventCard {
  id: string;
  status: string;
  isPublished: boolean;
  pendingChange: { status: string; attributes?: { occurrences?: { startsAt: string; endsAt: string | null }[] } } | null;
  moderation: { id: string; decision: string | null; reason: string | null }[];
  occurrences: EventOccurrence[];
}
export interface ReferenceItem { id: string; name: string }
export interface ModerationItem {
  id: string; eventId: string; title: string; eventStatus: string;
  claimedBy: string | null; claimExpiresAt: string | null;
}
export interface ModerationCard {
  id: string; eventId: string; eventStatus: string; claimedBy: string | null;
  claimExpiresAt: string | null; decision: string | null; reason: string | null;
  proposedContent: { title?: string; description?: string } | null;
  proposedAttributes: { occurrences?: { startsAt: string; endsAt: string | null; occurrenceId?: string | null }[] } | null;
  organizer?: { legalName?: string; name?: string };
}
export type ModerationDecision = 'Approved' | 'Reject';

export interface EventsConnection { baseUrl: string; token: string }

/** RFC 7807 разбирается так же, как в клиенте схемы зала. */
export async function eventsRequest<T>(connection: EventsConnection, path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(connection.baseUrl.replace(/\/+$/, '') + path, {
      method,
      headers: {
        Accept: 'application/json, application/problem+json',
        Authorization: `Bearer ${connection.token}`,
        ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (reason) {
    throw new SeatingApiError(0, null, `Сеть недоступна: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
  const raw = await response.text();
  let parsed: unknown = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  if (!response.ok) throw new SeatingApiError(response.status, parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null, `HTTP ${response.status}`);
  return parsed as T;
}

export function pageItems<T>(value: T[] | { items?: T[] }): T[] {
  return Array.isArray(value) ? value : value?.items ?? [];
}

export function decisionBody(decision: ModerationDecision, reason: string): { decision: ModerationDecision; reason?: string } {
  return decision === 'Approved' ? { decision } : { decision, reason: reason.trim() };
}

export class RateLimiterDO implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/check') {
      return new Response('Not found', { status: 404 });
    }

    const limit = Number(url.searchParams.get('limit') ?? '30');
    const windowSec = Number(url.searchParams.get('window') ?? '60');
    const now = Date.now();
    const cutoff = now - windowSec * 1000;

    const existing = ((await this.state.storage.get<number[]>('timestamps')) ?? []).filter((ts) => ts > cutoff);
    if (existing.length >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((existing[0]! + windowSec * 1000 - now) / 1000));
      return Response.json({ allowed: false, remaining: 0, retryAfterSec }, { status: 429 });
    }

    existing.push(now);
    await this.state.storage.put('timestamps', existing);
    return Response.json({ allowed: true, remaining: Math.max(0, limit - existing.length), retryAfterSec: 0 });
  }
}

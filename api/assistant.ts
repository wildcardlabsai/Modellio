import Anthropic from '@anthropic-ai/sdk';
import { parseRequest, planDesign } from '../src/ai/assistantService';

/**
 * POST /api/assistant — the AI Design Assistant (Vercel serverless function).
 * Needs ANTHROPIC_API_KEY in the server environment; without it, replies 503 and the
 * Studio panel says the assistant is not set up. The key is never sent to the browser.
 */

// Best-effort per-instance limit so a public deployment cannot be used to burn the key.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 20;
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_REQUESTS;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'The AI assistant is not set up on this server.' });
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (limited(ip)) return json(429, { error: 'Too many requests. Please wait a few minutes.' });
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 200_000) return json(413, { error: 'Request too large.' });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Request body must be JSON.' });
  }
  const req = parseRequest(body);
  if (typeof req === 'string') return json(400, { error: req });
  try {
    const result = await planDesign(new Anthropic(), req);
    return result.status === 200 ? json(200, { plan: result.plan }) : json(result.status, { error: result.error });
  } catch {
    return json(500, { error: 'The assistant failed unexpectedly. Please try again.' });
  }
}

export function GET(): Response {
  return json(process.env.ANTHROPIC_API_KEY ? 200 : 503, { configured: !!process.env.ANTHROPIC_API_KEY });
}

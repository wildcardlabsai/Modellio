import Anthropic from '@anthropic-ai/sdk';
import { LIMITS, PLAN_SCHEMA, validatePlan, type Plan, type SceneObjectSummary } from './plan';

/**
 * Server side of the AI Design Assistant (used by /api/assistant). Runs only on the server:
 * the API key comes from the ANTHROPIC_API_KEY environment variable and never reaches the
 * browser. Relative imports only, so the serverless bundler can follow them.
 */

export const ASSISTANT_MODEL = 'claude-opus-5-5';

const SYSTEM = `You are the design assistant inside MODELLIO, a browser CAD app for 3D printing.
You change the user's design only by returning a plan of commands in the required JSON format. You cannot run code.

Coordinates and units
- Millimetres. Z is up; the build plate is the XY plane at z = 0, centred on the origin.
- "position" is the centre of an object's bounding box. An object of height h resting on the plate has z = h / 2.
- "size" is [width (X), depth (Y), height (Z)]. "rotation" is [x, y, z] in degrees, applied X then Y then Z.
- Text: "height" is the letter height, "depth" its thickness; text lies flat on the XY plane.

Commands
- add_shape: shapes are box, cylinder, sphere, cone, pyramid, roof, torus, tube, wedge, halfSphere, polygon, star, capsule, gear, paraboloid. hole: true makes it a hole that cuts whatever it is combined with.
- add_text, set_size, set_position, set_rotation, set_color (#RRGGBB), set_hole, delete.
- combine: joins targets into one group. union = merge; subtract = keep the FIRST target and cut all the others out of it; intersect = keep only the overlap. Holes inside a union cut too.
- Give every new object a short unique ref (e.g. "base", "hole1"); later commands target refs or the ids of existing objects listed in the scene. A combined object's parts can no longer be targeted; target the combine's ref instead.

Rules
- Use realistic sizes for printable parts (walls at least 1.2 mm; holes for an M3 screw about 3.4 mm).
- Keep new objects clear of existing ones unless the user wants them combined or placed relative to them.
- If the request is too vague to model, or asks for something these commands cannot make, set needsClarification to true, ask one short question in reply, and return no commands.
- Otherwise reply in one or two plain sentences saying what the plan does. Never claim to have done anything beyond the commands.`;

export interface AssistantRequest {
  prompt: string;
  scene: SceneObjectSummary[];
  /** Earlier turns, oldest first (plain text only). */
  history?: { role: 'user' | 'assistant'; text: string }[];
}

export type AssistantResult = { status: 200; plan: Plan } | { status: 400 | 422 | 502 | 503; error: string };

/** Check the shape of the incoming request body before anything is sent to the model. */
export function parseRequest(body: unknown): AssistantRequest | string {
  if (typeof body !== 'object' || body === null) return 'Request body must be JSON.';
  const { prompt, scene, history } = body as Record<string, unknown>;
  if (typeof prompt !== 'string' || !prompt.trim()) return 'Say what you would like to make or change.';
  if (prompt.length > LIMITS.prompt) return `Please keep requests under ${LIMITS.prompt} characters.`;
  if (!Array.isArray(scene) || scene.length > LIMITS.scene) return 'The design summary is missing or too large.';
  for (const o of scene) {
    if (typeof o !== 'object' || o === null || typeof (o as SceneObjectSummary).id !== 'string') return 'The design summary is invalid.';
  }
  const h = Array.isArray(history) ? history.slice(-6) : [];
  for (const t of h) {
    if (
      typeof t !== 'object' ||
      t === null ||
      (t.role !== 'user' && t.role !== 'assistant') ||
      typeof t.text !== 'string' ||
      t.text.length > 2000
    )
      return 'The conversation history is invalid.';
  }
  return { prompt: prompt.trim(), scene: scene as SceneObjectSummary[], history: h as AssistantRequest['history'] };
}

/** Ask the model for a plan and validate it against the scene. */
export async function planDesign(client: Anthropic, req: AssistantRequest): Promise<AssistantResult> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of req.history ?? []) messages.push({ role: t.role, content: t.text });
  messages.push({
    role: 'user',
    content: `Current design (top-level objects):\n${JSON.stringify(req.scene)}\n\nRequest: ${req.prompt}`,
  });
  // The API needs the first message to come from the user.
  while (messages.length && messages[0].role !== 'user') messages.shift();

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 16000,
      // If the main model declines a request, the API retries on its default fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA as unknown as Record<string, unknown> } },
      messages,
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError)
      return { status: 503, error: 'The assistant is not set up correctly on this server (API key rejected).' };
    if (err instanceof Anthropic.RateLimitError)
      return { status: 503, error: 'The assistant is busy right now. Please try again in a minute.' };
    if (err instanceof Anthropic.APIError)
      return { status: 502, error: `The assistant service returned an error (${err.status ?? 'network'}).` };
    throw err;
  }

  if (response.stop_reason === 'refusal') return { status: 422, error: 'The assistant could not help with that request.' };
  if (response.stop_reason === 'max_tokens')
    return { status: 422, error: 'That request needs too many steps. Try asking for one part at a time.' };
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: 502, error: 'The assistant returned something that was not a plan. Please try again.' };
  }
  const checked = validatePlan(
    raw,
    req.scene.map((o) => o.id),
  );
  if (!checked.ok) return { status: 422, error: `The assistant's plan was rejected: ${checked.errors.slice(0, 3).join(' ')}` };
  return { status: 200, plan: checked.plan };
}

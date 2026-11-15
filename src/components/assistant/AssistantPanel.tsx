import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Send, Sparkles, X } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { describeCommand, LIMITS, validatePlan, type Plan } from '@/ai/plan';
import { executePlan, sceneSummary } from '@/ai/execute';

type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; plan?: Plan; state?: 'pending' | 'applied' | 'discarded'; steps?: string[] }
  | { role: 'error'; text: string };

type Availability = 'checking' | 'ready' | 'not-configured' | 'unavailable';

const EXAMPLES = [
  'A 60 × 40 mm plate, 3 mm thick, with a 4 mm hole in each corner',
  'A pencil cup 70 mm across and 100 mm tall with 2 mm walls',
  'Make the selected shapes red',
];

/**
 * AI Design Assistant. Describe a part; the assistant answers with a plan of ordinary Studio
 * commands, shown step by step. Nothing changes until you press Apply, and the whole plan is
 * one undo step. The model runs on the server (/api/assistant); no key lives in the browser.
 */
export function AssistantPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<Availability>('checking');
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/assistant', { method: 'GET' })
      .then(async (r) => {
        const ok = r.headers.get('content-type')?.includes('application/json');
        if (!live) return;
        setAvailable(r.ok && ok ? 'ready' : r.status === 503 && ok ? 'not-configured' : 'unavailable');
      })
      .catch(() => live && setAvailable('unavailable'));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [turns, busy]);

  const names = () => {
    const doc = useEditor.getState().doc;
    return Object.fromEntries(Object.values(doc.objects).map((o) => [o.id, o.name]));
  };

  const send = async (prompt: string) => {
    const p = prompt.trim();
    if (!p || busy) return;
    setText('');
    setBusy(true);
    const history = turns
      .filter((t): t is Extract<Turn, { role: 'user' | 'assistant' }> => t.role === 'user' || t.role === 'assistant')
      .slice(-6)
      .map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: 'user', text: p }]);
    try {
      const scene = sceneSummary();
      const selection = useEditor.getState().selection;
      const withSelection = selection.length ? `${p}\n(Selected object ids: ${selection.join(', ')})` : p;
      const r = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: withSelection, scene, history }),
      });
      const body = (await r.json().catch(() => null)) as { plan?: unknown; error?: string } | null;
      if (!r.ok || !body?.plan) {
        if (r.status === 503) setAvailable('not-configured');
        throw new Error(
          body?.error ?? (r.status === 404 ? 'The assistant service is not available here.' : `The assistant failed (${r.status}).`),
        );
      }
      // Check again here: the design may have changed while we waited.
      const checked = validatePlan(
        body.plan,
        scene.map((o) => o.id),
      );
      if (!checked.ok) throw new Error(`The plan was rejected: ${checked.errors.slice(0, 2).join(' ')}`);
      const plan = checked.plan;
      const n = names();
      for (const c of plan.commands) {
        if (c.op === 'add_shape') n[c.ref] = c.name ?? c.shape;
        else if (c.op === 'add_text') n[c.ref] = `text “${c.text}”`;
        else if (c.op === 'combine') n[c.ref] = c.name ?? 'the combined part';
      }
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          text: plan.reply,
          plan: plan.commands.length ? plan : undefined,
          state: plan.commands.length ? 'pending' : undefined,
          steps: plan.commands.map((c) => describeCommand(c, n)),
        },
      ]);
    } catch (e) {
      setTurns((t) => [...t, { role: 'error', text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (index: number, apply: boolean) => {
    const turn = turns[index];
    if (turn.role !== 'assistant' || !turn.plan) return;
    if (apply) {
      const current = useEditor.getState().doc;
      const checked = validatePlan(turn.plan, current.rootIds);
      if (!checked.ok) {
        setTurns((t) => [...t, { role: 'error', text: 'The design has changed since this plan was made. Ask again.' }]);
        return;
      }
      const r = await executePlan(
        checked.plan,
        `Assistant: ${turn.plan.commands.length} step${turn.plan.commands.length === 1 ? '' : 's'}`,
      );
      if (!r.ok) {
        setTurns((t) => [...t, { role: 'error', text: `Nothing was changed: ${r.error}` }]);
        return;
      }
      useEditor.getState().requestFrame();
    }
    setTurns((t) => t.map((x, i) => (i === index && x.role === 'assistant' ? { ...x, state: apply ? 'applied' : 'discarded' } : x)));
  };

  return (
    <aside
      className="flex w-[300px] shrink-0 flex-col border-r border-line bg-panel"
      aria-label="AI assistant"
      data-testid="assistant-panel"
    >
      <div className="border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Sparkles size={16} className="text-violet" /> AI Design Assistant
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Describe a part or a change. You’ll see each step before anything changes, and Ctrl+Z undoes the whole thing. Requests are planned
          by Anthropic’s Claude API.
        </p>
      </div>
      <div ref={list} className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite" data-testid="assistant-log">
        {available === 'not-configured' && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900" data-testid="assistant-unavailable">
            The assistant isn’t set up on this server yet. The site owner needs to add an <code>ANTHROPIC_API_KEY</code> to the server
            environment. Everything else in the Studio works without it.
          </p>
        )}
        {available === 'unavailable' && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900" data-testid="assistant-unavailable">
            The assistant service isn’t reachable from this copy of MODELLIO. Everything else in the Studio works without it.
          </p>
        )}
        {available === 'ready' && !turns.length && (
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-ink-2">Try:</p>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => void send(ex)}
                className="block w-full rounded-lg border border-line px-3 py-2 text-left text-[12px] text-ink-2 hover:border-brand hover:text-brand-ink"
              >
                {ex}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <p key={i} className="ml-6 rounded-xl rounded-br-sm bg-brand px-3 py-2 text-[13px] text-white">
              {t.text}
            </p>
          ) : t.role === 'error' ? (
            <p key={i} className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-800" role="alert" data-testid="assistant-error">
              {t.text}
            </p>
          ) : (
            <div key={i} className="mr-4 rounded-xl rounded-bl-sm bg-canvas px-3 py-2 text-[13px] text-ink" data-testid="assistant-reply">
              <p>{t.text}</p>
              {t.steps && t.steps.length > 0 && (
                <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-[12px] text-ink-2" data-testid="assistant-steps">
                  {t.steps.map((s, k) => (
                    <li key={k}>{s}</li>
                  ))}
                </ol>
              )}
              {t.state === 'pending' && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void decide(i, true)}
                    className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand text-[12px] font-semibold text-white hover:bg-brand-600"
                    data-testid="assistant-apply"
                  >
                    <Check size={14} /> Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => void decide(i, false)}
                    className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line text-[12px] font-medium text-ink-2 hover:bg-panel"
                  >
                    <X size={14} /> Discard
                  </button>
                </div>
              )}
              {t.state === 'applied' && <p className="mt-2 text-[12px] font-medium text-emerald-700">Applied · Ctrl+Z to undo</p>}
              {t.state === 'discarded' && <p className="mt-2 text-[12px] text-muted">Discarded</p>}
            </div>
          ),
        )}
        {busy && (
          <p className="flex items-center gap-2 text-[12px] text-muted">
            <Loader2 size={14} className="animate-spin" /> Planning…
          </p>
        )}
      </div>
      <form
        className="border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label className="sr-only" htmlFor="assistant-input">
          Describe what to make or change
        </label>
        <textarea
          id="assistant-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send(text);
            }
          }}
          maxLength={LIMITS.prompt - 200}
          rows={3}
          disabled={available !== 'ready' || busy}
          placeholder={available === 'ready' ? 'e.g. a 50 mm cube with a 20 mm hole through it' : 'Assistant unavailable'}
          className="w-full resize-none rounded-lg border border-line px-3 py-2 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-canvas"
          data-testid="assistant-input"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted">Ctrl+Enter to send</span>
          <button
            type="submit"
            disabled={available !== 'ready' || busy || !text.trim()}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            data-testid="assistant-send"
          >
            <Send size={13} /> Send
          </button>
        </div>
      </form>
    </aside>
  );
}

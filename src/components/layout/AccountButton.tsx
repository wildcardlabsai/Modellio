import { useEffect, useState } from 'react';
import { Cloud, LogOut, Mail } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { cloudConfigured, getSupabase } from '@/cad/serialization/supabaseRepository';

/**
 * Sign-in for cloud projects (Supabase magic link). Only rendered when the app
 * is built with Supabase settings; otherwise projects stay in this browser.
 */
export function AccountButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudConfigured()) return;
    void getSupabase()
      .then((sb) => sb.auth.getUser())
      .then(({ data }) => setEmail((data.user as { email?: string } | null)?.email ?? null))
      .catch(() => setEmail(null));
  }, []);

  if (!cloudConfigured()) return null;

  const signIn = async () => {
    setError(null);
    const sb = await getSupabase();
    const { error: e } = await sb.auth.signInWithOtp({
      email: input.trim(),
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (e) setError(e.message);
    else setSent(true);
  };

  return (
    <Popover
      align="right"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-white/80 hover:bg-white/10"
        >
          <Cloud size={17} /> <span className="hidden md:inline">{email ? 'Synced' : 'Sign in'}</span>
        </button>
      )}
    >
      {() =>
        email ? (
          <div className="w-64">
            <p className="text-[13px] text-ink">
              Signed in as <strong>{email}</strong>. Projects are saved to your account.
            </p>
            <button
              type="button"
              onClick={async () => {
                await (await getSupabase()).auth.signOut();
                location.reload();
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-line py-2 text-[13px] font-medium text-[#344054] hover:bg-canvas"
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>
        ) : (
          <div className="w-72">
            <p className="text-[13px] font-semibold text-ink">Save projects to your account</p>
            <p className="mt-1 text-[12px] text-muted">We email you a sign-in link — no password needed.</p>
            {sent ? (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">Check your inbox for the sign-in link.</p>
            ) : (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void signIn();
                }}
              >
                <input
                  type="email"
                  required
                  aria-label="Email address"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="you@example.com"
                  className="min-w-0 flex-1 rounded-lg border border-line px-2.5 py-1.5 text-[13px] outline-none focus:border-brand"
                />
                <button type="submit" aria-label="Send sign-in link" className="rounded-lg bg-brand px-3 text-white hover:bg-brand-600">
                  <Mail size={15} />
                </button>
              </form>
            )}
            {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
          </div>
        )
      }
    </Popover>
  );
}

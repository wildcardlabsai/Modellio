import { ArrowLeft } from 'lucide-react';
import { StudioLink } from '@/components/ui/platform';
import { cloudConfigured } from '@/cad/serialization/supabaseRepository';

/** What MODELLIO does with your data — written from how the app actually works. */
export default function PrivacyPage() {
  const cloud = cloudConfigured();
  return (
    <div className="bg-aurora dark-scroll surface-night h-full overflow-y-auto" data-testid="privacy">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <StudioLink to="home" className="inline-flex items-center gap-1.5 text-[14px] text-haze hover:text-white">
          <ArrowLeft size={16} /> Back to MODELLIO
        </StudioLink>
        <h1 className="mt-6 text-[36px] font-bold tracking-tight text-white">Privacy Policy</h1>
        <div className="mt-6 space-y-6 text-[15px] leading-relaxed text-haze [&_h2]:mb-2 [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:text-white">
          <section>
            <h2>Your designs stay on your device</h2>
            <p>
              Projects, maker designs and the asset library are saved in your browser’s own storage (IndexedDB and local storage) on this
              device. Files you open — STL, OBJ, 3MF, STEP, SVG and pictures — are processed in your browser and are not uploaded.
            </p>
          </section>
          <section>
            <h2>Share links</h2>
            <p>
              A share link contains the design itself, encoded in the part of the address after “#”. Browsers do not send that part to any
              server; whoever you give the link to can view the design.
            </p>
          </section>
          <section>
            <h2>Accounts and cloud projects</h2>
            <p>
              {cloud
                ? 'If you sign in, your email address is used to send a sign-in link, and projects are saved to your account so they are available on other devices. Signing out keeps them in your account; they are not shared with anyone.'
                : 'This version of MODELLIO has no accounts: nothing about you or your designs is stored on a server.'}
            </p>
          </section>
          <section>
            <h2>AI assistant</h2>
            <p>
              When you use the AI design assistant (where it is switched on), the request you type and a summary of the objects in your
              design are sent through MODELLIO’s server to Anthropic’s Claude API to plan the model. Nothing is sent unless you press Send,
              and nothing changes in your design until you press Apply.
            </p>
          </section>
          <section>
            <h2>Cookies and tracking</h2>
            <p>MODELLIO sets no advertising or tracking cookies. Browser storage is used only to keep your work and preferences.</p>
          </section>
          <section>
            <h2>Deleting your data</h2>
            <p>
              Delete projects from the dashboard, or clear this site’s data in your browser settings to remove everything stored on this
              device.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

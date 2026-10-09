import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import { SignUp1 } from '../components/ui/modern-stunning-sign-up.jsx';
import TopoField from '@/components/ui/topo-field.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { useLocation } from 'react-router-dom';
import { oauthStartUrl, sanitizeNextPath } from '@/lib/api.js';

export default function SignUp() {
  const { signUp } = useAuth();
  const location = useLocation();
  const next = sanitizeNextPath(location.state?.from);
  const startOAuth = (provider) => {
    window.location.assign(oauthStartUrl(provider, next));
  };
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <TopoField className="absolute inset-0" opacity={0.85} />
      </div>
      <Navbar />
      {/* pt accounts for the fixed navbar height */}
      <main className="container-page relative z-10 flex min-h-[calc(100vh-7rem)] items-center justify-center pt-28 pb-16">
        <div className="w-full">
          <SignUp1
            brandName="Troxe Hosting"
            onSignUp={({ username, email, password }) => signUp({ name: username, email, password })}
            onGoogleSignIn={() => startOAuth('google')}
            onDiscordSignIn={() => startOAuth('discord')}
          />
        </div>
      </main>
      <div className="relative z-10">
        <Footer className="bg-transparent" />
      </div>
    </div>
  );
}

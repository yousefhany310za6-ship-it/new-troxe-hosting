import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import { SignUp1 } from '../components/ui/modern-stunning-sign-up.jsx';
import { AntiGravityCanvas } from '../components/ui/particle-effect-for-hero.jsx';
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
      <AntiGravityCanvas />
      <Navbar />
      {/* pt accounts for the fixed navbar height */}
      <main className="container-page relative z-10 pt-28 pb-16">
        <div className="overflow-hidden rounded-xl">
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

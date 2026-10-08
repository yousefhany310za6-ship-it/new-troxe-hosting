import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import { SignIn1 } from '../components/ui/modern-stunning-sign-in.jsx';
import { AntiGravityCanvas } from '../components/ui/particle-effect-for-hero.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { TwoFactorChallenge } from '@/components/TwoFactorChallenge.jsx';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { oauthStartUrl, sanitizeNextPath } from '@/lib/api.js';

export default function SignIn() {
  const { signIn, completeMfaChallenge } = useAuth();
  const location = useLocation();
  const next = sanitizeNextPath(location.state?.from);
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [mfaError, setMfaError] = useState(null);

  const startOAuth = (provider) => {
    window.location.assign(oauthStartUrl(provider, next));
  };

  const handleSignIn = async ({ email, password }) => {
    setMfaError(null);
    const result = await signIn(email, password);
    if (result?.mfaRequired) {
      setMfaChallenge({ challengeId: result.challengeId, expiresAt: result.expiresAt });
    }
  };

  const handleMfaComplete = async (challengeId, code) => {
    setMfaError(null);
    try {
      await completeMfaChallenge(challengeId, code);
      window.location.assign(next || '/dashboard');
    } catch (err) {
      setMfaError(err.message);
    }
  };

  if (mfaChallenge) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
        <AntiGravityCanvas />
        <Navbar />
        <main className="container-page relative z-10 flex min-h-screen items-center justify-center pt-28 pb-16">
          <div className="w-full max-w-md rounded-xl border border-hairline bg-card p-8">
            <TwoFactorChallenge
              challengeId={mfaChallenge.challengeId}
              onComplete={handleMfaComplete}
              onCancel={() => { setMfaChallenge(null); setMfaError(null); }}
              error={mfaError}
            />
          </div>
        </main>
        <div className="relative z-10">
          <Footer className="bg-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <AntiGravityCanvas />
      <Navbar />
      {/* pt accounts for the fixed navbar height */}
      <main className="container-page relative z-10 pt-28 pb-16">
        <div className="overflow-hidden rounded-xl">
          <SignIn1
            brandName="Troxe Hosting"
            onSignIn={handleSignIn}
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

import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import { SignIn1 } from '../components/ui/modern-stunning-sign-in.jsx';
import { AntiGravityCanvas } from '../components/ui/particle-effect-for-hero.jsx';
import { useAuth } from '@/context/AuthContext.jsx';

export default function SignIn() {
  const { signIn } = useAuth();
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <AntiGravityCanvas />
      <Navbar />
      {/* pt accounts for the fixed navbar height */}
      <main className="container-page relative z-10 pt-28 pb-16">
        <div className="overflow-hidden rounded-xl">
          <SignIn1 brandName="Troxe Hosting" onSignIn={({ email, password }) => signIn(email, password)} />
        </div>
      </main>
      <div className="relative z-10">
        <Footer className="bg-transparent" />
      </div>
    </div>
  );
}

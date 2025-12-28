import { useState, useEffect } from 'react';
import { Lock } from 'lucide-react';

// SHA-256 hash of the password - the actual password is NOT in the code
const PASSWORD_HASH = '9a23b43ceb032a56d19f09727f1165dc8a0beee65fbdfaf0a9eb1b0b441748cc';

const AUTH_KEY = 'paper-lab-authenticated';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

interface AuthGateProps {
  children: React.ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    // Check if already authenticated in this session
    const authenticated = sessionStorage.getItem(AUTH_KEY);
    setIsAuthenticated(authenticated === 'true');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsChecking(true);
    setError('');

    try {
      const hash = await hashPassword(password);
      if (hash === PASSWORD_HASH) {
        sessionStorage.setItem(AUTH_KEY, 'true');
        setIsAuthenticated(true);
      } else {
        setError('Incorrect password');
        setPassword('');
      }
    } catch {
      setError('Authentication error');
    } finally {
      setIsChecking(false);
    }
  };

  // Still checking auth state
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="w-8 h-8 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated - show login
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] p-4">
        <div className="w-full max-w-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl p-8 shadow-lg">
            <div className="w-14 h-14 mx-auto mb-6 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center">
              <Lock className="w-7 h-7 text-[var(--text-muted)]" />
            </div>
            
            <h1 className="text-xl font-semibold text-[var(--text-primary)] text-center mb-2">
              Paper Lab
            </h1>
            <p className="text-sm text-[var(--text-muted)] text-center mb-6">
              Enter password to continue
            </p>

            <form onSubmit={handleSubmit}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoFocus
                className="w-full px-4 py-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]/20 mb-4"
              />
              
              {error && (
                <p className="text-sm text-red-500 text-center mb-4">{error}</p>
              )}

              <button
                type="submit"
                disabled={isChecking || !password}
                className="w-full py-3 rounded-xl bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isChecking ? 'Checking...' : 'Unlock'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated - show app
  return <>{children}</>;
}


import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  User,
  Mail,
  Lock,
  LogOut,
  Trash2,
  Check,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export function Account() {
  const navigate = useNavigate();
  const { user, signOut, updateProfile, updatePassword } = useAuth();
  
  const [name, setName] = useState(user?.user_metadata?.name || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    setError(null);
    
    const { error } = await updateProfile({ name });
    
    if (error) {
      setError(error.message);
    } else {
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    }
    
    setIsSavingProfile(false);
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    
    setIsSavingPassword(true);
    setError(null);
    
    const { error } = await updatePassword(newPassword);
    
    if (error) {
      setError(error.message);
    } else {
      setPasswordSaved(true);
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSaved(false), 2000);
    }
    
    setIsSavingPassword(false);
  };

  const handleSignOut = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[var(--bg-primary)]/80 backdrop-blur-xl border-b border-[var(--border-default)]">
        <div className="max-w-xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-full hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-[var(--text-secondary)]" />
          </button>
          <h1 className="text-base font-semibold text-[var(--text-primary)]">
            Account
          </h1>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-6 py-6">
        <div className="space-y-6">
          {/* User Info Card */}
          <section className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl p-5 animate-fade-in">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-full bg-[var(--accent-primary)] flex items-center justify-center">
                <span className="text-xl font-semibold text-[var(--bg-primary)]">
                  {name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  {name || 'User'}
                </h2>
                <p className="text-sm text-[var(--text-secondary)]">
                  {user?.email}
                </p>
              </div>
            </div>

            {/* Name Field */}
            <div className="space-y-4">
              <div>
                <label htmlFor="display-name" className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] mb-2">
                  <User className="w-3.5 h-3.5" />
                  Display Name
                </label>
                <input
                  id="display-name"
                  name="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-2.5 text-sm rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-colors"
                  autoComplete="name"
                />
              </div>

              <div>
                <label htmlFor="email-display" className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] mb-2">
                  <Mail className="w-3.5 h-3.5" />
                  Email
                </label>
                <input
                  id="email-display"
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="w-full px-4 py-2.5 text-sm rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] opacity-60 cursor-not-allowed"
                />
              </div>

              <button
                onClick={handleSaveProfile}
                disabled={isSavingProfile}
                className="w-full py-2.5 bg-[var(--accent-primary)] text-[var(--bg-primary)] rounded-xl font-medium text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isSavingProfile ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : profileSaved ? (
                  <>
                    <Check className="w-4 h-4" />
                    Saved
                  </>
                ) : (
                  'Save Profile'
                )}
              </button>
            </div>
          </section>

          {/* Change Password */}
          <section 
            className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl p-5 animate-fade-in"
            style={{ animationDelay: '0.1s' }}
          >
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] mb-4">
              <Lock className="w-4 h-4" />
              Change Password
            </h3>

            <div className="space-y-4">
              <input
                id="new-password"
                name="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="w-full px-4 py-2.5 text-sm rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-colors"
                autoComplete="new-password"
              />
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full px-4 py-2.5 text-sm rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-colors"
                autoComplete="new-password"
              />

              <button
                onClick={handleChangePassword}
                disabled={isSavingPassword || !newPassword || !confirmPassword}
                className="w-full py-2.5 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-xl font-medium text-sm flex items-center justify-center gap-2 hover:bg-[var(--bg-secondary)] transition-colors disabled:opacity-50"
              >
                {isSavingPassword ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : passwordSaved ? (
                  <>
                    <Check className="w-4 h-4" />
                    Password Updated
                  </>
                ) : (
                  'Update Password'
                )}
              </button>
            </div>
          </section>

          {/* Error Message */}
          {error && (
            <div className="p-4 rounded-xl bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/20 animate-fade-in">
              <p className="text-sm text-[var(--accent-red)]">{error}</p>
            </div>
          )}

          {/* Sign Out */}
          <section 
            className="animate-fade-in"
            style={{ animationDelay: '0.2s' }}
          >
            <button
              onClick={handleSignOut}
              disabled={isLoggingOut}
              className="w-full py-3 bg-[var(--bg-card)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-xl font-medium text-sm flex items-center justify-center gap-2 hover:bg-[var(--bg-secondary)] transition-colors"
            >
              {isLoggingOut ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </>
              )}
            </button>
          </section>

          {/* Delete Account */}
          <section 
            className="animate-fade-in"
            style={{ animationDelay: '0.3s' }}
          >
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full py-3 text-[var(--accent-red)] text-sm font-medium hover:underline transition-colors"
              >
                Delete Account
              </button>
            ) : (
              <div className="p-4 rounded-xl bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/20 animate-scale-in">
                <div className="flex items-start gap-3 mb-4">
                  <AlertTriangle className="w-5 h-5 text-[var(--accent-red)] flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                      Delete your account?
                    </h4>
                    <p className="text-xs text-[var(--text-secondary)]">
                      This action cannot be undone. All your papers, notes, and projects will be permanently deleted.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-2 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg text-sm font-medium hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      // In production, this would call deleteAccount()
                      alert('Contact support to delete your account');
                    }}
                    className="flex-1 py-2 bg-[var(--accent-red)] text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

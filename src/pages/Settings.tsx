import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Palette,
  Save,
  Check,
  Info,
  BookOpen,
  User,
} from 'lucide-react';
import type { HighlightColor, AppSettings } from '../types';
import { getSettings, updateSettings } from '../lib/database';
import { useProject } from '../contexts/ProjectContext';
import { useAuth } from '../contexts/AuthContext';

const HIGHLIGHT_COLORS: { color: HighlightColor; bg: string; border: string }[] = [
  { color: 'yellow', bg: 'var(--highlight-yellow)', border: '#fbbf24' },
  { color: 'green', bg: 'var(--highlight-green)', border: '#22c55e' },
  { color: 'blue', bg: 'var(--highlight-blue)', border: '#3b82f6' },
  { color: 'red', bg: 'var(--highlight-red)', border: '#ef4444' },
  { color: 'purple', bg: 'var(--highlight-purple)', border: '#a855f7' },
];

export function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [settings, setSettings] = useState<AppSettings>({
    defaultHighlightColor: 'yellow',
    sidebarWidth: 320,
  });
  const [researchContext, setResearchContext] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { currentProject, isLoading: isProjectLoading } = useProject();

  useEffect(() => {
    if (isProjectLoading) return;

    const loadSettings = async () => {
      const loaded = await getSettings(currentProject?.id);
      setSettings(loaded);
      setResearchContext(loaded.researchContext || '');
      setIsLoading(false);
    };
    loadSettings();
  }, [currentProject, isProjectLoading]);

  const handleSave = async () => {
    const newSettings: AppSettings = {
      ...settings,
      researchContext: researchContext || undefined,
    };
    try {
      await updateSettings(newSettings, currentProject?.id);
      setSettings(newSettings);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  const handleColorChange = (color: HighlightColor) => {
    setSettings((prev) => ({ ...prev, defaultHighlightColor: color }));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[var(--bg-primary)]/80 backdrop-blur-xl border-b border-[var(--border-default)]">
        <div className="max-w-xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-full hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-[var(--text-secondary)]" />
            </button>
            <h1 className="text-base font-semibold text-[var(--text-primary)]">
              Settings
            </h1>
          </div>

          <button
            onClick={handleSave}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            {isSaved ? (
              <>
                <Check className="w-4 h-4" />
                Saved
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save
              </>
            )}
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-6 py-6">
        <div className="space-y-6">
          {/* Account Section */}
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-[var(--accent-primary)] uppercase tracking-wide">
              Account
            </h2>

            <button
              onClick={() => navigate('/account')}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-4 flex items-center gap-4 hover:bg-[var(--bg-secondary)] transition-colors text-left"
            >
              <div className="w-12 h-12 rounded-full bg-[var(--accent-primary)] flex items-center justify-center flex-shrink-0">
                <span className="text-lg font-semibold text-[var(--bg-primary)]">
                  {user?.user_metadata?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {user?.user_metadata?.name || 'User'}
                </p>
                <p className="text-xs text-[var(--text-secondary)] truncate">
                  {user?.email}
                </p>
              </div>
              <User className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
          </div>

          {/* Project Settings */}
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-[var(--accent-primary)] uppercase tracking-wide">
              Project Settings
            </h2>

            {/* Research Context Section */}
            <section className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-4">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary)]/15 flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-[var(--accent-primary)]" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    Research Context
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    Help AI autofill understand your research focus
                  </p>
                </div>
              </div>

              <textarea
                value={researchContext}
                onChange={(e) => setResearchContext(e.target.value)}
                placeholder="Describe your research area, questions, methodology, and what you're looking for in papers..."
                className="w-full text-sm p-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-default)] resize-none"
                rows={6}
              />

              <div className="flex items-start gap-2 mt-3 p-2.5 bg-[var(--bg-secondary)] rounded-lg">
                <Info className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0 mt-0.5" />
                <p className="text-xs text-[var(--text-muted)]">
                  This context helps AI autofill extract relevant information from papers (methodology, conclusions, limitations) based on your research interests.
                </p>
              </div>
            </section>

            {/* Default Highlight Color */}
            <section className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-4">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--accent-orange)]/15 flex items-center justify-center">
                  <Palette className="w-4 h-4 text-[var(--accent-orange)]" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    Default Highlight Color
                  </h2>
                </div>
              </div>

              <div className="flex gap-2">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.color}
                    onClick={() => handleColorChange(c.color)}
                    className={`w-10 h-10 rounded-lg transition-all ${settings.defaultHighlightColor === c.color
                      ? 'ring-2 ring-offset-2 ring-[var(--accent-primary)] ring-offset-[var(--bg-card)]'
                      : ''
                      }`}
                    style={{ backgroundColor: c.border }}
                  />
                ))}
              </div>
            </section>

            {/* About Section */}
            <section className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                About
              </h2>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Paper Lab is a collaborative research paper reader. Your data is securely stored in the cloud and synced across devices.
              </p>
              <div className="mt-3 pt-3 border-t border-[var(--border-muted)]">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide font-medium">
                  Features
                </p>
                <ul className="mt-1.5 space-y-1 text-xs text-[var(--text-secondary)]">
                  <li>• Multi-color PDF highlighting</li>
                  <li>• Notes & annotations</li>
                  <li>• Reference tracking</li>
                  <li>• AI-powered autofill & insights</li>
                  <li>• Multi-project organization</li>
                </ul>
              </div>
              <div className="mt-3 pt-3 border-t border-[var(--border-muted)]">
                <p className="text-[10px] text-[var(--text-muted)]">
                  AI features powered by OpenAI
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div >
  );
}

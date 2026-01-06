import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Key,
  Palette,
  Save,
  Check,
  Info,
  BookOpen,
} from 'lucide-react';
import type { HighlightColor, AppSettings } from '../types';
import { getSettings, updateSettings } from '../lib/database';

const HIGHLIGHT_COLORS: { color: HighlightColor; bg: string; border: string }[] = [
  { color: 'yellow', bg: 'var(--highlight-yellow)', border: '#fbbf24' },
  { color: 'green', bg: 'var(--highlight-green)', border: '#22c55e' },
  { color: 'blue', bg: 'var(--highlight-blue)', border: '#3b82f6' },
  { color: 'red', bg: 'var(--highlight-red)', border: '#ef4444' },
  { color: 'purple', bg: 'var(--highlight-purple)', border: '#a855f7' },
];

export function Settings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettings>({
    defaultHighlightColor: 'yellow',
    sidebarWidth: 320,
  });
  const [apiKey, setApiKey] = useState('');
  const [researchContext, setResearchContext] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      const loaded = await getSettings();
      setSettings(loaded);
      setApiKey(loaded.openaiApiKey || '');
      setResearchContext(loaded.researchContext || '');
      setIsLoading(false);
    };
    loadSettings();
  }, []);

  const handleSave = async () => {
    const newSettings: AppSettings = {
      ...settings,
      openaiApiKey: apiKey || undefined,
      researchContext: researchContext || undefined,
    };
    await updateSettings(newSettings);
    setSettings(newSettings);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
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
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-[var(--accent-primary)] uppercase tracking-wide">
              Global Settings
            </h2>

            {/* API Key Section */}
            <section className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-4">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--accent-purple)]/15 flex items-center justify-center">
                  <Key className="w-4 h-4 text-[var(--accent-purple)]" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    OpenAI API Key
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    For AI features (optional)
                  </p>
                </div>
              </div>

              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full text-sm font-mono bg-[var(--bg-input)]"
              />

              <div className="flex items-start gap-2 mt-3 p-2.5 bg-[var(--bg-secondary)] rounded-lg">
                <Info className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0 mt-0.5" />
                <p className="text-xs text-[var(--text-muted)]">
                  Stored locally. Get key from{' '}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent-primary)] hover:underline"
                  >
                    OpenAI
                  </a>
                </p>
              </div>
            </section>

          </div>

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
                Paper Lab is a local-first research paper reader. All data is stored in your browser using IndexedDB.
              </p>
              <div className="mt-3 pt-3 border-t border-[var(--border-muted)]">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide font-medium">
                  Features
                </p>
                <ul className="mt-1.5 space-y-1 text-xs text-[var(--text-secondary)]">
                  <li>• Multi-color PDF highlighting</li>
                  <li>• Notes & annotations</li>
                  <li>• Reference tracking</li>
                  <li>• Tag organization</li>
                </ul>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div >
  );
}

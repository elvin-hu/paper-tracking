import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  StickyNote,
  FileText,
  ChevronRight,
} from 'lucide-react';
import type { Note, Paper, Highlight } from '../types';
import { getAllNotes, getAllPapers, getHighlightsByPaper } from '../lib/database';

const SCROLL_POSITION_KEY = 'notes-page-scroll';

interface NoteWithContext {
  note: Note;
  paper: Paper;
  highlight: Highlight | null;
}

// Color mapping for note cards - matching Reader sidebar
const HIGHLIGHT_COLORS: Record<string, { bg: string; bgDark: string; border: string; accent: string; dark: string; textDark: string; shadow: string }> = {
  yellow: { bg: '#fef9c3', bgDark: '#3d3522', border: '#fbbf24', accent: '#ca8a04', dark: '#78350f', textDark: '#fef3c7', shadow: 'rgba(180, 130, 20, 0.25)' },
  green: { bg: '#dcfce7', bgDark: '#1a3329', border: '#4ade80', accent: '#16a34a', dark: '#14532d', textDark: '#dcfce7', shadow: 'rgba(34, 160, 70, 0.25)' },
  blue: { bg: '#dbeafe', bgDark: '#1e2d3d', border: '#3b82f6', accent: '#2563eb', dark: '#1e3a5f', textDark: '#dbeafe', shadow: 'rgba(45, 100, 200, 0.25)' },
  red: { bg: '#fee2e2', bgDark: '#3d1f1f', border: '#f87171', accent: '#dc2626', dark: '#7f1d1d', textDark: '#fee2e2', shadow: 'rgba(200, 80, 80, 0.25)' },
  purple: { bg: '#f3e8ff', bgDark: '#2d1f3d', border: '#a855f7', accent: '#9333ea', dark: '#581c87', textDark: '#f3e8ff', shadow: 'rgba(140, 70, 200, 0.25)' },
};

export function NotesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [notesWithContext, setNotesWithContext] = useState<NoteWithContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupedNotes, setGroupedNotes] = useState<Map<string, NoteWithContext[]>>(new Map());

  // Dark mode detection
  const [isDarkMode, setIsDarkMode] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Save scroll position before navigating away
  const handleNoteClick = (note: NoteWithContext) => {
    sessionStorage.setItem(SCROLL_POSITION_KEY, window.scrollY.toString());
    navigate(`/reader/${note.paper.id}?highlight=${note.note.highlightId}`, { state: { from: '/notes' } });
  };

  // Restore scroll position on mount
  useEffect(() => {
    if (!loading) {
      const savedPosition = sessionStorage.getItem(SCROLL_POSITION_KEY);
      if (savedPosition) {
        // Small delay to ensure content is rendered
        setTimeout(() => {
          window.scrollTo(0, parseInt(savedPosition, 10));
        }, 100);
      }
    }
  }, [loading]);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const [notes, papers] = await Promise.all([
        getAllNotes(),
        getAllPapers(),
      ]);

      const paperMap = new Map<string, Paper>();
      papers.forEach(p => paperMap.set(p.id, p));

      // Get all highlights for papers that have notes
      const paperIds = [...new Set(notes.map(n => n.paperId))];
      const highlightsByPaper = new Map<string, Highlight[]>();

      await Promise.all(
        paperIds.map(async (paperId) => {
          const highlights = await getHighlightsByPaper(paperId);
          highlightsByPaper.set(paperId, highlights);
        })
      );

      // Build notes with context
      const enrichedNotes: NoteWithContext[] = notes
        .map(note => {
          const paper = paperMap.get(note.paperId);
          if (!paper) return null;

          const paperHighlights = highlightsByPaper.get(note.paperId) || [];
          const highlight = paperHighlights.find(h => h.id === note.highlightId) || null;

          return { note, paper, highlight };
        })
        .filter((n): n is NoteWithContext => n !== null)
        .sort((a, b) => new Date(b.note.createdAt).getTime() - new Date(a.note.createdAt).getTime());

      setNotesWithContext(enrichedNotes);

      // Group by paper
      const grouped = new Map<string, NoteWithContext[]>();
      enrichedNotes.forEach(n => {
        const existing = grouped.get(n.paper.id) || [];
        existing.push(n);
        grouped.set(n.paper.id, existing);
      });
      setGroupedNotes(grouped);
    } catch (error) {
      console.error('Error loading notes:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload notes when navigating back to this page
  useEffect(() => {
    loadNotes();
  }, [loadNotes, location.key]);

  const getColorScheme = (highlight: Highlight | null) => {
    if (!highlight) return HIGHLIGHT_COLORS.yellow;
    return HIGHLIGHT_COLORS[highlight.color] || HIGHLIGHT_COLORS.yellow;
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[var(--bg-primary)]/80 backdrop-blur-xl border-b border-[var(--border-default)]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-full hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-[var(--text-secondary)]" />
            </button>
            <div className="flex items-center gap-2">
              <StickyNote className="w-5 h-5 text-[var(--text-primary)]" />
              <h1 className="text-base font-semibold text-[var(--text-primary)]">
                All Notes
              </h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : notesWithContext.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center">
              <StickyNote className="w-8 h-8 text-[var(--text-muted)]" />
            </div>
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">
              No notes yet
            </h3>
            <p className="text-sm text-[var(--text-muted)]">
              Highlight text in your papers and add notes to see them here
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {Array.from(groupedNotes.entries()).map(([paperId, paperNotes]) => {
              const paper = paperNotes[0].paper;

              return (
                <div key={paperId}>
                  {/* Paper Header */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-[var(--text-muted)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {paper.title}
                      </h2>
                      {paper.authors && (
                        <p className="text-xs text-[var(--text-muted)] truncate">
                          {paper.authors}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-[var(--text-muted)] flex-shrink-0">
                      {paperNotes.length} {paperNotes.length === 1 ? 'note' : 'notes'}
                    </span>
                  </div>

                  {/* Notes Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {paperNotes.map((noteCtx) => {
                      const colors = getColorScheme(noteCtx.highlight);

                      return (
                        <button
                          key={noteCtx.note.id}
                          onClick={() => handleNoteClick(noteCtx)}
                          className="group text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] w-full"
                        >
                          {/* Sticky Note Card */}
                          <div
                            className="rounded-lg transition-shadow overflow-hidden"
                            style={{
                              backgroundColor: isDarkMode ? colors.bgDark : colors.bg,
                              boxShadow: `0 1px 3px ${colors.shadow}, 0 1px 2px ${colors.shadow}`,
                            }}
                          >
                            {/* Main content area */}
                            <div className="p-4 pb-3">
                              {/* Highlight text snippet - dark readable color */}
                              {noteCtx.highlight && (
                                <p
                                  className="text-[11px] leading-relaxed mb-3 line-clamp-3 italic"
                                  style={{
                                    color: isDarkMode ? colors.textDark : colors.dark,
                                    opacity: isDarkMode ? 0.7 : 1
                                  }}
                                >
                                  "{noteCtx.highlight.text}"
                                </p>
                              )}

                              {/* Note content - near black for emphasis */}
                              <p
                                className="text-sm leading-relaxed line-clamp-4 font-medium"
                                style={{ color: isDarkMode ? colors.textDark : 'var(--text-primary)' }}
                              >
                                {noteCtx.note.content}
                              </p>
                            </div>

                            {/* Footer with darker tint */}
                            <div
                              className="px-4 py-2.5 flex items-center justify-between"
                              style={{ backgroundColor: isDarkMode ? 'rgba(0,0,0,0.2)' : `${colors.border}20` }}
                            >
                              <span
                                className="text-[10px] font-medium"
                                style={{
                                  color: isDarkMode ? colors.textDark : colors.dark,
                                  opacity: isDarkMode ? 0.8 : 1
                                }}
                              >
                                Page {noteCtx.highlight?.pageNumber || '?'}
                              </span>
                              <ChevronRight
                                className="w-4 h-4"
                                style={{ color: isDarkMode ? colors.textDark : colors.accent, opacity: isDarkMode ? 0.7 : 1 }}
                              />
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}


import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookMarked,
  ExternalLink,
  Search,
  FileText,
  Check,
  Loader2,
  Trash2,
} from 'lucide-react';
import type { Highlight, Paper } from '../types';
import { getAllFurtherReadingHighlights, getAllPapers, updateHighlight, deleteHighlight } from '../lib/database';

const SCROLL_POSITION_KEY = 'further-reading-page-scroll';

export function FurtherReadingPage() {
  const navigate = useNavigate();
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [papers, setPapers] = useState<Map<string, Paper>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'resolved'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isDeduping, setIsDeduping] = useState(false);
  const [dedupeResult, setDedupeResult] = useState<string | null>(null);

  // Restore scroll position on mount
  useEffect(() => {
    if (!isLoading) {
      const savedPosition = sessionStorage.getItem(SCROLL_POSITION_KEY);
      if (savedPosition) {
        setTimeout(() => {
          window.scrollTo(0, parseInt(savedPosition, 10));
        }, 100);
      }
    }
  }, [isLoading]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [loadedHighlights, allPapers] = await Promise.all([
        getAllFurtherReadingHighlights(),
        getAllPapers(),
      ]);

      setHighlights(loadedHighlights);
      const paperMap = new Map<string, Paper>();
      allPapers.forEach((p) => paperMap.set(p.id, p));
      setPapers(paperMap);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleResolved = async (highlight: Highlight) => {
    const updated = {
      ...highlight,
      note: highlight.note?.includes('✓')
        ? highlight.note.replace(' ✓', '')
        : (highlight.note || 'Reference') + ' ✓',
      updatedAt: new Date(),
    };
    await updateHighlight(updated);
    setHighlights((prev) =>
      prev.map((h) => (h.id === highlight.id ? updated : h))
    );
  };

  const isResolved = (highlight: Highlight) => highlight.note?.includes('✓');

  const searchGoogleScholar = (text: string) => {
    const query = encodeURIComponent(text.slice(0, 100));
    window.open(`https://scholar.google.com/scholar?q=${query}`, '_blank');
  };

  // Normalize text for fuzzy comparison (handles dashes from line breaks, punctuation, whitespace)
  const normalizeForComparison = (text: string): string => {
    return text
      .toLowerCase()
      .replace(/-\s+/g, '') // Remove hyphen + whitespace ("hyper- visor" -> "hypervisor")
      .replace(/-/g, '') // Remove all hyphens ("hyper-visor" -> "hypervisor")
      .replace(/[.,;:()\[\]{}'"]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  };

  // Dedupe reading list items
  const handleDedupe = async () => {
    if (isDeduping) return;
    setIsDeduping(true);
    setDedupeResult(null);

    try {
      // Group by normalized text
      const groups = new Map<string, Highlight[]>();
      highlights.forEach((h) => {
        const key = normalizeForComparison(h.text);
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(h);
      });

      // Find duplicates (groups with more than one item)
      const toDelete: Highlight[] = [];
      groups.forEach((items) => {
        if (items.length > 1) {
          // Sort by createdAt, keep the oldest
          items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          // Delete all except the first (oldest)
          toDelete.push(...items.slice(1));
        }
      });

      if (toDelete.length === 0) {
        setDedupeResult('No duplicates found!');
      } else {
        // Delete duplicates
        for (const h of toDelete) {
          await deleteHighlight(h.id);
        }
        setDedupeResult(`Removed ${toDelete.length} duplicate${toDelete.length > 1 ? 's' : ''}`);
        // Refresh data
        await loadData();
      }
    } catch (error) {
      console.error('Dedupe error:', error);
      setDedupeResult('Error deduping');
    } finally {
      setIsDeduping(false);
      // Clear result after 3 seconds
      setTimeout(() => setDedupeResult(null), 3000);
    }
  };

  const searchSemanticScholar = (text: string) => {
    const query = encodeURIComponent(text.slice(0, 100));
    window.open(`https://www.semanticscholar.org/search?q=${query}`, '_blank');
  };

  const filteredHighlights = highlights
    .filter((h) => {
      const matchesSearch =
        searchQuery === '' ||
        h.text.toLowerCase().includes(searchQuery.toLowerCase());

      const resolved = isResolved(h);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'resolved' && resolved) ||
        (filter === 'pending' && !resolved);

      return matchesSearch && matchesFilter;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const pendingCount = highlights.filter((h) => !isResolved(h)).length;
  const resolvedCount = highlights.filter((h) => isResolved(h)).length;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[var(--bg-primary)]/80 backdrop-blur-xl border-b border-[var(--border-default)]">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-full hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-[var(--text-secondary)]" />
            </button>
            <div className="flex items-center gap-2">
              <BookMarked className="w-5 h-5 text-[var(--text-primary)]" />
              <div>
                <h1 className="text-base font-semibold text-[var(--text-primary)]">
                  Reading List
                </h1>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {pendingCount} pending · {resolvedCount} done
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dedupeResult && (
              <span className="text-xs text-[var(--text-muted)]">{dedupeResult}</span>
            )}
            <button
              onClick={handleDedupe}
              disabled={isDeduping || highlights.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors"
              title="Remove duplicate entries"
            >
              {isDeduping ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Dedupe
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-6">
        {/* Search and Filters */}
        <div className="flex gap-2 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none z-10" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full py-2 text-sm"
              style={{ paddingLeft: '2.75rem', paddingRight: '1rem' }}
            />
          </div>

          <div className="segmented-control">
            {(['all', 'pending', 'resolved'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={filter === f ? 'active' : ''}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Reading List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
          </div>
        ) : filteredHighlights.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center">
              <BookMarked className="w-7 h-7 text-[var(--text-muted)]" />
            </div>
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">
              {highlights.length === 0 ? 'No references yet' : 'No matches'}
            </h3>
            <p className="text-sm text-[var(--text-muted)]">
              {highlights.length === 0
                ? 'Highlight references while reading'
                : 'Try different search terms'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredHighlights.map((highlight, index) => {
              const paper = papers.get(highlight.paperId);
              const resolved = isResolved(highlight);

              return (
                <div
                  key={highlight.id}
                  className={`p-4 rounded-xl border transition-all animate-fade-in ${resolved
                    ? 'bg-[var(--bg-secondary)] border-[var(--border-muted)] opacity-60'
                    : 'bg-[var(--bg-card)] border-[var(--border-default)]'
                    }`}
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleResolved(highlight)}
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${resolved
                        ? 'border-[var(--text-secondary)] bg-[var(--text-secondary)]'
                        : 'border-[var(--border-default)] hover:border-[var(--text-secondary)]'
                        }`}
                    >
                      {resolved && <Check className="w-3 h-3 text-white" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm text-[var(--text-primary)] leading-relaxed ${resolved ? 'line-through' : ''
                          }`}
                      >
                        {highlight.text}
                      </p>

                      {paper && (
                        <button
                          onClick={() => {
                            sessionStorage.setItem(SCROLL_POSITION_KEY, window.scrollY.toString());
                            navigate(`/reader/${paper.id}`, { state: { from: '/further-reading' } });
                          }}
                          className="flex items-center gap-1.5 mt-2 text-xs text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors"
                        >
                          <FileText className="w-3 h-3" />
                          <span className="truncate max-w-[200px]">{paper.title}</span>
                          <span>· p.{highlight.pageNumber}</span>
                        </button>
                      )}

                      {!resolved && (
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => searchGoogleScholar(highlight.text)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-xs hover:text-[var(--text-primary)] transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Scholar
                          </button>
                          <button
                            onClick={() => searchSemanticScholar(highlight.text)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-xs hover:text-[var(--text-primary)] transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Semantic
                          </button>
                        </div>
                      )}
                    </div>
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

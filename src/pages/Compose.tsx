import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Palette,
  Sparkles,
  Plus,
  ChevronRight,
  ChevronDown,
  GripVertical,
  FileText,
  Lightbulb,
  Layers,
  PenTool,
  Settings,
  Wand2,
  Check,
  X,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { useProject } from '../contexts/ProjectContext';
import { getAllHighlightsByProject, getAllPapers } from '../lib/database';
import type { 
  Highlight, 
  Paper, 
  ThemeGroup,
  CompositionSection,
} from '../types';
import { DEFAULT_HIGHLIGHT_THEMES as THEMES } from '../types';

// LocalStorage key for compositions
const COMPOSITION_STORAGE_KEY = 'paper-lab-composition';

// Extended highlight type with paper info
interface HighlightWithPaper extends Highlight {
  paperTitle: string;
  paperAuthors?: string;
}

// Section card component
interface SectionCardProps {
  section: CompositionSection;
  highlights: HighlightWithPaper[];
  allHighlights: HighlightWithPaper[];
  onUpdate: (section: CompositionSection) => void;
  onDelete: (sectionId: string) => void;
  onGenerateThesis: (sectionId: string) => void;
  onGenerateDraft: (sectionId: string) => void;
  onSuggestHighlights: (sectionId: string) => void;
  isGeneratingThesis: boolean;
  isGeneratingDraft: boolean;
  isSuggestingHighlights: boolean;
  suggestedHighlightIds: string[];
  onAcceptSuggestion: (sectionId: string, highlightId: string) => void;
  onRejectSuggestion: (highlightId: string) => void;
}

function SectionCard({ 
  section, 
  highlights,
  allHighlights,
  onUpdate, 
  onDelete,
  onGenerateThesis, 
  onGenerateDraft,
  onSuggestHighlights,
  isGeneratingThesis,
  isGeneratingDraft,
  isSuggestingHighlights,
  suggestedHighlightIds,
  onAcceptSuggestion,
  onRejectSuggestion,
}: SectionCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showDraft, setShowDraft] = useState(false);

  const sectionHighlights = highlights.filter(h => section.highlightIds.includes(h.id));
  const suggestedHighlights = allHighlights.filter(h => suggestedHighlightIds.includes(h.id));

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-default)]">
        <GripVertical className="w-4 h-4 text-[var(--text-muted)] cursor-grab" />
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
          )}
        </button>
        <input
          type="text"
          value={section.title}
          onChange={(e) => onUpdate({ ...section, title: e.target.value })}
          className="flex-1 bg-transparent text-sm font-semibold text-[var(--text-primary)] focus:outline-none"
          placeholder="Section Title"
        />
        <span className="text-xs text-[var(--text-muted)] px-2 py-0.5 bg-[var(--bg-tertiary)] rounded-full">
          {sectionHighlights.length} sources
        </span>
        <button
          onClick={() => onDelete(section.id)}
          className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 rounded transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Thesis Statement */}
          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              <Lightbulb className="w-3.5 h-3.5" />
              Thesis Statement
              <span className="text-[var(--text-muted)]">— What's the main argument?</span>
            </label>
            <div className="relative">
              <textarea
                value={section.thesisStatement || ''}
                onChange={(e) => onUpdate({ ...section, thesisStatement: e.target.value })}
                placeholder="Write a clear, specific claim that this section will support..."
                className="w-full px-3 py-2 text-sm bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
                rows={2}
              />
              <button
                onClick={() => onGenerateThesis(section.id)}
                disabled={isGeneratingThesis}
                className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 rounded-md transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" />
                {isGeneratingThesis ? 'Thinking...' : 'AI Suggest'}
              </button>
            </div>
            {section.aiSuggestedThesis && section.aiSuggestedThesis !== section.thesisStatement && (
              <div className="mt-2 p-3 bg-[var(--accent-primary)]/5 border border-[var(--accent-primary)]/20 rounded-lg">
                <p className="text-xs text-[var(--text-muted)] mb-1">💡 AI Suggestion:</p>
                <p className="text-sm text-[var(--text-secondary)] italic mb-2">
                  "{section.aiSuggestedThesis}"
                </p>
                <button
                  onClick={() => onUpdate({ ...section, thesisStatement: section.aiSuggestedThesis })}
                  className="text-xs text-[var(--accent-primary)] hover:underline font-medium"
                >
                  Use this thesis
                </button>
              </div>
            )}
          </div>

          {/* Connected Highlights */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                <FileText className="w-3.5 h-3.5" />
                Supporting Evidence
              </label>
              <button
                onClick={() => onSuggestHighlights(section.id)}
                disabled={isSuggestingHighlights}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 rounded-md transition-colors disabled:opacity-50"
              >
                <Wand2 className="w-3 h-3" />
                {isSuggestingHighlights ? 'Finding...' : 'Find Relevant'}
              </button>
            </div>

            {/* AI Suggested Highlights */}
            {suggestedHighlights.length > 0 && (
              <div className="mb-3 p-3 bg-[var(--accent-primary)]/5 border border-[var(--accent-primary)]/20 rounded-lg">
                <p className="text-xs text-[var(--text-muted)] mb-2">✨ Suggested highlights for this section:</p>
                <div className="space-y-2">
                  {suggestedHighlights.map(h => (
                    <div key={h.id} className="flex items-start gap-2 p-2 bg-[var(--bg-primary)] rounded-lg">
                      <div
                        className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                        style={{
                          backgroundColor: h.color === 'yellow' ? '#fbbf24' :
                            h.color === 'red' ? '#ef4444' :
                            h.color === 'purple' ? '#a855f7' :
                            h.color === 'blue' ? '#3b82f6' : '#22c55e'
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[var(--text-primary)] line-clamp-2">{h.text}</p>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{h.paperTitle}</p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => onAcceptSuggestion(section.id, h.id)}
                          className="p-1 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/10 rounded"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onRejectSuggestion(h.id)}
                          className="p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] rounded"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Connected Highlights List */}
            {sectionHighlights.length > 0 ? (
              <div className="space-y-2">
                {sectionHighlights.map(h => (
                  <div key={h.id} className="flex items-start gap-2 p-2 bg-[var(--bg-secondary)] rounded-lg group">
                    <div
                      className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                      style={{
                        backgroundColor: h.color === 'yellow' ? '#fbbf24' :
                          h.color === 'red' ? '#ef4444' :
                          h.color === 'purple' ? '#a855f7' :
                          h.color === 'blue' ? '#3b82f6' : '#22c55e'
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--text-primary)] line-clamp-2">{h.text}</p>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{h.paperTitle}</p>
                      {h.note && (
                        <p className="text-[10px] text-[var(--accent-primary)] mt-1">📝 {h.note}</p>
                      )}
                    </div>
                    <button
                      onClick={() => onUpdate({
                        ...section,
                        highlightIds: section.highlightIds.filter(id => id !== h.id)
                      })}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-red)] opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)] italic p-3 bg-[var(--bg-secondary)] rounded-lg text-center">
                Drag highlights here or use "Find Relevant" to add supporting evidence
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              <PenTool className="w-3.5 h-3.5" />
              Your Notes
            </label>
            <textarea
              value={section.notes || ''}
              onChange={(e) => onUpdate({ ...section, notes: e.target.value })}
              placeholder="Additional thoughts, outline points, or ideas..."
              className="w-full px-3 py-2 text-sm bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
              rows={2}
            />
          </div>

          {/* AI Draft Generation */}
          <div className="pt-3 border-t border-[var(--border-default)]">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                <Wand2 className="w-3.5 h-3.5" />
                AI Draft
              </label>
              <button
                onClick={() => {
                  onGenerateDraft(section.id);
                  setShowDraft(true);
                }}
                disabled={isGeneratingDraft || !section.thesisStatement}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--bg-primary)] bg-[var(--accent-primary)] rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" />
                {isGeneratingDraft ? 'Writing...' : 'Generate Draft'}
              </button>
            </div>
            {!section.thesisStatement && (
              <p className="text-xs text-[var(--text-muted)] italic">
                Add a thesis statement first to generate a draft
              </p>
            )}
            {showDraft && section.draft && (
              <div className="mt-2 p-3 bg-[var(--bg-secondary)] rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[var(--text-muted)]">Generated Draft</span>
                  <button
                    onClick={() => setShowDraft(false)}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    Hide
                  </button>
                </div>
                <div className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                  {section.draft}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Compose() {
  const navigate = useNavigate();
  const { currentProject, isLoading: isProjectLoading } = useProject();
  
  // Data state
  const [highlights, setHighlights] = useState<HighlightWithPaper[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // UI state
  const [activePanel, setActivePanel] = useState<'themes' | 'settings'>('themes');
  const [sections, setSections] = useState<CompositionSection[]>([]);
  const [generatingThesisFor, setGeneratingThesisFor] = useState<string | null>(null);
  const [generatingDraftFor, setGeneratingDraftFor] = useState<string | null>(null);
  const [suggestingHighlightsFor, setSuggestingHighlightsFor] = useState<string | null>(null);
  const [suggestedHighlights, setSuggestedHighlights] = useState<Record<string, string[]>>({});
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [compositionTitle, setCompositionTitle] = useState('Untitled Paper');

  // Load saved composition from localStorage
  useEffect(() => {
    if (!currentProject) return;
    
    const saved = localStorage.getItem(`${COMPOSITION_STORAGE_KEY}-${currentProject.id}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSections(parsed.sections || []);
        setCompositionTitle(parsed.title || 'Untitled Paper');
        setLastSaved(parsed.savedAt ? new Date(parsed.savedAt) : null);
      } catch (e) {
        console.error('Failed to load saved composition:', e);
      }
    }
  }, [currentProject]);

  // Auto-save composition
  useEffect(() => {
    if (!currentProject || sections.length === 0) return;

    const saveTimeout = setTimeout(() => {
      const data = {
        title: compositionTitle,
        sections,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(`${COMPOSITION_STORAGE_KEY}-${currentProject.id}`, JSON.stringify(data));
      setLastSaved(new Date());
    }, 1000); // Debounce saves

    return () => clearTimeout(saveTimeout);
  }, [sections, compositionTitle, currentProject]);

  // Load data
  useEffect(() => {
    if (isProjectLoading || !currentProject) return;

    async function loadData() {
      setIsLoading(true);
      try {
        const [loadedHighlights, loadedPapers] = await Promise.all([
          getAllHighlightsByProject(currentProject!.id),
          getAllPapers(currentProject!.id),
        ]);
        
        const paperMap = new Map(loadedPapers.map(p => [p.id, p]));
        const highlightsWithPapers: HighlightWithPaper[] = loadedHighlights.map(h => ({
          ...h,
          paperTitle: paperMap.get(h.paperId)?.title || 'Unknown Paper',
          paperAuthors: paperMap.get(h.paperId)?.authors,
        }));
        
        setHighlights(highlightsWithPapers);
        setPapers(loadedPapers);
      } catch (error) {
        console.error('Failed to load composing data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [currentProject, isProjectLoading]);

  // Group highlights by theme
  const themeGroups = useMemo<ThemeGroup[]>(() => {
    return THEMES.map(theme => ({
      theme,
      highlights: highlights.filter(h => h.color === theme.color),
    }));
  }, [highlights]);

  // Add new section
  const addSection = useCallback((title: string = 'New Section') => {
    const newSection: CompositionSection = {
      id: crypto.randomUUID(),
      title,
      order: sections.length,
      highlightIds: [],
      notes: '',
      x: 100,
      y: 100,
      width: 300,
      height: 200,
    };
    setSections(prev => [...prev, newSection]);
  }, [sections.length]);

  // Update section
  const updateSection = useCallback((updatedSection: CompositionSection) => {
    setSections(prev => prev.map(s => s.id === updatedSection.id ? updatedSection : s));
  }, []);

  // Delete section
  const deleteSection = useCallback((sectionId: string) => {
    setSections(prev => prev.filter(s => s.id !== sectionId));
  }, []);

  // Generate thesis with AI
  const generateThesis = useCallback(async (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    setGeneratingThesisFor(sectionId);
    
    try {
      const sectionHighlights = highlights.filter(h => section.highlightIds.includes(h.id));
      const highlightTexts = sectionHighlights.map(h => 
        `"${h.text}" (from: ${h.paperTitle})${h.note ? ` [Note: ${h.note}]` : ''}`
      ).join('\n');
      
      const response = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: `You are helping a researcher write a thesis statement for a section of their academic paper. 
Based on the section title, notes, and supporting evidence from research papers, suggest a concise, compelling thesis statement.
The thesis should:
- Be specific and arguable (not just descriptive)
- Capture the main claim the section will support
- Be 1-2 sentences maximum
- Use academic tone`
            },
            {
              role: 'user',
              content: `Section title: "${section.title}"

Author's notes: ${section.notes || 'None yet'}

Supporting evidence from research:
${highlightTexts || 'No highlights added yet - suggest a thesis based on the section title'}

Generate a thesis statement for this section:`
            }
          ],
          model: 'gpt-4o-mini',
          max_tokens: 200,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const suggestedThesis = data.choices?.[0]?.message?.content?.trim();
        if (suggestedThesis) {
          updateSection({ ...section, aiSuggestedThesis: suggestedThesis });
        }
      }
    } catch (error) {
      console.error('Failed to generate thesis:', error);
    } finally {
      setGeneratingThesisFor(null);
    }
  }, [sections, highlights, updateSection]);

  // Generate draft with AI
  const generateDraft = useCallback(async (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section || !section.thesisStatement) return;

    setGeneratingDraftFor(sectionId);
    
    try {
      const sectionHighlights = highlights.filter(h => section.highlightIds.includes(h.id));
      const highlightTexts = sectionHighlights.map(h => 
        `Source: ${h.paperTitle}${h.paperAuthors ? ` (${h.paperAuthors})` : ''}
Quote: "${h.text}"
${h.note ? `Your note: ${h.note}` : ''}`
      ).join('\n\n');
      
      const response = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: `You are helping a researcher write a draft for a section of their academic paper.
Generate well-structured academic prose that:
- Opens with the thesis statement
- Weaves in the supporting evidence naturally with proper citations
- Uses academic tone and transitions
- Is approximately 200-400 words
- References sources by author name (e.g., "According to Smith et al.")
- Maintains the researcher's voice and argument

Do NOT include section headers or bullet points - write flowing paragraphs.`
            },
            {
              role: 'user',
              content: `Write a draft for this section:

Section: ${section.title}
Thesis: ${section.thesisStatement}

Author's notes: ${section.notes || 'None'}

Supporting evidence to incorporate:
${highlightTexts || 'No specific quotes - write based on the thesis'}

Generate an academic draft:`
            }
          ],
          model: 'gpt-4o-mini',
          max_tokens: 800,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const draft = data.choices?.[0]?.message?.content?.trim();
        if (draft) {
          updateSection({ ...section, draft });
        }
      }
    } catch (error) {
      console.error('Failed to generate draft:', error);
    } finally {
      setGeneratingDraftFor(null);
    }
  }, [sections, highlights, updateSection]);

  // Suggest relevant highlights for a section
  const suggestHighlights = useCallback(async (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    setSuggestingHighlightsFor(sectionId);
    
    try {
      // Filter out already-added highlights
      const availableHighlights = highlights.filter(h => !section.highlightIds.includes(h.id));
      
      if (availableHighlights.length === 0) {
        setSuggestedHighlights(prev => ({ ...prev, [sectionId]: [] }));
        return;
      }

      const highlightSummaries = availableHighlights.map((h, i) => 
        `[${i}] Color: ${h.color}, Text: "${h.text.slice(0, 150)}...", Paper: ${h.paperTitle}`
      ).join('\n');
      
      const response = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: `You are helping a researcher find relevant highlights for a paper section.
Based on the section title, thesis, and available highlights, identify the most relevant ones.

Color meanings:
- yellow: Research gaps & problems
- red: Limitations
- purple: Further reading/references  
- blue: Methodology (what the paper did)
- green: Findings/results

Return ONLY a JSON array of indices (e.g., [0, 3, 7]) for the most relevant highlights (max 5).
Consider both the content AND the color meaning when selecting.`
            },
            {
              role: 'user',
              content: `Section: ${section.title}
Thesis: ${section.thesisStatement || 'Not yet written'}
Notes: ${section.notes || 'None'}

Available highlights:
${highlightSummaries}

Return JSON array of relevant highlight indices:`
            }
          ],
          model: 'gpt-4o-mini',
          max_tokens: 100,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        try {
          const indices = JSON.parse(content);
          if (Array.isArray(indices)) {
            const suggestedIds = indices
              .filter((i: number) => i >= 0 && i < availableHighlights.length)
              .map((i: number) => availableHighlights[i].id);
            setSuggestedHighlights(prev => ({ ...prev, [sectionId]: suggestedIds }));
          }
        } catch {
          console.error('Failed to parse AI suggestion:', content);
        }
      }
    } catch (error) {
      console.error('Failed to suggest highlights:', error);
    } finally {
      setSuggestingHighlightsFor(null);
    }
  }, [sections, highlights]);

  // Accept a suggested highlight
  const acceptSuggestion = useCallback((sectionId: string, highlightId: string) => {
    setSections(prev => prev.map(s => {
      if (s.id === sectionId && !s.highlightIds.includes(highlightId)) {
        return { ...s, highlightIds: [...s.highlightIds, highlightId] };
      }
      return s;
    }));
    setSuggestedHighlights(prev => ({
      ...prev,
      [sectionId]: (prev[sectionId] || []).filter(id => id !== highlightId)
    }));
  }, []);

  // Reject a suggested highlight
  const rejectSuggestion = useCallback((highlightId: string) => {
    setSuggestedHighlights(prev => {
      const newSuggestions = { ...prev };
      Object.keys(newSuggestions).forEach(sectionId => {
        newSuggestions[sectionId] = newSuggestions[sectionId].filter(id => id !== highlightId);
      });
      return newSuggestions;
    });
  }, []);

  // Handle dropping a highlight onto a section
  const handleDropHighlight = useCallback((sectionId: string, highlightId: string) => {
    setSections(prev => prev.map(s => {
      if (s.id === sectionId && !s.highlightIds.includes(highlightId)) {
        return { ...s, highlightIds: [...s.highlightIds, highlightId] };
      }
      return s;
    }));
  }, []);

  // Quick add sections based on common paper structure
  const addCommonSections = useCallback(() => {
    const commonSections = [
      { title: 'Introduction', placeholder: 'Introduce the problem and your contribution' },
      { title: 'Related Work', placeholder: 'Position your work within existing research' },
      { title: 'Methodology', placeholder: 'Explain your approach' },
      { title: 'Results', placeholder: 'Present your findings' },
      { title: 'Discussion', placeholder: 'Interpret results and implications' },
      { title: 'Conclusion', placeholder: 'Summarize and suggest future work' },
    ];
    
    const newSections = commonSections.map((s, index) => ({
      id: crypto.randomUUID(),
      title: s.title,
      order: sections.length + index,
      highlightIds: [],
      notes: '',
      x: 100,
      y: 100,
      width: 300,
      height: 200,
    }));
    
    setSections(prev => [...prev, ...newSections]);
  }, [sections.length]);

  if (isLoading || isProjectLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[var(--bg-tertiary)]" />
          <div className="h-4 w-32 bg-[var(--bg-tertiary)] rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col">
      {/* Header */}
      <header className="h-14 border-b border-[var(--border-default)] bg-[var(--bg-card)] px-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-[var(--accent-primary)]" />
            <input
              type="text"
              value={compositionTitle}
              onChange={(e) => setCompositionTitle(e.target.value)}
              className="text-base font-semibold text-[var(--text-primary)] bg-transparent focus:outline-none focus:bg-[var(--bg-secondary)] px-2 py-1 rounded-lg -ml-2"
              placeholder="Paper Title"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {lastSaved && (
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
              <Save className="w-3 h-3" />
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={addCommonSections}
            disabled={sections.some(s => ['Introduction', 'Related Work', 'Methodology'].includes(s.title))}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors disabled:opacity-50"
          >
            <Layers className="w-4 h-4" />
            Paper Template
          </button>
          <button
            onClick={() => addSection()}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[var(--bg-primary)] bg-[var(--accent-primary)] rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Add Section
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Theme Groups */}
        <aside className="w-80 border-r border-[var(--border-default)] bg-[var(--bg-card)] flex flex-col overflow-hidden">
          {/* Panel Tabs */}
          <div className="flex border-b border-[var(--border-default)]">
            <button
              onClick={() => setActivePanel('themes')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                activePanel === 'themes'
                  ? 'text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Palette className="w-4 h-4" />
              Research
            </button>
            <button
              onClick={() => setActivePanel('settings')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                activePanel === 'settings'
                  ? 'text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Settings className="w-4 h-4" />
              Guide
            </button>
          </div>

          {/* Panel Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activePanel === 'themes' && (
              <div className="space-y-4">
                <p className="text-xs text-[var(--text-muted)]">
                  Drag highlights to sections, or let AI suggest matches
                </p>
                
                {themeGroups.map(group => (
                  <div key={group.theme.color} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{
                          backgroundColor: group.theme.color === 'yellow' ? '#fbbf24' :
                            group.theme.color === 'red' ? '#ef4444' :
                            group.theme.color === 'purple' ? '#a855f7' :
                            group.theme.color === 'blue' ? '#3b82f6' :
                            '#22c55e'
                        }}
                      />
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {group.theme.name}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        ({group.highlights.length})
                      </span>
                    </div>
                    
                    <div className="space-y-1.5 ml-5">
                      {group.highlights.slice(0, 5).map(highlight => (
                        <div
                          key={highlight.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('highlightId', highlight.id);
                          }}
                          className="p-2 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-default)] cursor-grab hover:border-[var(--accent-primary)]/50 transition-colors"
                        >
                          <p className="text-xs text-[var(--text-primary)] line-clamp-2">
                            {highlight.text}
                          </p>
                          <p className="text-[10px] text-[var(--text-muted)] mt-1 truncate">
                            {highlight.paperTitle}
                          </p>
                          {highlight.note && (
                            <p className="text-[10px] text-[var(--accent-primary)] mt-1 line-clamp-1">
                              📝 {highlight.note}
                            </p>
                          )}
                        </div>
                      ))}
                      {group.highlights.length > 5 && (
                        <button className="text-xs text-[var(--accent-primary)] hover:underline">
                          Show {group.highlights.length - 5} more...
                        </button>
                      )}
                      {group.highlights.length === 0 && (
                        <p className="text-xs text-[var(--text-muted)] italic">
                          No highlights
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activePanel === 'settings' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">How to Use Compose</h3>
                  <ol className="text-xs text-[var(--text-secondary)] space-y-2 list-decimal list-inside">
                    <li>Add sections for your paper structure</li>
                    <li>Write thesis statements for each section</li>
                    <li>Connect relevant highlights as evidence</li>
                    <li>Use AI to suggest highlights & generate drafts</li>
                  </ol>
                </div>
                
                <div className="pt-3 border-t border-[var(--border-default)]">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Color Guide</h3>
                  {THEMES.map(theme => (
                    <div key={theme.color} className="flex items-start gap-2 mb-2">
                      <div
                        className="w-3 h-3 rounded-full mt-0.5 flex-shrink-0"
                        style={{
                          backgroundColor: theme.color === 'yellow' ? '#fbbf24' :
                            theme.color === 'red' ? '#ef4444' :
                            theme.color === 'purple' ? '#a855f7' :
                            theme.color === 'blue' ? '#3b82f6' :
                            '#22c55e'
                        }}
                      />
                      <div>
                        <p className="text-xs font-medium text-[var(--text-primary)]">{theme.name}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">{theme.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Main Canvas Area */}
        <main className="flex-1 overflow-auto bg-[var(--bg-secondary)] p-6">
          {sections.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md">
                <FileText className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                  Start Composing Your Paper
                </h2>
                <p className="text-sm text-[var(--text-muted)] mb-6">
                  Structure your paper with sections, connect your research highlights, and let AI help you draft compelling prose.
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={addCommonSections}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-card)] border border-[var(--border-default)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <Layers className="w-4 h-4" />
                    Use Paper Template
                  </button>
                  <button
                    onClick={() => addSection()}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--bg-primary)] bg-[var(--accent-primary)] rounded-lg hover:opacity-90 transition-opacity"
                  >
                    <Plus className="w-4 h-4" />
                    Add Custom Section
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {sections.map(section => (
                <div
                  key={section.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const highlightId = e.dataTransfer.getData('highlightId');
                    if (highlightId) {
                      handleDropHighlight(section.id, highlightId);
                    }
                  }}
                >
                  <SectionCard
                    section={section}
                    highlights={highlights}
                    allHighlights={highlights}
                    onUpdate={updateSection}
                    onDelete={deleteSection}
                    onGenerateThesis={generateThesis}
                    onGenerateDraft={generateDraft}
                    onSuggestHighlights={suggestHighlights}
                    isGeneratingThesis={generatingThesisFor === section.id}
                    isGeneratingDraft={generatingDraftFor === section.id}
                    isSuggestingHighlights={suggestingHighlightsFor === section.id}
                    suggestedHighlightIds={suggestedHighlights[section.id] || []}
                    onAcceptSuggestion={acceptSuggestion}
                    onRejectSuggestion={rejectSuggestion}
                  />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default Compose;

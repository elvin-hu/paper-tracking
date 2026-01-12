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
} from 'lucide-react';
import { Tldraw, Editor, TLShapeId, createShapeId } from 'tldraw';
import 'tldraw/tldraw.css';
import { useProject } from '../contexts/ProjectContext';
import { getAllHighlightsByProject, getAllPapers } from '../lib/database';
import type { 
  Highlight, 
  Paper, 
  HighlightTheme, 
  ThemeGroup, 
  CompositionSection,
  DEFAULT_HIGHLIGHT_THEMES 
} from '../types';
import { DEFAULT_HIGHLIGHT_THEMES as THEMES } from '../types';

// Section card component for the canvas
interface SectionCardProps {
  section: CompositionSection;
  onUpdate: (section: CompositionSection) => void;
  onGenerateThesis: (sectionId: string) => void;
  isGenerating: boolean;
}

function SectionCard({ section, onUpdate, onGenerateThesis, isGenerating }: SectionCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

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
        <span className="text-xs text-[var(--text-muted)]">
          {section.highlightIds.length} sources
        </span>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="p-4 space-y-3">
          {/* Thesis Statement */}
          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              <Lightbulb className="w-3.5 h-3.5" />
              Thesis Statement
            </label>
            <div className="relative">
              <textarea
                value={section.thesisStatement || ''}
                onChange={(e) => onUpdate({ ...section, thesisStatement: e.target.value })}
                placeholder="What's the main argument of this section?"
                className="w-full px-3 py-2 text-sm bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
                rows={2}
              />
              <button
                onClick={() => onGenerateThesis(section.id)}
                disabled={isGenerating}
                className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 rounded-md transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" />
                {isGenerating ? 'Generating...' : 'AI Suggest'}
              </button>
            </div>
            {section.aiSuggestedThesis && section.aiSuggestedThesis !== section.thesisStatement && (
              <div className="mt-2 p-2 bg-[var(--accent-primary)]/5 border border-[var(--accent-primary)]/20 rounded-lg">
                <p className="text-xs text-[var(--text-muted)] mb-1">AI Suggestion:</p>
                <p className="text-sm text-[var(--text-secondary)] italic">
                  "{section.aiSuggestedThesis}"
                </p>
                <button
                  onClick={() => onUpdate({ ...section, thesisStatement: section.aiSuggestedThesis })}
                  className="mt-2 text-xs text-[var(--accent-primary)] hover:underline"
                >
                  Use this suggestion
                </button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              <PenTool className="w-3.5 h-3.5" />
              Section Notes
            </label>
            <textarea
              value={section.notes || ''}
              onChange={(e) => onUpdate({ ...section, notes: e.target.value })}
              placeholder="Additional notes for this section..."
              className="w-full px-3 py-2 text-sm bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
              rows={3}
            />
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
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // UI state
  const [activePanel, setActivePanel] = useState<'themes' | 'structure' | 'settings'>('themes');
  const [sections, setSections] = useState<CompositionSection[]>([]);
  const [generatingThesisFor, setGeneratingThesisFor] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);

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
        setHighlights(loadedHighlights);
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
    const paperMap = new Map(papers.map(p => [p.id, p.title]));
    
    return THEMES.map(theme => ({
      theme,
      highlights: highlights
        .filter(h => h.color === theme.color)
        .map(h => ({
          ...h,
          paperTitle: paperMap.get(h.paperId) || 'Unknown Paper',
        })),
    }));
  }, [highlights, papers]);

  // Add new section
  const addSection = useCallback((title: string = 'New Section') => {
    const newSection: CompositionSection = {
      id: crypto.randomUUID(),
      title,
      order: sections.length,
      highlightIds: [],
      notes: '',
      x: 100 + (sections.length % 3) * 320,
      y: 100 + Math.floor(sections.length / 3) * 250,
      width: 300,
      height: 200,
    };
    setSections(prev => [...prev, newSection]);
  }, [sections.length]);

  // Update section
  const updateSection = useCallback((updatedSection: CompositionSection) => {
    setSections(prev => prev.map(s => s.id === updatedSection.id ? updatedSection : s));
  }, []);

  // Generate thesis with AI
  const generateThesis = useCallback(async (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    setGeneratingThesisFor(sectionId);
    
    try {
      // Get the highlights for this section
      const sectionHighlights = highlights.filter(h => section.highlightIds.includes(h.id));
      const highlightTexts = sectionHighlights.map(h => h.text).join('\n');
      
      // Call OpenAI API
      const response = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: 'You are helping a researcher write a thesis statement for a section of their paper. Based on the highlights and notes provided, suggest a concise, compelling thesis statement that captures the main argument.'
            },
            {
              role: 'user',
              content: `Section title: "${section.title}"
              
Section notes: ${section.notes || 'None'}

Related highlights from research papers:
${highlightTexts || 'No highlights added yet'}

Suggest a thesis statement for this section (1-2 sentences, be specific and argumentative):`
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
    const commonSections = ['Introduction', 'Related Work', 'Methodology', 'Results', 'Discussion', 'Conclusion'];
    commonSections.forEach((title, index) => {
      const newSection: CompositionSection = {
        id: crypto.randomUUID(),
        title,
        order: sections.length + index,
        highlightIds: [],
        notes: '',
        x: 100 + (index % 3) * 320,
        y: 100 + Math.floor(index / 3) * 250,
        width: 300,
        height: 200,
      };
      setSections(prev => [...prev, newSection]);
    });
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
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-[var(--accent-primary)]" />
            <span className="text-base font-semibold text-[var(--text-primary)]">Compose</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={addCommonSections}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
          >
            <Layers className="w-4 h-4" />
            Add Paper Structure
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
              Themes
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
              Settings
            </button>
          </div>

          {/* Panel Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activePanel === 'themes' && (
              <div className="space-y-4">
                <p className="text-xs text-[var(--text-muted)]">
                  Drag highlights from themes to sections on the canvas
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
                              Note: {highlight.note}
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
                          No highlights with this color
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activePanel === 'settings' && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">Color Meanings</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Customize what each highlight color represents in your research.
                </p>
                {THEMES.map(theme => (
                  <div key={theme.color} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{
                          backgroundColor: theme.color === 'yellow' ? '#fbbf24' :
                            theme.color === 'red' ? '#ef4444' :
                            theme.color === 'purple' ? '#a855f7' :
                            theme.color === 'blue' ? '#3b82f6' :
                            '#22c55e'
                        }}
                      />
                      <span className="text-sm text-[var(--text-primary)]">{theme.name}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] ml-5">
                      {theme.description}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Main Canvas Area */}
        <main className="flex-1 relative overflow-hidden bg-[var(--bg-secondary)]">
          {sections.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-md">
                <FileText className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                  Start Composing
                </h2>
                <p className="text-sm text-[var(--text-muted)] mb-6">
                  Add sections to structure your paper, then drag highlights from the themes panel to connect your research with your arguments.
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
            <div className="absolute inset-0">
              <Tldraw
                onMount={(editor) => setEditor(editor)}
                hideUi
              >
                {/* We'll overlay our custom section cards on top */}
              </Tldraw>
              
              {/* Custom overlay for sections */}
              <div className="absolute inset-0 pointer-events-none overflow-auto p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pointer-events-auto">
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
                        onUpdate={updateSection}
                        onGenerateThesis={generateThesis}
                        isGenerating={generatingThesisFor === section.id}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default Compose;

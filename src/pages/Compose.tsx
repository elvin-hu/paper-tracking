import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Sparkles,
  Plus,
  GripVertical,
  FileText,
  ChevronRight,
  ChevronDown,
  Trash2,
  Save,
  Wand2,
  X,
  RotateCcw,
  Copy,
  Check,
  MessageSquare,
  StickyNote,
  PanelRightOpen,
  PanelRightClose,
  Layers,
  FolderPlus,
  MoreHorizontal,
  Pencil,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { getAllHighlightsByProject, getAllPapers } from '../lib/database';
import { callOpenAI } from '../lib/openai';
import type { Highlight, Paper, HighlightColor } from '../types';
import { DEFAULT_HIGHLIGHT_THEMES as THEMES } from '../types';

// LocalStorage key
const COMPOSITION_STORAGE_KEY = 'paper-lab-structured-composition';

// Section structure
interface Section {
  id: string;
  title: string;
  parentId: string | null;
  order: number;
  isExpanded: boolean;
}

// Note attached to a module
interface AttachedNote {
  highlightId: string;
  highlightText: string;
  highlightColor: HighlightColor;
  paperTitle: string;
  originalNote?: string; // The note attached to the highlight (if any)
  userComment: string;
  isKept: boolean; // true = user kept it, false = still a suggestion
}

// Version of AI draft
interface DraftVersion {
  id: string;
  content: string;
  createdAt: Date;
}

// Paragraph module
interface ParagraphModule {
  id: string;
  sectionId: string;
  order: number;
  userWriting: string;
  attachedNotes: AttachedNote[];
  aiDraft: string;
  draftVersions: DraftVersion[];
  isGeneratingDraft: boolean;
  isFindingNotes: boolean;
  hasLoadedSuggestions: boolean;
}

// Extend highlight with paper info
interface HighlightWithPaper extends Highlight {
  paperTitle: string;
  paperAuthors?: string;
}

// Highlight color map
const HIGHLIGHT_COLOR_MAP: Record<HighlightColor, string> = {
  yellow: '#fbbf24',
  red: '#ef4444',
  purple: '#a855f7',
  blue: '#3b82f6',
  green: '#22c55e',
};

// Default sections
const DEFAULT_SECTIONS: Section[] = [
  { id: 'intro', title: 'Introduction', parentId: null, order: 0, isExpanded: true },
  { id: 'background', title: 'Background', parentId: null, order: 1, isExpanded: true },
  { id: 'related', title: 'Related Work', parentId: null, order: 2, isExpanded: true },
  { id: 'methodology', title: 'Methodology', parentId: null, order: 3, isExpanded: true },
  { id: 'results', title: 'Results', parentId: null, order: 4, isExpanded: true },
  { id: 'discussion', title: 'Discussion', parentId: null, order: 5, isExpanded: true },
  { id: 'conclusion', title: 'Conclusion', parentId: null, order: 6, isExpanded: true },
];

export function Compose() {
  const navigate = useNavigate();
  const { currentProject, isLoading: isProjectLoading } = useProject();
  
  // Data state
  const [highlights, setHighlights] = useState<HighlightWithPaper[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Structure state
  const [sections, setSections] = useState<Section[]>(DEFAULT_SECTIONS);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>('intro');
  const [modules, setModules] = useState<ParagraphModule[]>([]);
  
  // UI state
  const [compositionTitle, setCompositionTitle] = useState('Untitled Paper');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showDraftPanel, setShowDraftPanel] = useState(true);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [isGeneratingModules, setIsGeneratingModules] = useState(false);

  // Load saved composition
  useEffect(() => {
    if (!currentProject) return;
    
    const saved = localStorage.getItem(`${COMPOSITION_STORAGE_KEY}-${currentProject.id}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.sections?.length > 0) setSections(parsed.sections);
        if (parsed.modules?.length > 0) setModules(parsed.modules);
        if (parsed.title) setCompositionTitle(parsed.title);
        setLastSaved(parsed.savedAt ? new Date(parsed.savedAt) : null);
      } catch (e) {
        console.error('Failed to load saved composition:', e);
      }
    }
  }, [currentProject]);

  // Auto-save
  useEffect(() => {
    if (!currentProject) return;

    const saveTimeout = setTimeout(() => {
      const data = {
        title: compositionTitle,
        sections,
        modules,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(`${COMPOSITION_STORAGE_KEY}-${currentProject.id}`, JSON.stringify(data));
      setLastSaved(new Date());
    }, 1000);

    return () => clearTimeout(saveTimeout);
  }, [sections, modules, compositionTitle, currentProject]);

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
        console.error('Failed to load data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [currentProject, isProjectLoading]);

  // Get modules for selected section
  const currentModules = useMemo(() => {
    if (!selectedSectionId) return [];
    return modules
      .filter(m => m.sectionId === selectedSectionId)
      .sort((a, b) => a.order - b.order);
  }, [modules, selectedSectionId]);

  // Get section hierarchy
  const sectionTree = useMemo(() => {
    const rootSections = sections
      .filter(s => s.parentId === null)
      .sort((a, b) => a.order - b.order);
    
    const getChildren = (parentId: string): Section[] => {
      return sections
        .filter(s => s.parentId === parentId)
        .sort((a, b) => a.order - b.order);
    };
    
    return { rootSections, getChildren };
  }, [sections]);

  // Generate full draft from all modules
  const fullDraft = useMemo(() => {
    const orderedSections = sections
      .filter(s => s.parentId === null)
      .sort((a, b) => a.order - b.order);
    
    const parts: string[] = [];
    
    for (const section of orderedSections) {
      const sectionModules = modules
        .filter(m => m.sectionId === section.id)
        .sort((a, b) => a.order - b.order);
      
      if (sectionModules.length > 0) {
        parts.push(`## ${section.title}\n`);
        for (const mod of sectionModules) {
          const content = mod.aiDraft || mod.userWriting;
          if (content) {
            parts.push(content + '\n');
          }
        }
        parts.push('');
      }
      
      // Add subsections
      const subsections = sections
        .filter(s => s.parentId === section.id)
        .sort((a, b) => a.order - b.order);
      
      for (const sub of subsections) {
        const subModules = modules
          .filter(m => m.sectionId === sub.id)
          .sort((a, b) => a.order - b.order);
        
        if (subModules.length > 0) {
          parts.push(`### ${sub.title}\n`);
          for (const mod of subModules) {
            const content = mod.aiDraft || mod.userWriting;
            if (content) {
              parts.push(content + '\n');
            }
          }
          parts.push('');
        }
      }
    }
    
    return parts.join('\n').trim();
  }, [sections, modules]);

  // Add new section
  const addSection = useCallback((parentId: string | null = null) => {
    const siblings = sections.filter(s => s.parentId === parentId);
    const newSection: Section = {
      id: crypto.randomUUID(),
      title: parentId ? 'New Subsection' : 'New Section',
      parentId,
      order: siblings.length,
      isExpanded: true,
    };
    setSections(prev => [...prev, newSection]);
    setEditingSectionId(newSection.id);
  }, [sections]);

  // Update section
  const updateSection = useCallback((id: string, updates: Partial<Section>) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  // Delete section
  const deleteSection = useCallback((id: string) => {
    // Also delete subsections and their modules
    const toDelete = new Set<string>([id]);
    sections.filter(s => s.parentId === id).forEach(s => toDelete.add(s.id));
    
    setSections(prev => prev.filter(s => !toDelete.has(s.id)));
    setModules(prev => prev.filter(m => !toDelete.has(m.sectionId)));
    
    if (selectedSectionId && toDelete.has(selectedSectionId)) {
      setSelectedSectionId(sections.find(s => !toDelete.has(s.id))?.id || null);
    }
  }, [sections, selectedSectionId]);

  // Add new module
  const addModule = useCallback((sectionId: string) => {
    const sectionModules = modules.filter(m => m.sectionId === sectionId);
    const newModule: ParagraphModule = {
      id: crypto.randomUUID(),
      sectionId,
      order: sectionModules.length,
      userWriting: '',
      attachedNotes: [],
      aiDraft: '',
      draftVersions: [],
      isGeneratingDraft: false,
      isFindingNotes: false,
      hasLoadedSuggestions: false,
    };
    setModules(prev => [...prev, newModule]);
  }, [modules]);

  // Update module
  const updateModule = useCallback((id: string, updates: Partial<ParagraphModule>) => {
    setModules(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);

  // Delete module
  const deleteModule = useCallback((id: string) => {
    setModules(prev => {
      const toDelete = prev.find(m => m.id === id);
      if (!toDelete) return prev;
      
      // Reorder remaining modules
      return prev
        .filter(m => m.id !== id)
        .map(m => {
          if (m.sectionId === toDelete.sectionId && m.order > toDelete.order) {
            return { ...m, order: m.order - 1 };
          }
          return m;
        });
    });
  }, []);

  // Move module up/down
  const moveModule = useCallback((id: string, direction: 'up' | 'down') => {
    setModules(prev => {
      const module = prev.find(m => m.id === id);
      if (!module) return prev;
      
      const sectionModules = prev
        .filter(m => m.sectionId === module.sectionId)
        .sort((a, b) => a.order - b.order);
      
      const index = sectionModules.findIndex(m => m.id === id);
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      
      if (newIndex < 0 || newIndex >= sectionModules.length) return prev;
      
      const swapWith = sectionModules[newIndex];
      
      return prev.map(m => {
        if (m.id === id) return { ...m, order: swapWith.order };
        if (m.id === swapWith.id) return { ...m, order: module.order };
        return m;
      });
    });
  }, []);

  // Attach note to module
  // Find relevant notes using AI
  const findRelevantNotes = useCallback(async (moduleId: string) => {
    const module = modules.find(m => m.id === moduleId);
    if (!module) return;
    
    const section = sections.find(s => s.id === module.sectionId);
    
    updateModule(moduleId, { isFindingNotes: true });
    
    try {
      // Get highlights not already attached
      const attachedIds = module.attachedNotes.map(n => n.highlightId);
      const availableHighlights = highlights.filter(h => !attachedIds.includes(h.id));
      
      if (availableHighlights.length === 0) {
        updateModule(moduleId, { isFindingNotes: false, hasLoadedSuggestions: true });
        return;
      }

      // Shuffle highlights to avoid position bias, then take first 50
      const shuffled = [...availableHighlights].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, 50);
      
      const highlightsList = selected.map((h, i) => {
        const noteInfo = h.note ? ` | Your note: "${h.note.slice(0, 150)}"` : '';
        return `[${i}] (${h.color}) "${h.text.slice(0, 300)}"${noteInfo} — from "${h.paperTitle}"`;
      }).join('\n\n');
      
      // Keep track of original highlight references for mapping back
      const highlightMap = selected;
      
      const data = await callOpenAI({
        messages: [
          {
            role: 'system',
            content: `You are an expert academic writing assistant helping find research evidence to support arguments in a paper.

Your task: Find highlights that SUPPORT or RELATE TO the user's argument/point, not just keyword matches.

Think about:
1. What CLAIM is the user making?
2. Which highlights provide EVIDENCE, CONTEXT, or SUPPORTING ARGUMENTS for that claim?
3. Which highlights discuss the SAME CONCEPT even if using different words?

Color meanings (use these to understand the highlight's purpose):
- yellow: Research gaps & problems (good for motivation/problem statements)
- red: Limitations (good for discussing gaps or future work)  
- purple: Further reading/references (good for related work)
- blue: Methodology/approach (good for describing what was done)
- green: Findings/results (good for supporting claims with evidence)

Return ONLY a JSON array of indices (e.g., [0, 2, 5]) for the most relevant highlights (max 5).

IMPORTANT: 
- Prioritize semantic relevance over keyword matching
- Try to select from DIFFERENT papers when possible to provide diverse perspectives
- Don't pick highlights just because they contain similar keywords`
          },
          {
            role: 'user',
            content: `Paper section: ${section?.title || 'Unknown'}

User's argument/point for this paragraph:
"${module.userWriting || '(not specified yet)'}"

Available research highlights to choose from:
${highlightsList}

Which highlights best SUPPORT or CONTEXTUALIZE the user's argument? Return JSON array of indices:`
          }
        ],
        model: 'gpt-4o',
        max_tokens: 100,
      });

      {
        let content = data.choices?.[0]?.message?.content?.trim();
        
        // Strip markdown code blocks if present
        if (content?.startsWith('```')) {
          content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        
        try {
          const indices = JSON.parse(content);
          if (Array.isArray(indices)) {
            const suggestedNotes: AttachedNote[] = indices
              .filter((i: number) => i >= 0 && i < highlightMap.length)
              .slice(0, 5)
              .map((i: number) => ({
                highlightId: highlightMap[i].id,
                highlightText: highlightMap[i].text,
                highlightColor: highlightMap[i].color,
                paperTitle: highlightMap[i].paperTitle,
                originalNote: highlightMap[i].note,
                userComment: '',
                isKept: false, // These are suggestions
              }));
            
            updateModule(moduleId, {
              attachedNotes: [...module.attachedNotes, ...suggestedNotes],
              isFindingNotes: false,
              hasLoadedSuggestions: true,
            });
          }
        } catch {
          console.error('Failed to parse AI response');
          updateModule(moduleId, { isFindingNotes: false, hasLoadedSuggestions: true });
        }
      }
    } catch (error) {
      console.error('Failed to find relevant notes:', error);
      updateModule(moduleId, { isFindingNotes: false, hasLoadedSuggestions: true });
    }
  }, [modules, sections, highlights, updateModule]);

  // Keep a suggested note
  const keepNote = useCallback((moduleId: string, highlightId: string) => {
    setModules(prev => prev.map(m => {
      if (m.id !== moduleId) return m;
      return {
        ...m,
        attachedNotes: m.attachedNotes.map(n =>
          n.highlightId === highlightId ? { ...n, isKept: true } : n
        ),
      };
    }));
  }, []);

  // Discard a suggested note
  const discardNote = useCallback((moduleId: string, highlightId: string) => {
    setModules(prev => prev.map(m => {
      if (m.id !== moduleId) return m;
      return {
        ...m,
        attachedNotes: m.attachedNotes.filter(n => n.highlightId !== highlightId),
      };
    }));
  }, []);

  // Update note comment
  const updateNoteComment = useCallback((moduleId: string, highlightId: string, comment: string) => {
    setModules(prev => prev.map(m => {
      if (m.id !== moduleId) return m;
      return {
        ...m,
        attachedNotes: m.attachedNotes.map(n => 
          n.highlightId === highlightId ? { ...n, userComment: comment } : n
        ),
      };
    }));
  }, []);

  // Generate AI draft for module
  const generateModuleDraft = useCallback(async (moduleId: string) => {
    const module = modules.find(m => m.id === moduleId);
    if (!module) return;
    
    const section = sections.find(s => s.id === module.sectionId);
    
    updateModule(moduleId, { isGeneratingDraft: true });
    
    try {
      // Only use kept notes for draft generation
      const keptNotes = module.attachedNotes.filter(n => n.isKept);
      const notesContext = keptNotes.map(n => 
        `"${n.highlightText}" (${n.paperTitle})${n.userComment ? ` [Comment: ${n.userComment}]` : ''}`
      ).join('\n');
      
      const data = await callOpenAI({
        messages: [
          {
            role: 'system',
            content: `You are helping write a paragraph for an academic paper. Generate polished academic prose based on the user's rough writing and supporting notes. Keep the user's voice but improve clarity and flow. Include citations where appropriate (e.g., "According to [Author]..."). Write 100-200 words.`
          },
          {
            role: 'user',
            content: `Section: ${section?.title || 'Unknown'}
              
User's rough draft:
${module.userWriting || '(No user writing yet - generate based on notes)'}

Supporting notes/quotes:
${notesContext || '(No notes attached)'}

Generate a polished paragraph:`
          }
        ],
        model: 'gpt-4o',
        max_tokens: 500,
      });

      {
        const draft = data.choices?.[0]?.message?.content?.trim();
        if (draft) {
          const newVersion: DraftVersion = {
            id: crypto.randomUUID(),
            content: draft,
            createdAt: new Date(),
          };
          updateModule(moduleId, {
            aiDraft: draft,
            draftVersions: [...module.draftVersions, newVersion],
            isGeneratingDraft: false,
          });
        }
      }
    } catch (error) {
      console.error('Failed to generate draft:', error);
      updateModule(moduleId, { isGeneratingDraft: false });
    }
  }, [modules, sections, updateModule]);

  // Generate modules for section with AI
  const generateModulesForSection = useCallback(async (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;
    
    setIsGeneratingModules(true);
    
    try {
      // Get available highlights
      const availableHighlights = highlights.slice(0, 20);
      const highlightsList = availableHighlights.map((h, i) => 
        `[${i}] "${h.text.slice(0, 100)}..." (${h.paperTitle})`
      ).join('\n');
      
      const data = await callOpenAI({
        messages: [
          {
            role: 'system',
            content: `You are helping structure an academic paper section. Based on the section name and available research highlights, suggest 2-4 paragraph topics with key points. Return as JSON array:
[{"topic": "Main point of paragraph", "relevantHighlightIndices": [0, 2]}]`
          },
          {
            role: 'user',
            content: `Section: ${section.title}

Available highlights:
${highlightsList || '(No highlights available)'}

Suggest paragraph structure (JSON):`
          }
        ],
        model: 'gpt-4o',
        max_tokens: 500,
      });

      {
        let content = data.choices?.[0]?.message?.content?.trim();
        // Strip markdown code blocks if present
        if (content?.startsWith('```')) {
          content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        try {
          const suggestions = JSON.parse(content);
          if (Array.isArray(suggestions)) {
            const existingCount = modules.filter(m => m.sectionId === sectionId).length;
            const newModules: ParagraphModule[] = suggestions.map((s: { topic: string; relevantHighlightIndices?: number[] }, i: number) => ({
              id: crypto.randomUUID(),
              sectionId,
              order: existingCount + i,
              userWriting: s.topic,
              attachedNotes: (s.relevantHighlightIndices || [])
                .filter((idx: number) => idx >= 0 && idx < availableHighlights.length)
                .map((idx: number) => ({
                  highlightId: availableHighlights[idx].id,
                  highlightText: availableHighlights[idx].text,
                  highlightColor: availableHighlights[idx].color,
                  paperTitle: availableHighlights[idx].paperTitle,
                  userComment: '',
                  isKept: false, // Start as suggestions
                })),
              aiDraft: '',
              draftVersions: [],
              isGeneratingDraft: false,
              isFindingNotes: false,
              hasLoadedSuggestions: true, // Already has AI suggestions
            }));
            setModules(prev => [...prev, ...newModules]);
          }
        } catch {
          console.error('Failed to parse suggestions');
        }
      }
    } catch (error) {
      console.error('Failed to generate modules:', error);
    } finally {
      setIsGeneratingModules(false);
    }
  }, [sections, highlights, modules]);

  // Render section in tree
  const renderSection = (section: Section, depth: number = 0) => {
    const children = sectionTree.getChildren(section.id);
    const isSelected = selectedSectionId === section.id;
    const moduleCount = modules.filter(m => m.sectionId === section.id).length;
    
    return (
      <div key={section.id}>
        <div
          className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
            isSelected ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]' : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'
          }`}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => setSelectedSectionId(section.id)}
        >
          {children.length > 0 ? (
            <button
              onClick={(e) => { e.stopPropagation(); updateSection(section.id, { isExpanded: !section.isExpanded }); }}
              className="p-0.5 hover:bg-[var(--bg-tertiary)] rounded"
            >
              {section.isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          ) : (
            <span className="w-4" />
          )}
          
          {editingSectionId === section.id ? (
            <input
              type="text"
              value={section.title}
              onChange={(e) => updateSection(section.id, { title: e.target.value })}
              onBlur={() => setEditingSectionId(null)}
              onKeyDown={(e) => e.key === 'Enter' && setEditingSectionId(null)}
              className="flex-1 text-sm bg-transparent focus:outline-none"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 text-sm font-medium truncate">{section.title}</span>
          )}
          
          {moduleCount > 0 && (
            <span className="text-[10px] text-[var(--text-muted)] px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded-full">
              {moduleCount}
            </span>
          )}
          
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); setEditingSectionId(section.id); }}
              className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-muted)]"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); addSection(section.id); }}
              className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-muted)]"
              title="Add subsection"
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); deleteSection(section.id); }}
              className="p-1 hover:bg-[var(--accent-red)]/10 rounded text-[var(--text-muted)] hover:text-[var(--accent-red)]"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
        
        {section.isExpanded && children.map(child => renderSection(child, depth + 1))}
      </div>
    );
  };

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

  const selectedSection = sections.find(s => s.id === selectedSectionId);

  return (
    <div className="h-screen bg-[var(--bg-secondary)] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-12 border-b border-[var(--border-default)] bg-[var(--bg-card)] px-4 flex items-center justify-between flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-[var(--border-default)]" />
          <input
            type="text"
            value={compositionTitle}
            onChange={(e) => setCompositionTitle(e.target.value)}
            className="text-sm font-medium text-[var(--text-primary)] bg-transparent focus:outline-none focus:bg-[var(--bg-secondary)] px-2 py-1 rounded -ml-2"
            placeholder="Paper Title"
          />
        </div>

        <div className="flex items-center gap-2">
          {lastSaved && (
            <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
              <Save className="w-3 h-3" />
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => setShowDraftPanel(!showDraftPanel)}
            className={`p-1.5 rounded-lg transition-colors ${
              showDraftPanel ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
            }`}
            title="Toggle Draft Panel"
          >
            {showDraftPanel ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Structure */}
        <aside className="w-64 border-r border-[var(--border-default)] bg-[var(--bg-card)] flex flex-col">
          <div className="p-3 border-b border-[var(--border-default)] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Structure</h2>
            <button
              onClick={() => addSection(null)}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-secondary)] rounded transition-colors"
              title="Add section"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto py-2">
            {sectionTree.rootSections.map(section => renderSection(section))}
          </div>
        </aside>

        {/* Center Panel - Modules */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-primary)]">
          {selectedSection ? (
            <>
              {/* Section Header */}
              <div className="flex-shrink-0 px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-card)]">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-lg font-semibold text-[var(--text-primary)]">{selectedSection.title}</h1>
                    <p className="text-sm text-[var(--text-muted)]">{currentModules.length} paragraphs</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => generateModulesForSection(selectedSection.id)}
                      disabled={isGeneratingModules}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Wand2 className="w-4 h-4" />
                      {isGeneratingModules ? 'Generating...' : 'AI Suggest Paragraphs'}
                    </button>
                    <button
                      onClick={() => addModule(selectedSection.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--bg-primary)] bg-[var(--accent-primary)] rounded-lg hover:opacity-90 transition-opacity"
                    >
                      <Plus className="w-4 h-4" />
                      Add Paragraph
                    </button>
                  </div>
                </div>
              </div>

              {/* Modules List */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {currentModules.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">No paragraphs yet</h3>
                    <p className="text-sm text-[var(--text-muted)] mb-4">
                      Start writing or let AI suggest paragraph structure
                    </p>
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => generateModulesForSection(selectedSection.id)}
                        disabled={isGeneratingModules}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--accent-primary)] bg-[var(--accent-primary)]/10 rounded-lg hover:bg-[var(--accent-primary)]/20 transition-colors"
                      >
                        <Wand2 className="w-4 h-4" />
                        AI Suggest
                      </button>
                      <button
                        onClick={() => addModule(selectedSection.id)}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Add Manually
                      </button>
                    </div>
                  </div>
                ) : (
                  currentModules.map((module, index) => (
                    <div
                      key={module.id}
                      className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-default)] overflow-hidden"
                    >
                      {/* Module Header */}
                      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-default)]">
                        <GripVertical className="w-4 h-4 text-[var(--text-muted)] cursor-grab" />
                        <span className="text-xs font-medium text-[var(--text-muted)]">Paragraph {index + 1}</span>
                        <div className="flex-1" />
                        <button
                          onClick={() => moveModule(module.id, 'up')}
                          disabled={index === 0}
                          className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30"
                        >
                          <ChevronDown className="w-4 h-4 rotate-180" />
                        </button>
                        <button
                          onClick={() => moveModule(module.id, 'down')}
                          disabled={index === currentModules.length - 1}
                          className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteModule(module.id)}
                          className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-red)]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="p-4 space-y-4">
                        {/* User Writing */}
                        <div>
                          <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] mb-2">
                            <Pencil className="w-3.5 h-3.5" />
                            Your Writing
                          </label>
                          <textarea
                            value={module.userWriting}
                            onChange={(e) => updateModule(module.id, { userWriting: e.target.value })}
                            placeholder="Write your rough draft or key points here..."
                            className="w-full px-3 py-2 text-sm bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
                            rows={3}
                          />
                        </div>

                        {/* Supporting Notes */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                              <StickyNote className="w-3.5 h-3.5" />
                              Supporting Notes
                              {module.attachedNotes.filter(n => n.isKept).length > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] rounded-full">
                                  {module.attachedNotes.filter(n => n.isKept).length} kept
                                </span>
                              )}
                            </label>
                            <button
                              onClick={() => findRelevantNotes(module.id)}
                              disabled={module.isFindingNotes}
                              className="flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline disabled:opacity-50"
                            >
                              <Wand2 className="w-3 h-3" />
                              {module.isFindingNotes ? 'Finding...' : module.hasLoadedSuggestions ? 'Find More' : 'Find Relevant Notes'}
                            </button>
                          </div>
                          
                          {/* AI Suggestions (not kept yet) */}
                          {module.attachedNotes.filter(n => !n.isKept).length > 0 && (
                            <div className="mb-3 p-3 bg-[var(--accent-primary)]/5 rounded-lg border border-[var(--accent-primary)]/20">
                              <div className="flex items-center gap-2 mb-2">
                                <Sparkles className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                                <span className="text-xs font-medium text-[var(--accent-primary)]">
                                  AI Suggestions — keep the relevant ones
                                </span>
                              </div>
                              <div className="space-y-2">
                                {module.attachedNotes.filter(n => !n.isKept).map(note => (
                                  <div
                                    key={note.highlightId}
                                    className="p-2 bg-[var(--bg-card)] rounded-lg border-l-4 flex items-start gap-2"
                                    style={{ borderColor: HIGHLIGHT_COLOR_MAP[note.highlightColor] }}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs text-[var(--text-primary)] line-clamp-2">"{note.highlightText}"</p>
                                      {note.originalNote && (
                                        <p className="text-[10px] text-[var(--accent-primary)] mt-1 italic">📝 {note.originalNote}</p>
                                      )}
                                      <p className="text-[10px] text-[var(--text-muted)] mt-1">— {note.paperTitle}</p>
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      <button
                                        onClick={() => keepNote(module.id, note.highlightId)}
                                        className="p-1.5 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/10 rounded transition-colors"
                                        title="Keep this note"
                                      >
                                        <Check className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => discardNote(module.id, note.highlightId)}
                                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 rounded transition-colors"
                                        title="Discard"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Kept Notes */}
                          {module.attachedNotes.filter(n => n.isKept).length > 0 ? (
                            <div className="space-y-2">
                              {module.attachedNotes.filter(n => n.isKept).map(note => (
                                <div
                                  key={note.highlightId}
                                  className="p-3 bg-[var(--bg-secondary)] rounded-lg border-l-4"
                                  style={{ borderColor: HIGHLIGHT_COLOR_MAP[note.highlightColor] }}
                                >
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <p className="text-xs text-[var(--text-primary)] flex-1">"{note.highlightText}"</p>
                                    <button
                                      onClick={() => discardNote(module.id, note.highlightId)}
                                      className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-red)]"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                  {note.originalNote && (
                                    <p className="text-[10px] text-[var(--accent-primary)] mb-2 italic">📝 {note.originalNote}</p>
                                  )}
                                  <p className="text-[10px] text-[var(--text-muted)] mb-2">— {note.paperTitle}</p>
                                  <input
                                    type="text"
                                    value={note.userComment}
                                    onChange={(e) => updateNoteComment(module.id, note.highlightId, e.target.value)}
                                    placeholder="Add your comment on this note..."
                                    className="w-full px-2 py-1 text-xs bg-[var(--bg-primary)] border border-[var(--border-default)] rounded text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/50"
                                  />
                                </div>
                              ))}
                            </div>
                          ) : !module.hasLoadedSuggestions && (
                            <p className="text-xs text-[var(--text-muted)] italic py-2">
                              Click "Find Relevant Notes" to get AI suggestions based on your writing
                            </p>
                          )}
                        </div>

                        {/* AI Draft */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                              <Sparkles className="w-3.5 h-3.5" />
                              AI Draft
                              {module.draftVersions.length > 0 && (
                                <span className="text-[10px] text-[var(--text-muted)]">
                                  (v{module.draftVersions.length})
                                </span>
                              )}
                            </label>
                            <button
                              onClick={() => generateModuleDraft(module.id)}
                              disabled={module.isGeneratingDraft}
                              className="flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline disabled:opacity-50"
                            >
                              {module.isGeneratingDraft ? (
                                <>Generating...</>
                              ) : module.aiDraft ? (
                                <>
                                  <RotateCcw className="w-3 h-3" />
                                  Regenerate
                                </>
                              ) : (
                                <>
                                  <Wand2 className="w-3 h-3" />
                                  Generate
                                </>
                              )}
                            </button>
                          </div>
                          
                          {module.aiDraft ? (
                            <div className="p-3 bg-[var(--accent-primary)]/5 border border-[var(--accent-primary)]/20 rounded-lg">
                              <p className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
                                {module.aiDraft}
                              </p>
                              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--accent-primary)]/20">
                                <button
                                  onClick={() => {
                                    updateModule(module.id, { userWriting: module.aiDraft });
                                  }}
                                  className="text-xs text-[var(--accent-primary)] hover:underline flex items-center gap-1"
                                >
                                  <Check className="w-3 h-3" />
                                  Use as my writing
                                </button>
                                <button
                                  onClick={() => navigator.clipboard.writeText(module.aiDraft)}
                                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1"
                                >
                                  <Copy className="w-3 h-3" />
                                  Copy
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-[var(--text-muted)] italic">
                              Add your writing and notes, then generate an AI draft
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Layers className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
                <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">Select a Section</h3>
                <p className="text-sm text-[var(--text-muted)]">Choose a section from the structure panel to start writing</p>
              </div>
            </div>
          )}
        </main>

        {/* Right Panel - Full Draft */}
        {showDraftPanel && (
          <aside className="w-80 border-l border-[var(--border-default)] bg-[var(--bg-card)] flex flex-col">
            <div className="p-3 border-b border-[var(--border-default)] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Full Draft</h2>
              <button
                onClick={() => navigator.clipboard.writeText(fullDraft)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded transition-colors"
                title="Copy draft"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              {fullDraft ? (
                <div className="prose prose-sm max-w-none text-[var(--text-primary)]">
                  {fullDraft.split('\n').map((line, i) => {
                    if (line.startsWith('## ')) {
                      return <h2 key={i} className="text-base font-semibold mt-4 mb-2">{line.slice(3)}</h2>;
                    }
                    if (line.startsWith('### ')) {
                      return <h3 key={i} className="text-sm font-semibold mt-3 mb-1">{line.slice(4)}</h3>;
                    }
                    if (line.trim()) {
                      return <p key={i} className="text-sm mb-3 leading-relaxed">{line}</p>;
                    }
                    return null;
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <FileText className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2" />
                  <p className="text-sm text-[var(--text-muted)]">Your draft will appear here as you write</p>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export default Compose;

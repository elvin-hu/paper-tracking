import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Sparkles,
  Plus,
  GripVertical,
  FileText,
  Lightbulb,
  Type,
  StickyNote,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Wand2,
  ChevronDown,
  Circle,
  Square,
  Save,
  Palette,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { getAllHighlightsByProject, getAllPapers } from '../lib/database';
import type { Highlight, Paper, HighlightColor } from '../types';
import { DEFAULT_HIGHLIGHT_THEMES as THEMES } from '../types';

// LocalStorage key
const COMPOSITION_STORAGE_KEY = 'paper-lab-canvas-composition';

// Element types
type ElementType = 'thesis' | 'highlight' | 'text' | 'section';

interface CanvasElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  // For highlights
  highlightId?: string;
  highlightColor?: HighlightColor;
  paperTitle?: string;
  paperAuthors?: string;
  // For sections
  color?: string;
  // For grouping
  groupId?: string;
}

interface SectionGroup {
  id: string;
  title: string;
  color: string;
  // Bounds are calculated from contained elements
}

// Extend highlight with paper info
interface HighlightWithPaper extends Highlight {
  paperTitle: string;
  paperAuthors?: string;
}

// Color palette for sections
const SECTION_COLORS = [
  { name: 'Blue', value: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.3)' },
  { name: 'Purple', value: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)', border: 'rgba(168, 85, 247, 0.3)' },
  { name: 'Green', value: '#22c55e', bg: 'rgba(34, 197, 94, 0.1)', border: 'rgba(34, 197, 94, 0.3)' },
  { name: 'Orange', value: '#f97316', bg: 'rgba(249, 115, 22, 0.1)', border: 'rgba(249, 115, 22, 0.3)' },
  { name: 'Pink', value: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)', border: 'rgba(236, 72, 153, 0.3)' },
  { name: 'Teal', value: '#14b8a6', bg: 'rgba(20, 184, 166, 0.1)', border: 'rgba(20, 184, 166, 0.3)' },
];

// Highlight color map
const HIGHLIGHT_COLOR_MAP: Record<HighlightColor, string> = {
  yellow: '#fbbf24',
  red: '#ef4444',
  purple: '#a855f7',
  blue: '#3b82f6',
  green: '#22c55e',
};

export function Compose() {
  const navigate = useNavigate();
  const { currentProject, isLoading: isProjectLoading } = useProject();
  const canvasRef = useRef<HTMLDivElement>(null);
  
  // Data state
  const [highlights, setHighlights] = useState<HighlightWithPaper[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Canvas state
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [groups, setGroups] = useState<SectionGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
  
  // UI state
  const [showHighlightPanel, setShowHighlightPanel] = useState(true);
  const [showToolbar, setShowToolbar] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [compositionTitle, setCompositionTitle] = useState('Untitled Paper');
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [generatedDraft, setGeneratedDraft] = useState<string | null>(null);
  const [showDraftModal, setShowDraftModal] = useState(false);

  // Load saved composition
  useEffect(() => {
    if (!currentProject) return;
    
    const saved = localStorage.getItem(`${COMPOSITION_STORAGE_KEY}-${currentProject.id}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setElements(parsed.elements || []);
        setGroups(parsed.groups || []);
        setCompositionTitle(parsed.title || 'Untitled Paper');
        setLastSaved(parsed.savedAt ? new Date(parsed.savedAt) : null);
        if (parsed.zoom) setZoom(parsed.zoom);
        if (parsed.pan) setPan(parsed.pan);
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
        elements,
        groups,
        zoom,
        pan,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(`${COMPOSITION_STORAGE_KEY}-${currentProject.id}`, JSON.stringify(data));
      setLastSaved(new Date());
    }, 1000);

    return () => clearTimeout(saveTimeout);
  }, [elements, groups, compositionTitle, zoom, pan, currentProject]);

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

  // Group highlights by theme
  const themeGroups = useMemo(() => {
    return THEMES.map(theme => ({
      theme,
      highlights: highlights.filter(h => h.color === theme.color),
    }));
  }, [highlights]);

  // Calculate group bounds from contained elements
  const calculateGroupBounds = useCallback((groupId: string) => {
    const groupElements = elements.filter(e => e.groupId === groupId);
    if (groupElements.length === 0) return null;
    
    const padding = 20;
    const headerHeight = 40;
    
    const minX = Math.min(...groupElements.map(e => e.x)) - padding;
    const minY = Math.min(...groupElements.map(e => e.y)) - padding - headerHeight;
    const maxX = Math.max(...groupElements.map(e => e.x + e.width)) + padding;
    const maxY = Math.max(...groupElements.map(e => e.y + e.height)) + padding;
    
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [elements]);

  // Add element to canvas
  const addElement = useCallback((type: ElementType, highlight?: HighlightWithPaper) => {
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const centerX = canvasRect ? (canvasRect.width / 2 - pan.x) / zoom : 300;
    const centerY = canvasRect ? (canvasRect.height / 2 - pan.y) / zoom : 300;
    
    // Add some randomness to avoid stacking
    const offsetX = (Math.random() - 0.5) * 100;
    const offsetY = (Math.random() - 0.5) * 100;
    
    const newElement: CanvasElement = {
      id: crypto.randomUUID(),
      type,
      x: centerX + offsetX,
      y: centerY + offsetY,
      width: type === 'section' ? 300 : type === 'thesis' ? 280 : type === 'highlight' ? 260 : 200,
      height: type === 'section' ? 200 : type === 'thesis' ? 100 : type === 'highlight' ? 120 : 80,
      content: type === 'thesis' ? 'Write your thesis statement...' : 
               type === 'section' ? 'Section Title' :
               type === 'text' ? 'Add your notes...' :
               highlight?.text || '',
      highlightId: highlight?.id,
      highlightColor: highlight?.color,
      paperTitle: highlight?.paperTitle,
      paperAuthors: highlight?.paperAuthors,
      color: type === 'section' ? SECTION_COLORS[groups.length % SECTION_COLORS.length].value : undefined,
    };
    
    setElements(prev => [...prev, newElement]);
    setSelectedId(newElement.id);
    
    return newElement;
  }, [pan, zoom, groups.length]);

  // Add section group
  const addSection = useCallback(() => {
    const color = SECTION_COLORS[groups.length % SECTION_COLORS.length];
    const newGroup: SectionGroup = {
      id: crypto.randomUUID(),
      title: 'New Section',
      color: color.value,
    };
    setGroups(prev => [...prev, newGroup]);
    
    // Also add a section header element
    addElement('section');
  }, [groups.length, addElement]);

  // Update element
  const updateElement = useCallback((id: string, updates: Partial<CanvasElement>) => {
    setElements(prev => prev.map(el => el.id === id ? { ...el, ...updates } : el));
  }, []);

  // Delete element
  const deleteElement = useCallback((id: string) => {
    setElements(prev => prev.filter(el => el.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  // Handle mouse down on element
  const handleElementMouseDown = useCallback((e: React.MouseEvent, element: CanvasElement) => {
    e.stopPropagation();
    setSelectedId(element.id);
    setIsDragging(true);
    
    const rect = (e.target as HTMLElement).closest('.canvas-element')?.getBoundingClientRect();
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  }, []);

  // Handle mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && selectedId) {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (canvasRect) {
        const x = (e.clientX - canvasRect.left - dragOffset.x - pan.x) / zoom;
        const y = (e.clientY - canvasRect.top - dragOffset.y - pan.y) / zoom;
        updateElement(selectedId, { x, y });
      }
    } else if (isPanning) {
      const dx = e.clientX - lastPanPos.x;
      const dy = e.clientY - lastPanPos.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastPanPos({ x: e.clientX, y: e.clientY });
    }
  }, [isDragging, selectedId, dragOffset, pan, zoom, isPanning, lastPanPos, updateElement]);

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsPanning(false);
  }, []);

  // Handle canvas pan start
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle click or Alt+click to pan
      setIsPanning(true);
      setLastPanPos({ x: e.clientX, y: e.clientY });
    } else {
      setSelectedId(null);
    }
  }, []);

  // Handle zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(prev => Math.min(Math.max(prev * delta, 0.25), 2));
    }
  }, []);

  // Reset view
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Drop highlight onto canvas
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const highlightId = e.dataTransfer.getData('highlightId');
    if (highlightId) {
      const highlight = highlights.find(h => h.id === highlightId);
      if (highlight) {
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        if (canvasRect) {
          const x = (e.clientX - canvasRect.left - pan.x) / zoom;
          const y = (e.clientY - canvasRect.top - pan.y) / zoom;
          
          const newElement: CanvasElement = {
            id: crypto.randomUUID(),
            type: 'highlight',
            x: x - 130,
            y: y - 60,
            width: 260,
            height: 120,
            content: highlight.text,
            highlightId: highlight.id,
            highlightColor: highlight.color,
            paperTitle: highlight.paperTitle,
            paperAuthors: highlight.paperAuthors,
          };
          setElements(prev => [...prev, newElement]);
          setSelectedId(newElement.id);
        }
      }
    }
  }, [highlights, pan, zoom]);

  // Generate draft from canvas
  const generateDraft = useCallback(async () => {
    setIsGeneratingDraft(true);
    
    try {
      // Collect all elements and organize by position (top to bottom)
      const sortedElements = [...elements].sort((a, b) => a.y - b.y);
      
      // Build context from canvas
      const thesisStatements = sortedElements
        .filter(e => e.type === 'thesis')
        .map(e => e.content);
      
      const highlightElements = sortedElements
        .filter(e => e.type === 'highlight')
        .map(e => ({
          text: e.content,
          paper: e.paperTitle,
          authors: e.paperAuthors,
          note: highlights.find(h => h.id === e.highlightId)?.note,
        }));
      
      const freeTextElements = sortedElements
        .filter(e => e.type === 'text')
        .map(e => e.content);
      
      const sectionElements = sortedElements
        .filter(e => e.type === 'section')
        .map(e => e.content);
      
      const response = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: `You are helping a researcher write an academic paper. Based on the canvas elements they've arranged (thesis statements, research highlights, notes, and section headers), generate well-structured academic prose.

Guidelines:
- Weave together the thesis statements as the main argument
- Incorporate quotes from research with proper citations (e.g., "According to [Author]...")
- Use the free-form notes to guide tone and structure
- Organize content following any section headers provided
- Use academic transitions between ideas
- Write approximately 400-800 words
- Maintain a scholarly but readable tone`
            },
            {
              role: 'user',
              content: `Paper Title: ${compositionTitle}

Thesis Statements:
${thesisStatements.length > 0 ? thesisStatements.map((t, i) => `${i + 1}. ${t}`).join('\n') : 'None yet'}

Section Headers:
${sectionElements.length > 0 ? sectionElements.join(', ') : 'None'}

Research Highlights:
${highlightElements.length > 0 ? highlightElements.map(h => 
  `"${h.text}" (${h.paper}${h.authors ? `, ${h.authors}` : ''})${h.note ? ` [Note: ${h.note}]` : ''}`
).join('\n\n') : 'None yet'}

Author's Notes:
${freeTextElements.length > 0 ? freeTextElements.join('\n') : 'None'}

Generate an academic draft based on these canvas elements:`
            }
          ],
          model: 'gpt-4o-mini',
          max_tokens: 1500,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const draft = data.choices?.[0]?.message?.content?.trim();
        if (draft) {
          setGeneratedDraft(draft);
          setShowDraftModal(true);
        }
      }
    } catch (error) {
      console.error('Failed to generate draft:', error);
    } finally {
      setIsGeneratingDraft(false);
    }
  }, [elements, highlights, compositionTitle]);

  // Render element based on type
  const renderElement = (element: CanvasElement) => {
    const isSelected = selectedId === element.id;
    
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      left: element.x * zoom + pan.x,
      top: element.y * zoom + pan.y,
      width: element.width * zoom,
      minHeight: element.height * zoom,
      transform: 'translate(0, 0)',
      cursor: isDragging && isSelected ? 'grabbing' : 'grab',
      transition: isDragging ? 'none' : 'box-shadow 0.2s',
    };

    switch (element.type) {
      case 'thesis':
        return (
          <div
            key={element.id}
            className={`canvas-element group ${isSelected ? 'ring-2 ring-[var(--accent-primary)]' : ''}`}
            style={{
              ...baseStyle,
              background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-secondary) 100%)',
              borderRadius: 16,
              border: '2px solid var(--accent-primary)',
              boxShadow: isSelected ? '0 8px 32px rgba(0,0,0,0.15)' : '0 4px 16px rgba(0,0,0,0.1)',
              padding: 16 * zoom,
            }}
            onMouseDown={(e) => handleElementMouseDown(e, element)}
          >
            <div className="flex items-center gap-2 mb-2" style={{ fontSize: 12 * zoom }}>
              <Lightbulb className="text-[var(--accent-primary)]" style={{ width: 14 * zoom, height: 14 * zoom }} />
              <span className="font-semibold text-[var(--accent-primary)]">Thesis</span>
              <button
                onClick={() => deleteElement(element.id)}
                className="ml-auto opacity-0 group-hover:opacity-100 p-1 hover:bg-[var(--accent-red)]/10 rounded text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-all"
              >
                <Trash2 style={{ width: 12 * zoom, height: 12 * zoom }} />
              </button>
            </div>
            <textarea
              value={element.content}
              onChange={(e) => updateElement(element.id, { content: e.target.value })}
              className="w-full bg-transparent text-[var(--text-primary)] resize-none focus:outline-none"
              style={{ fontSize: 14 * zoom, lineHeight: 1.5 }}
              placeholder="Write your thesis statement..."
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        );

      case 'highlight':
        const highlightColor = element.highlightColor ? HIGHLIGHT_COLOR_MAP[element.highlightColor] : '#fbbf24';
        return (
          <div
            key={element.id}
            className={`canvas-element group ${isSelected ? 'ring-2 ring-[var(--accent-primary)]' : ''}`}
            style={{
              ...baseStyle,
              background: 'var(--bg-card)',
              borderRadius: 12,
              borderLeft: `4px solid ${highlightColor}`,
              boxShadow: isSelected ? '0 8px 32px rgba(0,0,0,0.15)' : '0 2px 12px rgba(0,0,0,0.08)',
              padding: 12 * zoom,
            }}
            onMouseDown={(e) => handleElementMouseDown(e, element)}
          >
            <div className="flex items-start gap-2">
              <div
                className="rounded-full flex-shrink-0"
                style={{
                  width: 8 * zoom,
                  height: 8 * zoom,
                  marginTop: 6 * zoom,
                  backgroundColor: highlightColor,
                }}
              />
              <div className="flex-1 min-w-0">
                <p
                  className="text-[var(--text-primary)]"
                  style={{ fontSize: 13 * zoom, lineHeight: 1.5 }}
                >
                  "{element.content}"
                </p>
                <p
                  className="text-[var(--text-muted)] mt-1 truncate"
                  style={{ fontSize: 10 * zoom }}
                >
                  — {element.paperTitle}
                </p>
              </div>
              <button
                onClick={() => deleteElement(element.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[var(--accent-red)]/10 rounded text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-all flex-shrink-0"
              >
                <Trash2 style={{ width: 12 * zoom, height: 12 * zoom }} />
              </button>
            </div>
          </div>
        );

      case 'text':
        return (
          <div
            key={element.id}
            className={`canvas-element group ${isSelected ? 'ring-2 ring-[var(--accent-primary)]' : ''}`}
            style={{
              ...baseStyle,
              background: '#fffef0',
              borderRadius: 4,
              boxShadow: isSelected ? '0 8px 32px rgba(0,0,0,0.15)' : '0 2px 8px rgba(0,0,0,0.1)',
              padding: 12 * zoom,
              transform: 'rotate(-1deg)',
            }}
            onMouseDown={(e) => handleElementMouseDown(e, element)}
          >
            <button
              onClick={() => deleteElement(element.id)}
              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 hover:bg-[var(--accent-red)]/10 rounded text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-all"
            >
              <Trash2 style={{ width: 12 * zoom, height: 12 * zoom }} />
            </button>
            <textarea
              value={element.content}
              onChange={(e) => updateElement(element.id, { content: e.target.value })}
              className="w-full bg-transparent text-gray-800 resize-none focus:outline-none"
              style={{ fontSize: 14 * zoom, lineHeight: 1.5, fontFamily: 'inherit' }}
              placeholder="Add your notes..."
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        );

      case 'section':
        const sectionColor = SECTION_COLORS.find(c => c.value === element.color) || SECTION_COLORS[0];
        return (
          <div
            key={element.id}
            className={`canvas-element group ${isSelected ? 'ring-2 ring-[var(--accent-primary)]' : ''}`}
            style={{
              ...baseStyle,
              background: sectionColor.bg,
              borderRadius: 20,
              border: `2px dashed ${sectionColor.border}`,
              padding: 16 * zoom,
            }}
            onMouseDown={(e) => handleElementMouseDown(e, element)}
          >
            <div className="flex items-center gap-2">
              <div
                className="rounded-full"
                style={{
                  width: 12 * zoom,
                  height: 12 * zoom,
                  backgroundColor: sectionColor.value,
                }}
              />
              <input
                type="text"
                value={element.content}
                onChange={(e) => updateElement(element.id, { content: e.target.value })}
                className="flex-1 bg-transparent font-semibold focus:outline-none"
                style={{ fontSize: 16 * zoom, color: sectionColor.value }}
                placeholder="Section Title"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={() => deleteElement(element.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[var(--accent-red)]/10 rounded text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-all"
              >
                <Trash2 style={{ width: 14 * zoom, height: 14 * zoom }} />
              </button>
            </div>
            <p
              className="text-[var(--text-muted)] mt-2"
              style={{ fontSize: 11 * zoom }}
            >
              Drop highlights and notes here
            </p>
          </div>
        );

      default:
        return null;
    }
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
            className="text-sm font-medium text-[var(--text-primary)] bg-transparent focus:outline-none focus:bg-[var(--bg-secondary)] px-2 py-1 rounded -ml-2 max-w-[200px]"
            placeholder="Paper Title"
          />
        </div>

        {/* Center Toolbar */}
        <div className="flex items-center gap-1 bg-[var(--bg-secondary)] rounded-lg p-1">
          <button
            onClick={() => addElement('thesis')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-card)] rounded-md transition-colors"
            title="Add Thesis Statement"
          >
            <Lightbulb className="w-3.5 h-3.5" />
            Thesis
          </button>
          <button
            onClick={() => addElement('text')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-card)] rounded-md transition-colors"
            title="Add Sticky Note"
          >
            <StickyNote className="w-3.5 h-3.5" />
            Note
          </button>
          <button
            onClick={addSection}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-card)] rounded-md transition-colors"
            title="Add Section"
          >
            <Square className="w-3.5 h-3.5" />
            Section
          </button>
          <div className="w-px h-4 bg-[var(--border-default)] mx-1" />
          <button
            onClick={generateDraft}
            disabled={isGeneratingDraft || elements.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--bg-primary)] bg-[var(--accent-primary)] hover:opacity-90 rounded-md transition-opacity disabled:opacity-50"
          >
            <Wand2 className="w-3.5 h-3.5" />
            {isGeneratingDraft ? 'Writing...' : 'Generate Draft'}
          </button>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          {lastSaved && (
            <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
              <Save className="w-3 h-3" />
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded-lg p-0.5">
            <button
              onClick={() => setZoom(z => Math.max(z * 0.9, 0.25))}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] rounded transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs text-[var(--text-muted)] w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(z * 1.1, 2))}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] rounded transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={resetView}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] rounded transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Highlights */}
        <aside className={`${showHighlightPanel ? 'w-72' : 'w-0'} border-r border-[var(--border-default)] bg-[var(--bg-card)] flex flex-col overflow-hidden transition-all duration-200`}>
          <div className="p-3 border-b border-[var(--border-default)]">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Research Highlights</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Drag onto canvas</p>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {themeGroups.map(group => (
              <div key={group.theme.color}>
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: HIGHLIGHT_COLOR_MAP[group.theme.color] }}
                  />
                  <span className="text-xs font-medium text-[var(--text-secondary)]">
                    {group.theme.name}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    ({group.highlights.length})
                  </span>
                </div>
                
                <div className="space-y-1.5 ml-4">
                  {group.highlights.slice(0, 8).map(highlight => (
                    <div
                      key={highlight.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('highlightId', highlight.id);
                      }}
                      className="p-2 bg-[var(--bg-secondary)] rounded-lg border border-transparent hover:border-[var(--accent-primary)]/30 cursor-grab active:cursor-grabbing transition-all hover:shadow-sm"
                    >
                      <p className="text-[11px] text-[var(--text-primary)] line-clamp-2 leading-relaxed">
                        {highlight.text}
                      </p>
                      <p className="text-[9px] text-[var(--text-muted)] mt-1 truncate">
                        {highlight.paperTitle}
                      </p>
                    </div>
                  ))}
                  {group.highlights.length > 8 && (
                    <p className="text-[10px] text-[var(--accent-primary)] cursor-pointer hover:underline">
                      +{group.highlights.length - 8} more
                    </p>
                  )}
                  {group.highlights.length === 0 && (
                    <p className="text-[10px] text-[var(--text-muted)] italic">No highlights</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Canvas */}
        <main
          ref={canvasRef}
          className="flex-1 relative overflow-hidden h-full"
          style={{
            background: `
              radial-gradient(circle at center, var(--bg-secondary) 0%, var(--bg-primary) 100%),
              repeating-linear-gradient(0deg, transparent, transparent 20px, var(--border-default) 20px, var(--border-default) 21px),
              repeating-linear-gradient(90deg, transparent, transparent 20px, var(--border-default) 20px, var(--border-default) 21px)
            `,
            backgroundSize: '100% 100%, 100% 100%, 100% 100%',
            backgroundBlendMode: 'normal',
          }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          {/* Canvas dot pattern overlay */}
          <div
            className="absolute inset-0 pointer-events-none opacity-30"
            style={{
              backgroundImage: `radial-gradient(circle, var(--text-muted) 1px, transparent 1px)`,
              backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
              backgroundPosition: `${pan.x}px ${pan.y}px`,
            }}
          />

          {/* Elements */}
          {elements.map(renderElement)}

          {/* Empty state */}
          {elements.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center max-w-md p-8 bg-[var(--bg-card)]/80 backdrop-blur-sm rounded-2xl border border-[var(--border-default)]">
                <FileText className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                  Start Building Your Paper
                </h2>
                <p className="text-sm text-[var(--text-muted)] mb-4">
                  Add thesis statements, drag highlights from the sidebar, and organize your thoughts visually.
                </p>
                <div className="flex gap-2 justify-center pointer-events-auto">
                  <button
                    onClick={() => addElement('thesis')}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--accent-primary)] bg-[var(--accent-primary)]/10 rounded-lg hover:bg-[var(--accent-primary)]/20 transition-colors"
                  >
                    <Lightbulb className="w-4 h-4" />
                    Add Thesis
                  </button>
                  <button
                    onClick={addSection}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <Square className="w-4 h-4" />
                    Add Section
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Draft Modal */}
      {showDraftModal && generatedDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 animate-fade-in">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowDraftModal(false)}
          />
          <div className="relative bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border-default)] w-full max-w-3xl max-h-[80vh] overflow-hidden animate-scale-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary)]/15 flex items-center justify-center">
                  <Wand2 className="w-4 h-4 text-[var(--accent-primary)]" />
                </div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Generated Draft</h2>
              </div>
              <button
                onClick={() => setShowDraftModal(false)}
                className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="prose prose-sm max-w-none text-[var(--text-primary)]">
                {generatedDraft.split('\n').map((paragraph, i) => (
                  <p key={i} className="mb-4 leading-relaxed">{paragraph}</p>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]/50">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedDraft);
                }}
                className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Copy to Clipboard
              </button>
              <button
                onClick={() => setShowDraftModal(false)}
                className="px-4 py-2 text-sm font-medium text-[var(--bg-primary)] bg-[var(--accent-primary)] rounded-lg hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toggle sidebar button */}
      <button
        onClick={() => setShowHighlightPanel(!showHighlightPanel)}
        className="fixed left-0 top-1/2 -translate-y-1/2 p-1.5 bg-[var(--bg-card)] border border-[var(--border-default)] rounded-r-lg shadow-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors z-10"
        style={{ left: showHighlightPanel ? '286px' : '0' }}
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${showHighlightPanel ? '-rotate-90' : 'rotate-90'}`} />
      </button>
    </div>
  );
}

export default Compose;

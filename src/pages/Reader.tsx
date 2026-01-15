import { useState, useEffect, useCallback, useRef, Fragment, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import { v4 as uuidv4 } from 'uuid';
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  Maximize2,
  BookMarked,
  X,
  Loader2,
  StickyNote,
  ChevronRight,
  Download,
  ExternalLink,
  Check,
  Sparkles,
  Plus,
  PanelLeft,
  PanelRight,
  FileText,
  Star,
  Info,
  Search,
  ArrowUpDown,
  Trash2,
  Filter,
} from 'lucide-react';
import type { Paper, Highlight, Note, HighlightColor, SortOption } from '../types';
import {
  getPaper,
  getPaperFile,
  getHighlightsByPaper,
  addHighlight,
  updateHighlight,
  deleteHighlight,
  getNotesByPaper,
  addNote,
  updateNote,
  deleteNote,
  getAllPapers,
  updatePaper,
  getSettings,
  getAllFurtherReadingHighlights,
  getAllTags,
} from '../lib/database';
import { callOpenAI } from '../lib/openai';
import { EditPaperModal } from '../components/EditPaperModal';
import { useProject } from '../contexts/ProjectContext';

import 'react-pdf/dist/Page/TextLayer.css';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Pastel color palette for highlights - consistent with NotesPage
// bgDark and textDark are for dark mode variants
const HIGHLIGHT_COLORS: {
  color: HighlightColor;
  bg: string;
  bgDark: string; // Darker, muted background for dark mode
  border: string;
  accent: string;
  dark: string;
  textDark: string; // Light text for dark mode
  shadow: string
}[] = [
    { color: 'yellow', bg: '#fef9c3', bgDark: '#3d3522', border: '#fbbf24', accent: '#ca8a04', dark: '#78350f', textDark: '#fef3c7', shadow: 'rgba(180, 130, 20, 0.25)' },
    { color: 'green', bg: '#dcfce7', bgDark: '#1a3329', border: '#4ade80', accent: '#16a34a', dark: '#14532d', textDark: '#dcfce7', shadow: 'rgba(34, 160, 70, 0.25)' },
    { color: 'blue', bg: '#dbeafe', bgDark: '#1e2d3d', border: '#3b82f6', accent: '#2563eb', dark: '#1e3a5f', textDark: '#dbeafe', shadow: 'rgba(45, 100, 200, 0.25)' },
    { color: 'red', bg: '#fee2e2', bgDark: '#3d1f1f', border: '#f87171', accent: '#dc2626', dark: '#7f1d1d', textDark: '#fee2e2', shadow: 'rgba(200, 80, 80, 0.25)' },
    { color: 'purple', bg: '#f3e8ff', bgDark: '#2d1f3d', border: '#a855f7', accent: '#9333ea', dark: '#581c87', textDark: '#f3e8ff', shadow: 'rgba(140, 70, 200, 0.25)' },
  ];

// Parse references from PDF text
function parseReferences(fullText: string): Map<string, string> {
  const references = new Map<string, string>();

  // Helper to clean up hyphenated line breaks in extracted text
  // Only removes hyphens with spaces around them (line breaks), preserves compound words like "Self-Tracking"
  // Line break patterns: "Self- Tracking" or "Self - Tracking" -> "SelfTracking"
  // Preserved: "Self-Tracking" (no spaces around hyphen)
  const cleanHyphenatedLineBreaks = (text: string): string => {
    return text
      .replace(/(\w)- (\w)/g, '$1$2') // "hyper- visor" -> "hypervisor" (hyphen + space)
      .replace(/(\w) - (\w)/g, '$1$2') // "hyper - visor" -> "hypervisor" (space + hyphen + space)
      .replace(/(\w) -(\w)/g, '$1$2') // "hyper -visor" -> "hypervisor" (space + hyphen)
      .replace(/\s+/g, ' ') // Normalize remaining whitespace
      .trim();
  };

  // Normalize whitespace for easier parsing
  const normalizedText = fullText.replace(/\s+/g, ' ');

  // Find the references section - look for common headers (case insensitive, flexible spacing)
  const refSectionPatterns = [
    /\bReferences?\b/i,
    /\bBibliography\b/i,
    /\bWorks\s+Cited\b/i,
    /\bLiterature\s+Cited\b/i,
    /\bCited\s+Literature\b/i,
  ];

  // Patterns that indicate END of references section (appendices, etc.)
  const endSectionPatterns = [
    /\bAppendix\s*[A-Z]?\b/i,
    /\bFull\s+Corpus\b/i,
    /\bSupplementary\s+Materials?\b/i,
    /\bAcknowledgements?\b/i,
    /\bAcknowledgments?\b/i,
    /\bAbout\s+the\s+Authors?\b/i,
    /\bAuthor\s+Biographies?\b/i,
    /\bTable\s+\d+:/i,
    /\bFigure\s+\d+:/i,
  ];

  let refSectionStart = -1;
  for (const pattern of refSectionPatterns) {
    const match = normalizedText.match(pattern);
    if (match && match.index !== undefined) {
      // Search in the last 50% of the document
      const lastPortion = normalizedText.slice(Math.floor(normalizedText.length * 0.5));
      const portionOffset = Math.floor(normalizedText.length * 0.5);

      // Find ALL occurrences of the pattern
      const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      const allMatches: { index: number; length: number }[] = [];
      let execMatch: RegExpExecArray | null;
      while ((execMatch = globalPattern.exec(lastPortion)) !== null) {
        allMatches.push({ index: execMatch.index, length: execMatch[0].length });
      }

      // Check each match to see if it looks like a section header (followed by citations)
      // Prefer the FIRST one that has citation patterns after it
      for (const m of allMatches) {
        const textAfterMatch = lastPortion.slice(m.index + m.length, m.index + m.length + 500);
        // Look for citation patterns: [1], [2], or numbered like "1." at start of line
        const hasCitationPattern = /\[1\]|\n\s*1\.\s+[A-Z]/.test(textAfterMatch);

        if (hasCitationPattern) {
          refSectionStart = portionOffset + m.index + m.length;
          console.log(`[RefParser] Found references section at position ${refSectionStart} using pattern: ${pattern} (verified by citation pattern)`);
          break;
        }
      }

      // If no match with citation pattern, fall back to first occurrence
      if (refSectionStart === -1 && allMatches.length > 0) {
        const firstMatch = allMatches[0];
        refSectionStart = portionOffset + firstMatch.index + firstMatch.length;
        console.log(`[RefParser] Found references section at position ${refSectionStart} using pattern: ${pattern} (first occurrence, no citation pattern verified)`);
      }

      if (refSectionStart !== -1) break;
    }
  }

  // If we didn't find a header, look for numbered entries in the last portion
  if (refSectionStart === -1) {
    const lastThird = normalizedText.slice(-Math.floor(normalizedText.length / 3));
    // Look for [1] pattern
    const bracketMatch = lastThird.match(/\[1\]/);
    if (bracketMatch && bracketMatch.index !== undefined) {
      refSectionStart = normalizedText.length - lastThird.length + bracketMatch.index;
      console.log(`[RefParser] Found references by [1] pattern at position ${refSectionStart}`);
    }
  }

  if (refSectionStart === -1) {
    console.log('[RefParser] Could not find references section in PDF');
    return references;
  }

  let refSection = normalizedText.slice(refSectionStart);
  const originalRefSectionLength = refSection.length;

  // First, find ALL bracket patterns in the full text (before any trimming)
  // This is important for 2-column PDFs where "Table X:" might appear mid-references
  // due to interleaved column extraction
  const bracketPatternPreCheck = /\[(\d+)\]/g;
  const allBracketMatches: { num: number; index: number }[] = [];
  let preCheckMatch;
  while ((preCheckMatch = bracketPatternPreCheck.exec(refSection)) !== null) {
    allBracketMatches.push({ num: parseInt(preCheckMatch[1], 10), index: preCheckMatch.index });
  }

  // Find the last sequential reference to determine where references truly end
  let preCheckLastIndex = 0;
  let preCheckExpectedNum = 1;
  for (const m of allBracketMatches) {
    if (m.num >= preCheckExpectedNum && m.num <= preCheckExpectedNum + 5) {
      preCheckLastIndex = m.index;
      preCheckExpectedNum = m.num + 1;
    } else if (m.num === 1 && preCheckExpectedNum === 1) {
      preCheckLastIndex = m.index;
      preCheckExpectedNum = 2;
    }
  }

  // Estimate where the last reference ends (index + ~500 chars for a typical reference)
  const estimatedLastRefEnd = preCheckLastIndex + 500;
  console.log(`[RefParser] Last sequential ref [${preCheckExpectedNum - 1}] found at index ${preCheckLastIndex}, estimated end at ${estimatedLastRefEnd}`);

  // Find and trim at end-of-references patterns (appendices, etc.)
  // But ONLY if they appear AFTER the last sequential reference
  let refSectionEnd = refSection.length;
  for (const endPattern of endSectionPatterns) {
    const endMatch = refSection.match(endPattern);
    if (endMatch && endMatch.index !== undefined && endMatch.index > 100) {
      // Only consider it if it's after the last sequential reference
      // This prevents interleaved content (like "Table 1:" from another column) from cutting off references
      if (endMatch.index > estimatedLastRefEnd && endMatch.index < refSectionEnd) {
        refSectionEnd = endMatch.index;
        console.log(`[RefParser] Detected end of references at position ${endMatch.index} via pattern: ${endPattern}`);
      } else if (endMatch.index <= estimatedLastRefEnd) {
        console.log(`[RefParser] Ignoring end pattern at position ${endMatch.index} (before last ref at ${preCheckLastIndex}) - likely interleaved column content`);
      }
    }
  }

  if (refSectionEnd < refSection.length) {
    console.log(`[RefParser] Trimming reference section from ${refSection.length} to ${refSectionEnd} chars`);
    refSection = refSection.slice(0, refSectionEnd);
  } else {
    console.log(`[RefParser] No trimming needed, using full reference section`);
  }

  console.log(`[RefParser] Reference section length: ${refSection.length} chars (original: ${originalRefSectionLength})`);
  console.log(`[RefParser] First 500 chars of ref section: ${refSection.slice(0, 500)}`);

  // Helper: Check if text looks like a valid reference citation (not a table row)
  // Relaxed validation to handle various formatting styles (including all lowercase)
  const looksLikeCitation = (text: string): boolean => {
    // Too short to be a real citation
    if (text.length < 30) return false;

    // Should have substantial text content (not just short fragments)
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 5) return false;

    return true;
  };

  // Try bracket style first: [1] ... [2] ...
  const bracketPattern = /\[(\d+)\]/g;
  const bracketMatches: { num: string; index: number }[] = [];
  let match;

  while ((match = bracketPattern.exec(refSection)) !== null) {
    bracketMatches.push({ num: match[1], index: match.index });
  }

  // Filter to only sequential references (avoid picking up stray [N] in text)
  // References should be roughly sequential: 1, 2, 3, ... or close to it
  const sequentialMatches: { num: string; index: number }[] = [];
  let expectedNum = 1;
  for (const m of bracketMatches) {
    const num = parseInt(m.num, 10);
    // Allow some gaps (missing refs) but not huge jumps
    if (num >= expectedNum && num <= expectedNum + 5) {
      sequentialMatches.push(m);
      expectedNum = num + 1;
    } else if (num === 1 && sequentialMatches.length === 0) {
      // Always accept [1] as start
      sequentialMatches.push(m);
      expectedNum = 2;
    }
  }

  console.log(`[RefParser] Found ${bracketMatches.length} total bracket patterns, ${sequentialMatches.length} sequential references`);

  if (sequentialMatches.length >= 3) {
    let validCount = 0;
    let invalidCount = 0;

    for (let i = 0; i < sequentialMatches.length; i++) {
      const current = sequentialMatches[i];
      const next = sequentialMatches[i + 1];
      const startIdx = current.index + current.num.length + 2; // skip "[N]"
      const endIdx = next ? next.index : refSection.length;
      const rawRefText = refSection.slice(startIdx, endIdx).trim();
      const refText = cleanHyphenatedLineBreaks(rawRefText); // Clean up hyphenated line breaks

      if (refText.length > 10 && looksLikeCitation(refText)) {
        references.set(current.num, refText);
        validCount++;
      } else {
        invalidCount++;
        if (invalidCount <= 3) {
          console.log(`[RefParser] Skipped ref [${current.num}] - doesn't look like citation: "${refText.slice(0, 80)}..."`);
        }
      }
    }

    console.log(`[RefParser] Validated ${validCount} citations, skipped ${invalidCount}`);
  }

  // If bracket style didn't work, try numbered style: 1. ... 2. ...
  if (references.size === 0) {
    const numberedPattern = /(?:^|\s)(\d{1,3})\.\s+([A-Z])/g;
    const numberedMatches: { num: string; index: number }[] = [];

    while ((match = numberedPattern.exec(refSection)) !== null) {
      numberedMatches.push({ num: match[1], index: match.index });
    }

    if (numberedMatches.length >= 3) {
      console.log(`[RefParser] Found ${numberedMatches.length} numbered references`);
      for (let i = 0; i < numberedMatches.length; i++) {
        const current = numberedMatches[i];
        const next = numberedMatches[i + 1];
        const startIdx = current.index;
        const endIdx = next ? next.index : refSection.length;
        let refText = refSection.slice(startIdx, endIdx).trim();

        // Remove the leading number
        refText = refText.replace(/^\d{1,3}\.\s*/, '');
        // Clean up hyphenated line breaks
        refText = cleanHyphenatedLineBreaks(refText);

        if (refText.length > 10 && looksLikeCitation(refText)) {
          references.set(current.num, refText);
        }
      }
    }
  }

  console.log(`[RefParser] Total parsed references: ${references.size}`);
  if (references.size > 0) {
    const sample = Array.from(references.entries()).slice(0, 3);
    console.log('[RefParser] Sample references:');
    sample.forEach(([num, text]) => {
      console.log(`  [${num}]: "${text.slice(0, 100)}..."`);
    });
  }

  return references;
}

// Extract a readable title from a reference citation
function extractTitleFromReference(refText: string): string {
  // Try to extract just the title portion
  // Common patterns:
  // Author(s). "Title." Journal...
  // Author(s). Title. Journal...
  // Author(s) (Year). Title. Journal...

  // Look for quoted title first
  const quotedMatch = refText.match(/[""]([^""]+)[""]/);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  // Look for italicized or title after year
  const afterYearMatch = refText.match(/\(\d{4}\)\.\s*([^.]+)/);
  if (afterYearMatch) {
    return afterYearMatch[1].trim();
  }

  // Look for title between first period and second period (common format)
  const parts = refText.split(/\.\s+/);
  if (parts.length >= 2) {
    // Skip author part, get title
    const potentialTitle = parts[1];
    if (potentialTitle && potentialTitle.length > 5 && potentialTitle.length < 200) {
      return potentialTitle;
    }
  }

  // If all else fails, return first 150 chars
  return refText.slice(0, 150) + (refText.length > 150 ? '...' : '');
}

// Extract first author from a reference citation
function extractFirstAuthor(refText: string): string | null {
  // Common patterns for author extraction:
  // "Smith, J., Jones, A., ..." - take "Smith, J."
  // "Smith et al. (2020)" - take "Smith et al."
  // "John Smith, Alice Jones, ..." - take "John Smith"

  // Look for "et al." pattern
  const etAlMatch = refText.match(/^([^,]+(?:,\s*[A-Z]\.?)?\s+et\s+al\.?)/i);
  if (etAlMatch) {
    return etAlMatch[1].trim();
  }

  // Look for first author before "and" or comma with multiple authors
  const beforeAndMatch = refText.match(/^([^,]+(?:,\s*[A-Z]\.?)?)\s*(?:,\s*[A-Z]|,\s*and\s+|\s+and\s+)/i);
  if (beforeAndMatch) {
    return beforeAndMatch[1].trim();
  }

  // Look for author before year in parentheses
  const beforeYearMatch = refText.match(/^([^(]+?)(?:\s*\(\d{4}\))/);
  if (beforeYearMatch) {
    const author = beforeYearMatch[1].trim();
    // Clean up trailing punctuation
    return author.replace(/[.,;:]+$/, '').trim();
  }

  // Look for first segment before a period (author list typically ends with period)
  const firstSegment = refText.split(/\.\s+/)[0];
  if (firstSegment && firstSegment.length < 100) {
    return firstSegment.trim();
  }

  return null;
}

export function Reader() {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { currentProject, isLoading: isProjectLoading } = useProject();

  // Get the source route from location state (for proper back navigation)
  const sourceRoute = (location.state as { from?: string } | null)?.from;

  const [paper, setPaper] = useState<Paper | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1.0);
  const [fitToWidth, setFitToWidth] = useState(true);
  const [containerWidth, setContainerWidth] = useState(800);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedText, setSelectedText] = useState<string>('');
  const [selectionRects, setSelectionRects] = useState<DOMRect[]>([]);
  const [selectionPage, setSelectionPage] = useState<number>(1);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorPickerPosition, setColorPickerPosition] = useState({ x: 0, y: 0 });
  const [editingHighlight, setEditingHighlight] = useState<Highlight | null>(null); // Highlight being edited for a new note
  const [editingHighlightPosition, setEditingHighlightPosition] = useState<{ x: number; y: number } | null>(null); // Position for floating editor
  const [hoveredNoteHighlightId, setHoveredNoteHighlightId] = useState<string | null>(null); // Highlight ID being hovered in sidebar
  const [noteInput, setNoteInput] = useState('');
  const [_currentNoteIndex, setCurrentNoteIndex] = useState(0); // Index of note being viewed
  const [isAddingNewNote, setIsAddingNewNote] = useState(false); // Whether user is adding a new note
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null); // ID of note being edited
  const [_isEditingNote, setIsEditingNote] = useState(false); // Whether currently editing an existing note (vs viewing)
  const [citationNoteInput, setCitationNoteInput] = useState('');
  const [references, setReferences] = useState<Map<string, string>>(new Map());
  const [referencesLoaded, setReferencesLoaded] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'notes' | 'reading'>('notes');
  const [readingList, setReadingList] = useState<Highlight[]>([]);
  const [allReadingListItems, setAllReadingListItems] = useState<Highlight[]>([]); // All reading list items across papers
  const [allPapers, setAllPapers] = useState<Map<string, Paper>>(new Map());
  const [readingListColor, setReadingListColor] = useState<HighlightColor>('purple'); // Reading list color from settings
  const [documentReady, setDocumentReady] = useState(false);
  const [documentKey, setDocumentKey] = useState(0); // Used to force Document recreation
  const [_highestPageViewed, setHighestPageViewed] = useState(0); // Track reading progress

  // Inline title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState('');

  // Paper list sidebar state - load from localStorage
  const [showPaperList, setShowPaperList] = useState(() => {
    const saved = localStorage.getItem('reader-showPaperList');
    return saved !== null ? saved === 'true' : true;
  });
  const [showRightPanel, setShowRightPanel] = useState(() => {
    const saved = localStorage.getItem('reader-showRightPanel');
    return saved !== null ? saved === 'true' : true;
  });
  const [sortOption, setSortOption] = useState<SortOption>('date-desc');
  const [paperSearch, setPaperSearch] = useState(''); // Search query for paper sidebar
  const [searchFocused, setSearchFocused] = useState(false); // Track search input focus
  const [expandSearch, setExpandSearch] = useState(false); // Whether to search all papers or just visible ones
  const [showSortDropdown, setShowSortDropdown] = useState(false); // Sort dropdown visibility
  const [pdfContainerReady, setPdfContainerReady] = useState(false); // For fade-in effect
  const paperScrollPositions = useRef<Map<string, number>>(new Map()); // Store scroll positions per paper

  // Filter state - synced with Library via sessionStorage
  const FILTER_STATE_KEY = 'library-filter-state';
  const loadFilterState = useCallback(() => {
    try {
      const saved = sessionStorage.getItem(FILTER_STATE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          selectedTags: Array.isArray(parsed.selectedTags) ? parsed.selectedTags : [],
          showStarredOnly: Boolean(parsed.showStarredOnly),
          showUnreadOnly: Boolean(parsed.showUnreadOnly),
          showFinishedOnly: Boolean(parsed.showFinishedOnly),
          showUnfinishedOnly: Boolean(parsed.showUnfinishedOnly),
        };
      }
    } catch {
      console.warn('[Reader] Failed to load filter state');
    }
    return { selectedTags: [], showStarredOnly: false, showUnreadOnly: false, showFinishedOnly: false, showUnfinishedOnly: false };
  }, []);
  
  const initialFilterState = loadFilterState();
  const [selectedTags, setSelectedTags] = useState<string[]>(initialFilterState.selectedTags);
  const [showStarredOnly, setShowStarredOnly] = useState(initialFilterState.showStarredOnly);
  const [showUnreadOnly, setShowUnreadOnly] = useState(initialFilterState.showUnreadOnly);
  const [showFinishedOnly, setShowFinishedOnly] = useState(initialFilterState.showFinishedOnly);
  const [showUnfinishedOnly, setShowUnfinishedOnly] = useState(initialFilterState.showUnfinishedOnly);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);

  // Metadata state
  const [metadata, setMetadata] = useState({
    firstAuthor: '',
    venue: '',
    date: '',
    methodology: '',
    conclusion: '',
    limitation: '',
    notes: '',
  });
  const [isAIAutofilling, setIsAIAutofilling] = useState(false);
  const [metadataPanelHeight, setMetadataPanelHeight] = useState(450); // Initial height in pixels
  const [isDragging, setIsDragging] = useState(false);
  const metadataSaveTimeoutRef = useRef<number | null>(null);
  const isInitialMetadataLoadRef = useRef(true);
  const paperRef = useRef<Paper | null>(null);

  // Edit paper modal state
  const [showEditModal, setShowEditModal] = useState(false);

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

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const isMountedRef = useRef(true);
  // Keep a ref to paperId to avoid stale closure issues when switching papers quickly
  const paperIdRef = useRef(paperId);

  const loadData = useCallback(async () => {
    if (!paperId) return;

    const [loadedPaper, file, loadedHighlights, loadedNotes] = await Promise.all([
      getPaper(paperId),
      getPaperFile(paperId),
      getHighlightsByPaper(paperId),
      getNotesByPaper(paperId),
    ]);

    if (loadedPaper) {
      setPaper(loadedPaper);
      paperRef.current = loadedPaper;
      
      // Reading progress tracking is handled by scroll handler
      // highestPageViewed will be set properly when numPages is available
      setHighestPageViewed(0);

      // Mark paper as read if not already
      if (!loadedPaper.isRead) {
        const updatedPaper = { ...loadedPaper, isRead: true };
        await updatePaper(updatedPaper);
        setPaper(updatedPaper);
        paperRef.current = updatedPaper;
        // Also update the paper in allPapers map so sidebar shows updated read status
        setAllPapers(prev => {
          const newMap = new Map(prev);
          newMap.set(updatedPaper.id, updatedPaper);
          return newMap;
        });
      }

      // Load metadata if it exists
      if (loadedPaper.metadata) {
        setMetadata({
          firstAuthor: loadedPaper.metadata.firstAuthor || '',
          venue: loadedPaper.metadata.venue || '',
          date: loadedPaper.metadata.date || '',
          methodology: loadedPaper.metadata.methodology || '',
          conclusion: loadedPaper.metadata.conclusion || '',
          limitation: loadedPaper.metadata.limitation || '',
          notes: loadedPaper.metadata.notes || '',
        });
      } else {
        // Initialize from paper data
        setMetadata({
          firstAuthor: loadedPaper.authors?.split(',')[0]?.trim() || '',
          venue: '',
          date: '',
          methodology: '',
          conclusion: '',
          limitation: '',
          notes: '',
        });
      }
      // Reset the initial load flag after a brief delay
      isInitialMetadataLoadRef.current = true;
      setTimeout(() => {
        isInitialMetadataLoadRef.current = false;
      }, 100);
    }
    // Reset all document states before loading new document
    setDocumentReady(false);
    setNumPages(0);
    setPdfContainerReady(false);
    // Reset references when switching papers
    setReferences(new Map());
    setReferencesLoaded(false);

    // Clear existing PDF data first
    setPdfData(null);

    // Increment documentKey to force Document component recreation
    setDocumentKey(prev => prev + 1);

    if (file) {
      // Reset all document states before loading new document
      setDocumentReady(false);
      setNumPages(0);
      setPdfContainerReady(false);
      // Reset references when switching papers
      setReferences(new Map());
      setReferencesLoaded(false);

      // Clear existing PDF data first
      setPdfData(null);

      // Increment documentKey to force Document component recreation
      setDocumentKey(prev => prev + 1);

      // Use setTimeout to ensure the Document component is fully unmounted
      setTimeout(() => {
        // Create a fresh copy of the ArrayBuffer for the Document component
        const freshData = file.data.slice(0);
        setPdfData(freshData);
      }, 100);
    } else {
      // Clear PDF data if no file
      setPdfData(null);
      setDocumentKey(prev => prev + 1); // Also increment key when clearing
    }
    setHighlights(loadedHighlights);
    setNotes(loadedNotes);

    // Update reading list to only show items from current paper
    const currentPaperReadingList = loadedHighlights.filter(h => h.isFurtherReading);
    setReadingList(currentPaperReadingList);
  }, [paperId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Keep paperIdRef in sync with paperId to avoid stale closure issues
  useEffect(() => {
    paperIdRef.current = paperId;
  }, [paperId]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clear any pending timeouts
      if (metadataSaveTimeoutRef.current) {
        clearTimeout(metadataSaveTimeoutRef.current);
      }
      // Clear page refs to free memory
      pageRefs.current.clear();
    };
  }, []);

  // Load all papers for reading list (needed to show paper info) and settings
  const loadAllPapers = useCallback(async () => {
    if (!currentProject) return;

    const [papers, settings, tags] = await Promise.all([
      getAllPapers(currentProject.id),
      getSettings(currentProject.id),
      getAllTags(currentProject.id),
    ]);
    const paperMap = new Map<string, Paper>();
    papers.forEach((p) => paperMap.set(p.id, p));
    setAllPapers(paperMap);
    setAllTags(tags);
    if (settings.sortOption) {
      setSortOption(settings.sortOption);
    }
    if (settings.readingListColor) {
      setReadingListColor(settings.readingListColor);
    }
  }, [currentProject]);

  useEffect(() => {
    if (!isProjectLoading && currentProject) {
      loadAllPapers();
    }
  }, [loadAllPapers, isProjectLoading, currentProject]);

  // Track reading progress based on scroll position
  useEffect(() => {
    const container = containerRef.current;
    if (!container || numPages === 0) return;

    let saveTimeout: ReturnType<typeof setTimeout> | null = null;
    const initialScrollTop = container.scrollTop;
    let hasPassedMinThreshold = false;
    const MIN_SCROLL_THRESHOLD = 100; // Minimum pixels scrolled before tracking progress

    const handleScroll = () => {
      // Check if user has scrolled at least MIN_SCROLL_THRESHOLD pixels
      const scrollDistance = Math.abs(container.scrollTop - initialScrollTop);
      if (!hasPassedMinThreshold) {
        if (scrollDistance < MIN_SCROLL_THRESHOLD) {
          return; // Don't track progress until minimum scroll threshold is reached
        }
        hasPassedMinThreshold = true;
      }

      // Find which page is most visible
      let maxVisiblePage = 1;
      let maxVisibility = 0;
      
      const containerRect = container.getBoundingClientRect();
      const containerTop = containerRect.top;
      const containerBottom = containerRect.bottom;
      
      pageRefs.current.forEach((pageEl, pageNum) => {
        const pageRect = pageEl.getBoundingClientRect();
        const visibleTop = Math.max(pageRect.top, containerTop);
        const visibleBottom = Math.min(pageRect.bottom, containerBottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        
        if (visibleHeight > maxVisibility) {
          maxVisibility = visibleHeight;
          maxVisiblePage = pageNum;
        }
      });

      // Update highest page viewed if this page is higher
      setHighestPageViewed(prev => {
        const newHighest = Math.max(prev, maxVisiblePage);
        if (newHighest > prev && paperRef.current) {
          // Calculate progress percentage
          const progress = Math.round((newHighest / numPages) * 100);
          
          // Debounce saving to database
          if (saveTimeout) clearTimeout(saveTimeout);
          saveTimeout = setTimeout(async () => {
            if (paperRef.current && paperRef.current.readingProgress !== progress) {
              const updatedPaper = { ...paperRef.current, readingProgress: progress };
              await updatePaper(updatedPaper);
              setPaper(updatedPaper);
              paperRef.current = updatedPaper;
              // Update in allPapers map for sidebar
              setAllPapers(prev => {
                const newMap = new Map(prev);
                newMap.set(updatedPaper.id, updatedPaper);
                return newMap;
              });
            }
          }, 1000); // Save after 1 second of no scrolling
        }
        return newHighest;
      });
    };

    // Initialize highestPageViewed from existing progress to avoid overwriting
    if (paperRef.current?.readingProgress) {
      const existingHighestPage = Math.ceil((paperRef.current.readingProgress / 100) * numPages);
      setHighestPageViewed(existingHighestPage);
      // If already has progress, skip the threshold check
      hasPassedMinThreshold = true;
    }

    container.addEventListener('scroll', handleScroll, { passive: true });
    // Don't call handleScroll() initially - only track progress on actual scroll

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (saveTimeout) clearTimeout(saveTimeout);
    };
  }, [numPages]);

  // Load all reading list items for deduplication
  useEffect(() => {
    getAllFurtherReadingHighlights().then(setAllReadingListItems);
  }, []);

  // Normalize text for fuzzy comparison (handles dashes from line breaks, punctuation, whitespace)
  const normalizeForComparison = (text: string): string => {
    return text
      .toLowerCase()
      .replace(/(\w)- (\w)/g, '$1$2') // Line break: "hyper- visor" -> "hypervisor"
      .replace(/(\w) - (\w)/g, '$1$2') // Line break: "hyper - visor" -> "hypervisor"
      .replace(/(\w) -(\w)/g, '$1$2') // Line break: "hyper -visor" -> "hypervisor"
      .replace(/-/g, '') // Remove remaining hyphens for matching (Self-Tracking vs SelfTracking)
      // NOTE: We remove ALL hyphens for MATCHING since line-break cleanup creates inconsistency
      .replace(/[.,;:()\[\]{}'"]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  };

  // Count active filters for badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (showStarredOnly) count++;
    if (showUnreadOnly) count++;
    if (showFinishedOnly) count++;
    if (showUnfinishedOnly) count++;
    count += selectedTags.length;
    return count;
  }, [showStarredOnly, showUnreadOnly, showFinishedOnly, showUnfinishedOnly, selectedTags]);

  // Compute tag counts for filter modal
  const tagsWithCounts = useMemo(() => {
    const countMap = new Map<string, number>();
    const allPapersArray = Array.from(allPapers.values()).filter(p => !p.isArchived);
    allPapersArray.forEach(paper => {
      paper.tags.forEach(tag => {
        countMap.set(tag, (countMap.get(tag) || 0) + 1);
      });
    });
    return allTags
      .map(tag => ({ tag, count: countMap.get(tag) || 0 }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.tag.localeCompare(b.tag);
      });
  }, [allPapers, allTags]);

  // Memoize filtered and sorted papers for sidebar (expensive computation)
  const { displayPapers, hiddenCount } = useMemo(() => {
    const allPapersArray = Array.from(allPapers.values());
    let filtered = allPapersArray.filter(p => !p.isArchived);
    const searchLower = paperSearch.toLowerCase().trim();

    // Apply search filter
    if (searchLower) {
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(searchLower) ||
        (p.authors && p.authors.toLowerCase().includes(searchLower)) ||
        (p.tags && p.tags.some(tag => tag.toLowerCase().includes(searchLower)))
      );
    }

    // Apply quick filters (synced with Library)
    if (showStarredOnly) {
      filtered = filtered.filter(p => p.isStarred);
    }
    if (showUnreadOnly) {
      filtered = filtered.filter(p => !p.hasAIInsights);
    }
    if (showFinishedOnly) {
      filtered = filtered.filter(p => (p.readingProgress ?? 0) >= 100);
    }
    if (showUnfinishedOnly) {
      filtered = filtered.filter(p => (p.readingProgress ?? 0) < 100);
    }

    // Apply tag filters
    if (selectedTags.length > 0) {
      filtered = filtered.filter(p =>
        selectedTags.every(tag => p.tags.includes(tag))
      );
    }

    const sorted = filtered.sort((a, b) => {
      switch (sortOption) {
        case 'title-asc':
          return a.title.localeCompare(b.title);
        case 'title-desc':
          return b.title.localeCompare(a.title);
        case 'date-asc':
          return new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
        case 'date-desc':
        default:
          return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
      }
    });

    const maxResults = 10;
    const shouldLimit = searchLower && !expandSearch && sorted.length > maxResults;
    return {
      displayPapers: shouldLimit ? sorted.slice(0, maxResults) : sorted,
      hiddenCount: shouldLimit ? sorted.length - maxResults : 0,
    };
  }, [allPapers, paperSearch, sortOption, expandSearch, showStarredOnly, showUnreadOnly, showFinishedOnly, showUnfinishedOnly, selectedTags]);

  // Memoize highlights grouped by page number
  const pageHighlightsMap = useMemo(() => {
    const map = new Map<number, Highlight[]>();
    highlights.forEach(h => {
      if (!map.has(h.pageNumber)) map.set(h.pageNumber, []);
      map.get(h.pageNumber)!.push(h);
    });
    return map;
  }, [highlights]);

  // Switch to a different paper while preserving scroll position
  const switchToPaper = useCallback((targetPaperId: string) => {
    if (targetPaperId === paperId) return;

    // Save current scroll position before switching
    if (paperId && containerRef.current) {
      paperScrollPositions.current.set(paperId, containerRef.current.scrollTop);
    }

    // Immediately update paper state from allPapers so title shows right away
    const targetPaper = allPapers.get(targetPaperId);
    if (targetPaper) {
      setPaper(targetPaper);
      paperRef.current = targetPaper;
    }

    // Clear PDF state before switching to prevent ArrayBuffer detachment errors
    setPdfData(null);
    setDocumentReady(false);
    setNumPages(0);
    setPdfContainerReady(false);

    // Clear page refs to prevent memory leak
    pageRefs.current.clear();

    // Navigate to the new paper, preserving the source route
    navigate(`/reader/${targetPaperId}`, { state: { from: sourceRoute }, replace: true });
  }, [paperId, navigate, sourceRoute, allPapers]);

  // Toggle paper read status
  const togglePaperReadStatus = useCallback(async (e: React.MouseEvent<HTMLButtonElement>, paper: Paper) => {
    e.stopPropagation();
    const updatedPaper = { ...paper, isRead: !paper.isRead };

    // Optimistically update local state immediately
    setAllPapers(prev => {
      const newMap = new Map(prev);
      newMap.set(updatedPaper.id, updatedPaper);
      return newMap;
    });

    // Also update current paper if it's the one being toggled
    if (paper.id === paperId && paper) {
      setPaper(updatedPaper);
      paperRef.current = updatedPaper;
    }

    // Save to database in background
    try {
      await updatePaper(updatedPaper);
    } catch (error) {
      console.error('Failed to update paper read status:', error);
      // Revert on error
      setAllPapers(prev => {
        const newMap = new Map(prev);
        newMap.set(paper.id, paper);
        return newMap;
      });
      if (paper.id === paperId && paper) {
        setPaper(paper);
        paperRef.current = paper;
      }
    }
  }, [paperId]);

  // Toggle paper starred status
  const togglePaperStarred = useCallback(async (e: React.MouseEvent<HTMLButtonElement>, paper: Paper) => {
    e.stopPropagation();
    const updatedPaper = { ...paper, isStarred: !paper.isStarred };

    // Optimistically update local state immediately
    setAllPapers(prev => {
      const newMap = new Map(prev);
      newMap.set(updatedPaper.id, updatedPaper);
      return newMap;
    });

    // Also update current paper if it's the one being toggled
    if (paper.id === paperId && paper) {
      setPaper(updatedPaper);
      paperRef.current = updatedPaper;
    }

    // Save to database in background
    try {
      await updatePaper(updatedPaper);
    } catch (error) {
      console.error('Failed to update paper starred status:', error);
      // Revert on error
      setAllPapers(prev => {
        const newMap = new Map(prev);
        newMap.set(paper.id, paper);
        return newMap;
      });
      if (paper.id === paperId && paper) {
        setPaper(paper);
        paperRef.current = paper;
      }
    }
  }, [paperId]);

  // Restore scroll position after document loads
  useEffect(() => {
    if (documentReady && paperId && containerRef.current) {
      const savedScrollPosition = paperScrollPositions.current.get(paperId);
      if (savedScrollPosition !== undefined) {
        // Small delay to ensure the document is fully rendered
        setTimeout(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = savedScrollPosition;
          }
        }, 100);
      }
    }
  }, [documentReady, paperId]);

  // Measure container width for fit-to-width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth - 64; // padding
        setContainerWidth(width);
      }
    };

    // Update immediately and after a short delay (for sidebar animation)
    updateWidth();
    const timeoutId = setTimeout(updateWidth, 250);

    window.addEventListener('resize', updateWidth);
    return () => {
      window.removeEventListener('resize', updateWidth);
      clearTimeout(timeoutId);
    };
  }, [showPaperList]);

  // Sync filter state to sessionStorage (syncs with Library)
  useEffect(() => {
    // Preserve searchQuery from Library when saving
    try {
      const existingState = sessionStorage.getItem(FILTER_STATE_KEY);
      const existing = existingState ? JSON.parse(existingState) : {};
      sessionStorage.setItem(FILTER_STATE_KEY, JSON.stringify({
        ...existing,
        selectedTags,
        showStarredOnly,
        showUnreadOnly,
        showFinishedOnly,
        showUnfinishedOnly,
      }));
    } catch {
      console.warn('[Reader] Failed to save filter state');
    }
  }, [selectedTags, showStarredOnly, showUnreadOnly, showFinishedOnly, showUnfinishedOnly]);

  // Save panel states to localStorage
  useEffect(() => {
    localStorage.setItem('reader-showPaperList', String(showPaperList));
    // Trigger resize event after animation completes to recalculate PDF width
    const timeoutId = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 250); // Match the CSS transition duration
    return () => clearTimeout(timeoutId);
  }, [showPaperList]);

  useEffect(() => {
    localStorage.setItem('reader-showRightPanel', String(showRightPanel));
    // Trigger resize event after animation completes to recalculate PDF width
    const timeoutId = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 250); // Match the CSS transition duration
    return () => clearTimeout(timeoutId);
  }, [showRightPanel]);

  // Save scroll position to localStorage on scroll (debounced)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !paperId) return;

    let saveTimeout: number | null = null;

    const handleScroll = () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = window.setTimeout(() => {
        const positions = JSON.parse(localStorage.getItem('reader-scrollPositions') || '{}');
        positions[paperId] = container.scrollTop;
        localStorage.setItem('reader-scrollPositions', JSON.stringify(positions));
      }, 300);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (saveTimeout) clearTimeout(saveTimeout);
    };
  }, [paperId]);

  // Restore scroll position from localStorage on load
  useEffect(() => {
    if (documentReady && paperId && containerRef.current) {
      const positions = JSON.parse(localStorage.getItem('reader-scrollPositions') || '{}');
      const savedPosition = positions[paperId];
      if (savedPosition !== undefined) {
        // Use a small delay to ensure PDF pages are rendered
        setTimeout(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = savedPosition;
          }
        }, 150);
      }
    }
  }, [documentReady, paperId]);

  // Show scrollbar when scrolling, hide after scroll stops
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scrollTimeout: number | null = null;

    const handleScroll = () => {
      // Add class to show scrollbar
      container.classList.add('is-scrolling');

      // Clear existing timeout
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      // Hide scrollbar after scrolling stops (300ms delay)
      scrollTimeout = window.setTimeout(() => {
        container.classList.remove('is-scrolling');
      }, 300);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
    };
  }, []);

  // Set pdfContainerReady when document is actually ready
  useEffect(() => {
    if (documentReady && numPages > 0) {
      // Small delay to ensure PDF pages have rendered
      const timeoutId = setTimeout(() => {
        setPdfContainerReady(true);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [documentReady, numPages]);

  // Handle highlight query parameter (from Notes page)
  useEffect(() => {
    const highlightId = searchParams.get('highlight');
    if (highlightId && pdfContainerReady && highlights.length > 0) {
      const targetHighlight = highlights.find(h => h.id === highlightId);
      if (targetHighlight) {
        // Scroll to the highlight and center it with pulse animation
        setTimeout(() => {
          scrollToHighlight(targetHighlight);
        }, 200);
      }
    }
  }, [searchParams, pdfContainerReady, highlights]);

  const onDocumentLoadSuccess = ({ numPages: pages }: { numPages: number }) => {
    setNumPages(pages);
    // Small delay to ensure the document is fully ready before rendering pages
    setTimeout(() => {
      setDocumentReady(true);
    }, 50);
  };

  const onDocumentLoadError = (error: Error) => {
    console.error('PDF document load error:', error);
    setDocumentReady(false);
    setNumPages(0);
    setPdfData(null);
  };

  // Extract references from PDF - reload from database to get fresh ArrayBuffer
  useEffect(() => {
    if (!paperId || referencesLoaded) return;

    const extractReferences = async () => {
      try {
        // Reload the file from database to ensure we have a fresh, non-detached ArrayBuffer
        // This is safer than trying to reuse a potentially detached buffer
        const file = await getPaperFile(paperId);
        if (!file) {
          setReferencesLoaded(true);
          return;
        }

        const pdfDataCopy = file.data.slice(0);
        const pdf = await pdfjs.getDocument({ data: pdfDataCopy }).promise;
        let fullText = '';

        // Extract text from all pages
        const numPagesToExtract = pdf.numPages;
        for (let i = 1; i <= numPagesToExtract; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => (item.str || '') as string)
            .join(' ');
          fullText += pageText + '\n';
        }

        // Parse references from the extracted text
        const parsedRefs = parseReferences(fullText);
        setReferences(parsedRefs);
        setReferencesLoaded(true);

        if (parsedRefs.size > 0) {
          console.log(`Parsed ${parsedRefs.size} references from PDF`);
        }

        // Clean up
        pdf.destroy();
      } catch (error) {
        console.error('Error extracting PDF text:', error);
        setReferencesLoaded(true); // Mark as loaded to prevent retries
      }
    };

    // Delay extraction slightly to let the main document load first
    const timer = setTimeout(extractReferences, 200);
    return () => clearTimeout(timer);
  }, [paperId, referencesLoaded]);

  // Handle divider dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const sidebar = document.querySelector('[data-sidebar="notes-metadata"]') as HTMLElement;
      if (!sidebar) return;

      const sidebarRect = sidebar.getBoundingClientRect();
      const newHeight = sidebarRect.bottom - e.clientY;

      // Constrain height between 200px and 70% of viewport
      const minHeight = 200;
      const maxHeight = window.innerHeight * 0.7;
      const constrainedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

      setMetadataPanelHeight(constrainedHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging]);

  // Calculate effective scale
  const effectiveScale = fitToWidth ? containerWidth / 612 : scale; // 612 is standard PDF width in points


  // Detect reference numbers in selected text - more flexible matching
  const detectReference = (text: string): string | null => {
    const trimmed = text.trim();

    // More flexible patterns that can match within text
    const patterns = [
      /\[(\d+(?:\s*[-–,]\s*\d+)*)\]/,     // [1], [1-3], [1, 2, 3], [1–3]
      /\((\d+(?:\s*[-–,]\s*\d+)*)\)/,     // (1), (1-3), (1, 2, 3)
      /^(\d+)$/,                           // just number like "23"
      /^(\d+)\s*[-–]\s*(\d+)$/,           // range like "23-25" or "23–25"
    ];

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        return match[1] || match[0];
      }
    }

    // Also check if it's a short text that contains mostly numbers (likely a reference)
    if (trimmed.length <= 10 && /^\[?\(?\d/.test(trimmed)) {
      const numbers = trimmed.match(/\d+/g);
      if (numbers) {
        return numbers.join(', ');
      }
    }

    return null;
  };

  // Check if selection looks like a reference
  const isLikelyReference = (text: string): boolean => {
    const trimmed = text.trim();
    // Short text containing brackets/parens with numbers
    if (trimmed.length <= 15) {
      return /[\[\(]\s*\d+/.test(trimmed) || /^\d+$/.test(trimmed);
    }
    return false;
  };

  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    // Don't dismiss if there's text in the citation note input
    if (citationNoteInput.trim()) {
      return;
    }
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setShowColorPicker(false);
      setCitationNoteInput('');
      return;
    }

    const text = selection.toString().trim();
    if (!text) return;

    const range = selection.getRangeAt(0);
    const rects = Array.from(range.getClientRects());

    if (rects.length === 0) return;

    // Find which page the selection is in
    let selectedPage = 1;
    const anchorNode = selection.anchorNode;
    // Check if selection is within the PDF area (has a data-page ancestor)
    let foundDataPage = false;
    if (anchorNode) {
      let element = anchorNode.parentElement;
      while (element) {
        const pageAttr = element.getAttribute('data-page');
        if (pageAttr) {
          selectedPage = parseInt(pageAttr);
          foundDataPage = true;
          break;
        }
        element = element.parentElement;
      }
    }

    // If selection is not within PDF area, don't show popup
    if (!foundDataPage) {
      return;
    }

    setSelectedText(text);
    setSelectionRects(rects);
    setSelectionPage(selectedPage);

    // Position color picker near the selection end
    const lastRect = rects[rects.length - 1];
    const scrollTop = containerRef.current?.scrollTop || 0;
    const scrollLeft = containerRef.current?.scrollLeft || 0;
    const containerRect = containerRef.current?.getBoundingClientRect();

    // Convert viewport coordinates to container-relative coordinates
    const containerLeft = containerRect?.left || 0;
    const containerTop = containerRect?.top || 0;
    const containerWidth = containerRect?.width || window.innerWidth;

    // Calculate x position relative to container, accounting for horizontal scroll
    const relativeX = lastRect.right - containerLeft + scrollLeft + 8;
    // Ensure popup doesn't go off the right edge (popup can be up to 400px wide + padding)
    const popupWidth = 420;
    const maxX = Math.max(16, containerWidth - popupWidth - 16);
    // Also ensure popup doesn't go off the left edge
    const clampedX = Math.max(16, Math.min(relativeX, maxX));

    setColorPickerPosition({
      x: clampedX,
      y: lastRect.top - containerTop + scrollTop,
    });
    setShowColorPicker(true);
  }, [citationNoteInput]);

  useEffect(() => {
    // Only show color picker after selection is complete (mouseup/touchend)
    // Don't use selectionchange as it fires during selection and interrupts the user
    document.addEventListener('mouseup', handleTextSelection);
    document.addEventListener('touchend', handleTextSelection);

    return () => {
      document.removeEventListener('mouseup', handleTextSelection);
      document.removeEventListener('touchend', handleTextSelection);
    };
  }, [handleTextSelection]);

  // Handle Escape key to dismiss popup
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showColorPicker) {
        setShowColorPicker(false);
        setCitationNoteInput('');
        window.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showColorPicker]);

  // Get reference info for a detected reference number
  const getReferenceInfo = (refNumber: string): { title: string; fullCitation: string } | null => {
    // Handle comma-separated or range references - just use the first one
    const firstNum = refNumber.split(/[,\-–]/)[0].trim();

    console.log(`Looking up reference [${firstNum}] in map with ${references.size} entries`);

    const refText = references.get(firstNum);
    if (refText) {
      const title = extractTitleFromReference(refText);
      const author = extractFirstAuthor(refText);
      console.log(`Found reference [${firstNum}]: title="${title}", author="${author}"`);
      return { title: title || '', fullCitation: refText };
    }

    console.log(`Reference [${firstNum}] not found in map`);
    return null;
  };

  // Merge overlapping rects to prevent double-highlighting on multi-line selections
  const mergeOverlappingRects = (rects: { x: number; y: number; width: number; height: number }[]) => {
    if (rects.length === 0) return rects;

    // Sort by y first, then by x
    const sorted = [...rects].sort((a, b) => {
      const yDiff = a.y - b.y;
      if (Math.abs(yDiff) > 2) return yDiff; // Different lines
      return a.x - b.x; // Same line, sort by x
    });

    const merged: typeof rects = [];

    for (const rect of sorted) {
      if (merged.length === 0) {
        merged.push({ ...rect });
        continue;
      }

      const last = merged[merged.length - 1];

      // Check if rects are on the same line (y within tolerance) and overlap or touch
      const sameLine = Math.abs(rect.y - last.y) < 3;
      const overlapsOrTouches = rect.x <= last.x + last.width + 1;

      if (sameLine && overlapsOrTouches) {
        // Merge: extend the last rect to include this one
        const newRight = Math.max(last.x + last.width, rect.x + rect.width);
        last.width = newRight - last.x;
        last.height = Math.max(last.height, rect.height);
      } else {
        merged.push({ ...rect });
      }
    }

    return merged;
  };

  const createHighlight = async (color: HighlightColor, isFurtherReading: boolean = false, note?: string) => {
    // Use ref to get the CURRENT paperId, avoiding stale closure issues when switching papers quickly
    const currentPaperId = paperIdRef.current;
    if (!currentPaperId || !selectedText) return;

    const pageContainer = pageRefs.current.get(selectionPage);
    if (!pageContainer) return;

    // Get fresh selection rects at the moment of creation (fixes iPadOS offset issues)
    const selection = window.getSelection();
    let currentRects = selectionRects;

    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      currentRects = Array.from(range.getClientRects());
    }

    const wrapperRect = pageContainer.getBoundingClientRect();

    // Convert viewport coords to wrapper-relative, then divide by scale
    // Filter out tiny rects (invisible whitespace, line breaks, etc.)
    const rawRects = currentRects
      .filter((rect) => rect.width > 5 && rect.height > 5)
      .map((rect) => ({
        x: (rect.x - wrapperRect.x) / effectiveScale,
        y: (rect.y - wrapperRect.y) / effectiveScale,
        width: rect.width / effectiveScale,
        height: rect.height / effectiveScale,
      }));

    if (rawRects.length === 0) return;

    // Merge overlapping rects to prevent double-highlighting
    const rects = mergeOverlappingRects(rawRects);

    // Check if this looks like a reference
    const refNumber = detectReference(selectedText);

    // Mark as further reading if:
    // Mark as further reading if user clicked the "Further Reading" button
    const markAsFurtherReading = isFurtherReading;

    // Get the reference title if available
    let noteText: string | undefined = note;
    let highlightText = selectedText;

    if (refNumber && markAsFurtherReading) {
      const refInfo = getReferenceInfo(refNumber);
      if (refInfo) {
        // Use the title as the main text for the highlight
        highlightText = refInfo.title;
        // Combine full citation with user's note if provided
        const citationNote = `[${refNumber}] ${refInfo.fullCitation}`;
        noteText = note ? `${citationNote}\n\n${note}` : citationNote;
      } else {
        noteText = note ? `Reference [${refNumber}]\n\n${note}` : `Reference [${refNumber}]`;
      }
    }

    // Check for duplicates before creating a further reading highlight
    if (markAsFurtherReading) {
      const isDuplicate = allReadingListItems.some(item =>
        normalizeForComparison(item.text) === normalizeForComparison(highlightText)
      );
      if (isDuplicate) {
        console.log('[Reader] Skipping duplicate reading list item:', highlightText.slice(0, 50));
        setShowColorPicker(false);
        setCitationNoteInput('');
        window.getSelection()?.removeAllRanges();
        return;
      }
    }

    const highlight: Highlight = {
      id: uuidv4(),
      paperId: currentPaperId,
      pageNumber: selectionPage,
      // For further reading, use the selected color (allow user to choose, default to reading list color)
      color: markAsFurtherReading ? (color || readingListColor) : color,
      text: highlightText,
      rects,
      note: noteText,
      isFurtherReading: markAsFurtherReading,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await addHighlight(highlight);
    setHighlights((prev) => [...prev, highlight]);
    if (markAsFurtherReading && highlight.paperId === currentPaperId) {
      // Add to reading list if it's from current paper
      setReadingList((prev) => [...prev, highlight]);
      // Also update global list for deduplication
      setAllReadingListItems((prev) => [...prev, highlight]);
    }
    setShowColorPicker(false);
    setCitationNoteInput('');
    window.getSelection()?.removeAllRanges();
  };


  const handleAddNote = async () => {
    if (!editingHighlight || !noteInput.trim() || !paperId) return;

    const note: Note = {
      id: uuidv4(),
      highlightId: editingHighlight.id,
      paperId,
      content: noteInput.trim(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await addNote(note);
    setNotes((prev) => [...prev, note]);
    setNoteInput('');
    setIsAddingNewNote(false);
    setEditingNoteId(null); // Return to view mode, not edit mode
    setCurrentNoteIndex(notes.filter(n => n.highlightId === editingHighlight.id).length);
  };

  const handleUpdateNote = async () => {
    if (!editingNoteId || !noteInput.trim()) return;
    
    const existingNote = notes.find(n => n.id === editingNoteId);
    if (!existingNote) return;

    const updatedNote: Note = {
      ...existingNote,
      content: noteInput.trim(),
      updatedAt: new Date(),
    };

    await updateNote(updatedNote);
    setNotes((prev) => prev.map((n) => (n.id === editingNoteId ? updatedNote : n)));
  };

  const handleDeleteNote = async (noteId: string) => {
    await deleteNote(noteId);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  const handleDeleteHighlight = async (highlightId: string) => {
    await deleteHighlight(highlightId);
    setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
    setReadingList((prev) => prev.filter((h) => h.id !== highlightId));
    // Also remove from global reading list for deduplication
    setAllReadingListItems((prev) => prev.filter((h) => h.id !== highlightId));
    // Also delete related notes
    const relatedNotes = notes.filter((n) => n.highlightId === highlightId);
    for (const note of relatedNotes) {
      await deleteNote(note.id);
    }
    setNotes((prev) => prev.filter((n) => n.highlightId !== highlightId));
    setEditingHighlight(null);
    setEditingHighlightPosition(null);
    setCurrentNoteIndex(0);
    setIsAddingNewNote(false);
    setEditingNoteId(null);
    setIsEditingNote(false);
  };

  const handleChangeHighlightColor = async (highlight: Highlight, newColor: HighlightColor) => {
    const updated = { ...highlight, color: newColor, updatedAt: new Date() };
    await updateHighlight(updated);
    setHighlights((prev) => prev.map((h) => (h.id === highlight.id ? updated : h)));
    setEditingHighlight(updated);
  };

  // Reading list helpers
  const isReadingItemResolved = (highlight: Highlight) => highlight.note?.includes('✓');

  const toggleReadingResolved = async (highlight: Highlight) => {
    const updated = {
      ...highlight,
      note: highlight.note?.includes('✓')
        ? highlight.note.replace(' ✓', '')
        : (highlight.note || 'Reference') + ' ✓',
      updatedAt: new Date(),
    };
    await updateHighlight(updated);
    setReadingList((prev) => prev.map((h) => (h.id === highlight.id ? updated : h)));
  };


  // Autosave metadata with debounce
  useEffect(() => {
    if (!paperRef.current || isInitialMetadataLoadRef.current) return;

    // Clear existing timeout
    if (metadataSaveTimeoutRef.current) {
      clearTimeout(metadataSaveTimeoutRef.current);
    }

    // Set new timeout for autosave (500ms delay)
    metadataSaveTimeoutRef.current = window.setTimeout(async () => {
      const currentPaper = paperRef.current;
      if (!currentPaper) return;

      try {
        const updatedPaper: Paper = {
          ...currentPaper,
          metadata: {
            firstAuthor: metadata.firstAuthor,
            venue: metadata.venue,
            date: metadata.date,
            methodology: metadata.methodology,
            conclusion: metadata.conclusion,
            limitation: metadata.limitation,
            notes: metadata.notes,
          },
        };
        await updatePaper(updatedPaper);
        paperRef.current = updatedPaper;
        setPaper(updatedPaper);
      } catch (error) {
        console.error('Failed to save metadata:', error);
      }
    }, 500);

    // Cleanup on unmount
    return () => {
      if (metadataSaveTimeoutRef.current) {
        clearTimeout(metadataSaveTimeoutRef.current);
      }
    };
  }, [
    metadata.firstAuthor,
    metadata.venue,
    metadata.date,
    metadata.methodology,
    metadata.conclusion,
    metadata.limitation,
    metadata.notes,
  ]);

  // Handle paper save from modal
  const handlePaperSave = (updatedPaper: Paper) => {
    setPaper(updatedPaper);
    paperRef.current = updatedPaper;
    setAllPapers(prev => {
      const newMap = new Map(prev);
      newMap.set(updatedPaper.id, updatedPaper);
      return newMap;
    });
  };

  // Handle metadata change from modal
  const handleMetadataChange = (field: string, value: string) => {
    setMetadata(prev => ({ ...prev, [field]: value }));
  };

  const handleAIAutofill = async () => {
    if (!paper) return;

    // Capture the paper at the moment the user clicks - this ensures we update
    // the correct paper even if the user switches papers during the async operation
    const targetPaper = paper;
    const targetPaperId = paper.id;

    setIsAIAutofilling(true);
    let extractionPdf: any = null;
    try {
      const settings = await getSettings();

      // Extract text from PDF using a separate instance (don't destroy the main one)
      // Reload the file from database to ensure we have a fresh, non-detached ArrayBuffer
      // This is safer than trying to copy a potentially detached buffer
      const file = await getPaperFile(targetPaperId);
      if (!file) {
        throw new Error('PDF file not found');
      }
      const pdfDataCopy = file.data.slice(0);
      extractionPdf = await pdfjs.getDocument({ data: pdfDataCopy }).promise;
      let fullText = '';

      // Extract text from all pages
      const pagesToExtract = extractionPdf.numPages;
      for (let i = 1; i <= pagesToExtract; i++) {
        const page = await extractionPdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => (item.str || '') as string)
          .join(' ');
        fullText += pageText + '\n';
      }

      // Clean up the extraction PDF instance
      extractionPdf.destroy();
      extractionPdf = null;

      // Collect all existing notes from highlights and separate note objects
      const allUserNotes: string[] = [];

      // Collect notes from highlights (highlight.note field)
      highlights.forEach((highlight) => {
        if (highlight.note && highlight.note.trim()) {
          allUserNotes.push(`Highlight: "${highlight.text}" - Note: ${highlight.note}`);
        }
      });

      // Collect notes from separate Note objects
      notes.forEach((note) => {
        const relatedHighlight = highlights.find((h) => h.id === note.highlightId);
        if (relatedHighlight) {
          allUserNotes.push(`Highlight: "${relatedHighlight.text}" - Note: ${note.content}`);
        } else {
          allUserNotes.push(`Note: ${note.content}`);
        }
      });

      const userNotesSection = allUserNotes.length > 0
        ? `\n\nMy Sticky Notes on This Paper:\n${allUserNotes.join('\n\n')}`
        : '\n\nI have NOT made any sticky notes or highlights on this paper yet.';

      // Build the prompt
      const researchContext = settings.researchContext
        ? `\n\nMy Research Context:\n${settings.researchContext}\n\nPlease extract information relevant to my research focus.`
        : '';

      const prompt = `Extract metadata from the following research paper text and provide it in JSON format. Focus on extracting key information that would be useful for research note-taking.

${researchContext}

${userNotesSection}

Paper Text (all ${pagesToExtract} pages):
${fullText}

Please extract and return a JSON object with the following fields:
- title: The full official title of the paper
- firstAuthor: First author's name (e.g., "Smith, J." or "John Smith")
- authors: Full author list (e.g., "Smith, John and Johnson, Alice and Wang, Bob")
- venue: Publication venue short name (CHI, UIST, CSCW, etc.)
- booktitle: Full conference/proceedings name (e.g., "Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems")
- date: Publication year (e.g., "2024")
- doi: DOI if found in the paper (e.g., "10.1145/3613904.3642123")
- pages: Page range if found (e.g., "1-12")
- articleNo: Article number if found (e.g., "42")
- publisher: Publisher name (e.g., "Association for Computing Machinery" or "ACM")
- location: Conference location if found (e.g., "Honolulu, HI, USA")
- keywords: Paper keywords if listed, comma-separated
- methodology: Research methodology—be direct, no filler phrases (2-3 sentences)
- conclusion: Key findings—go straight to the point (2-3 sentences)
- limitation: Stated or obvious limitations (2-3 sentences)
- notes: ONLY synthesize my sticky notes (listed above) into coherent learnings. Do NOT include anything from the paper itself (methodology, conclusion, limitations) - ONLY my personal observations from stickies. If I have NOT made any sticky notes, return "N/A". Write in first person.

Return ONLY a valid JSON object, no other text. If a field cannot be determined, use an empty string. Format:
{
  "title": "...",
  "firstAuthor": "...",
  "authors": "...",
  "venue": "...",
  "booktitle": "...",
  "date": "...",
  "doi": "...",
  "pages": "...",
  "articleNo": "...",
  "publisher": "...",
  "location": "...",
  "keywords": "...",
  "methodology": "...",
  "conclusion": "...",
  "limitation": "...",
  "notes": "..."
}`;

      // Log for debugging
      console.log('[AI Autofill] Prompt being sent:', prompt);

      // Call OpenAI API via helper (handles dev/prod API key automatically)
      const data = await callOpenAI({
          messages: [
            {
              role: 'system',
              content: 'You are a seasoned CHI paper author helping extract metadata from academic papers. For methodology, conclusion, and limitation fields: summarize from the paper. For the "notes" field: synthesize and paraphrase the user\'s sticky notes into coherent learnings - don\'t just repeat them literally. If no sticky notes exist, return "N/A". Be direct and concise. Always respond with valid JSON only.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 1500,
      });

      const content = data.choices[0]?.message?.content?.trim() || '';

      // Parse JSON response (handle markdown code blocks if present)
      let jsonContent = content;
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        jsonContent = jsonMatch[1];
      }

      const extractedMetadata = JSON.parse(jsonContent);

      // Prepare new metadata
      const newMetadata = {
        firstAuthor: extractedMetadata.firstAuthor || '',
        venue: extractedMetadata.venue || '',
        date: extractedMetadata.date || '',
        doi: extractedMetadata.doi || '',
        pages: extractedMetadata.pages || '',
        articleNo: extractedMetadata.articleNo || '',
        publisher: extractedMetadata.publisher || '',
        location: extractedMetadata.location || '',
        keywords: extractedMetadata.keywords || '',
        methodology: extractedMetadata.methodology || '',
        conclusion: extractedMetadata.conclusion || '',
        limitation: extractedMetadata.limitation || '',
        notes: extractedMetadata.notes || '',
      };

      // Update the paper immediately with title, metadata and authors (if extracted)
      // This ensures metadata.firstAuthor is saved and matches the extracted author
      // Use targetPaper (captured at start) to ensure we update the correct paper
        const extractedTitle = extractedMetadata.title || '';
        const updatedPaper: Paper = {
        ...targetPaper,
        title: extractedTitle || targetPaper.title, // Update title if extracted, otherwise keep existing
        authors: extractedMetadata.authors || extractedMetadata.firstAuthor || targetPaper.authors, // Update main authors field
        hasAIInsights: true, // Mark that AI autofill has been used
          metadata: {
          ...targetPaper.metadata,
            ...newMetadata,
          },
        };

      // Save immediately to database
        await updatePaper(updatedPaper);

        // Also update in allPapers map for sidebar
        setAllPapers(prev => {
          const newMap = new Map(prev);
          newMap.set(updatedPaper.id, updatedPaper);
          return newMap;
        });

      // Only update local state if we're still viewing the same paper
      if (paper?.id === targetPaperId) {
        setPaper(updatedPaper);
        paperRef.current = updatedPaper;
        setMetadata(newMetadata);
      }

    } catch (error) {
      console.error('AI autofill error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to autofill metadata';
      alert(`Failed to autofill metadata: ${errorMessage}. Please check your API key and try again.`);
    } finally {
      // Clean up extraction PDF if it wasn't already destroyed
      if (extractionPdf) {
        try {
          extractionPdf.destroy();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      setIsAIAutofilling(false);
    }
  };


  const getHighlightBg = (color: HighlightColor, isFurtherReading?: boolean) => {
    // Force purple for further reading items if they were previously blue
    const effectiveColor = isFurtherReading && color === 'blue' ? readingListColor : color;
    return HIGHLIGHT_COLORS.find((c) => c.color === effectiveColor)?.bg || HIGHLIGHT_COLORS[0].bg;
  };

  const getHighlightColor = (highlight: Highlight): HighlightColor => {
    // Force purple for further reading items that were previously blue
    if (highlight.isFurtherReading && highlight.color === 'blue') {
      return 'purple';
    }
    return highlight.color;
  };

  const scrollToPage = (pageNum: number) => {
    const pageEl = pageRefs.current.get(pageNum);
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Scroll to a specific highlight and center it on screen with a pulse animation
  const scrollToHighlight = (highlight: Highlight) => {
    const pageEl = pageRefs.current.get(highlight.pageNumber);
    if (!pageEl || !containerRef.current) return;

    // Calculate the center of the first rect of the highlight
    const firstRect = highlight.rects[0];
    if (!firstRect) return;

    const highlightTop = firstRect.y * effectiveScale;
    const highlightHeight = firstRect.height * effectiveScale;

    // Calculate cumulative offset from page element to scroll container
    // offsetTop only gives offset relative to offsetParent, not the scroll container
    let pageOffsetTop = 0;
    let el: HTMLElement | null = pageEl;
    while (el && el !== containerRef.current) {
      pageOffsetTop += el.offsetTop;
      el = el.offsetParent as HTMLElement | null;
    }

    const containerHeight = containerRef.current.clientHeight;

    // Calculate scroll position to center the highlight
    const scrollTarget = pageOffsetTop + highlightTop + (highlightHeight / 2) - (containerHeight / 2);

    containerRef.current.scrollTo({
      top: Math.max(0, scrollTarget),
      behavior: 'smooth',
    });
  };

  // Handle inline title editing
  const handleTitleClick = () => {
    if (paper) {
      setIsEditingTitle(true);
      setEditingTitleValue(paper.title);
    }
  };

  const handleTitleSave = async () => {
    if (!paper) return;
    const trimmedTitle = editingTitleValue.trim();
    if (trimmedTitle && trimmedTitle !== paper.title) {
      const updatedPaper = { ...paper, title: trimmedTitle };
      setPaper(updatedPaper);
      paperRef.current = updatedPaper; // Keep ref in sync to prevent scroll handler from overwriting
      // Also update the paper in allPapers map so sidebar shows updated title
      setAllPapers(prev => {
        const newMap = new Map(prev);
        newMap.set(updatedPaper.id, updatedPaper);
        return newMap;
      });
      try {
        await updatePaper(updatedPaper);
      } catch (error) {
        console.error('Failed to update paper title:', error);
        setPaper(paper); // Revert on error
        paperRef.current = paper; // Revert ref too
        // Revert sidebar as well
        setAllPapers(prev => {
          const newMap = new Map(prev);
          newMap.set(paper.id, paper);
          return newMap;
        });
      }
    }
    setIsEditingTitle(false);
    setEditingTitleValue('');
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleSave();
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
      setEditingTitleValue('');
    }
  };

  const handleDownloadPDF = async () => {
    if (!pdfData || !paper) return;

    // Create blob and download
    const blob = new Blob([pdfData], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${paper.title}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Only show highlights with notes in the sidebar (no pure highlights)
  const highlightsWithNotes = highlights.filter(h =>
    notes.some(n => n.highlightId === h.id)
  );

  const groupedHighlights = highlightsWithNotes.reduce(
    (acc, highlight) => {
      const pageNum = highlight.pageNumber;
      if (!acc[pageNum]) acc[pageNum] = [];
      acc[pageNum].push(highlight);
      return acc;
    },
    {} as Record<number, Highlight[]>
  );

  const isLoading = !pdfData;

  // Get paper info from allPapers for immediate header updates (before full paper loads)
  const currentPaperInfo = paperId ? allPapers.get(paperId) : null;
  const displayTitle = paper?.title || currentPaperInfo?.title || 'Loading...';
  const displayAuthors = paper?.authors || currentPaperInfo?.authors;

  return (
    <div className="h-screen bg-[var(--bg-primary)] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="glass z-50 flex-shrink-0">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                // Use browser history to go back, fallback to home
                if (window.history.length > 1 && sourceRoute) {
                  navigate(-1);
                } else {
                  navigate('/');
                }
              }}
              className="toolbar-btn"
            >
              <ArrowLeft className="w-[18px] h-[18px]" />
            </button>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {isEditingTitle ? (
                <input
                  type="text"
                  value={editingTitleValue}
                  onChange={(e) => setEditingTitleValue(e.target.value)}
                  onBlur={handleTitleSave}
                  onKeyDown={handleTitleKeyDown}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  className="text-sm font-semibold bg-[var(--bg-secondary)] border border-[var(--accent-primary)] rounded px-2 py-0.5 outline-none text-[var(--text-primary)]"
                  style={{ width: Math.max(300, Math.min(500, editingTitleValue.length * 8 + 40)) }}
                />
              ) : (
                <h1
                  className="text-sm font-semibold text-[var(--text-primary)] truncate cursor-pointer hover:bg-[var(--bg-tertiary)] rounded px-2 py-0.5 -mx-2 transition-colors"
                  style={{ maxWidth: 500 }}
                  onClick={handleTitleClick}
                  title="Click to edit title"
                >
                {displayTitle}
              </h1>
              )}
              {/* Info Button */}
              {paper && !isEditingTitle && (
                <button
                  onClick={() => setShowEditModal(true)}
                  className="toolbar-btn flex-shrink-0"
                  title="Edit paper metadata"
                >
                  <Info className="w-4 h-4" />
                </button>
              )}
            </div>
            {displayAuthors && (
              <p className="text-xs text-[var(--text-muted)] truncate hidden md:block">{displayAuthors}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Panel Toggle Buttons */}
            <div className="toolbar">
              <button
                onClick={() => setShowPaperList(!showPaperList)}
                className="toolbar-btn"
                style={{
                  color: showPaperList ? '#3b82f6' : 'var(--text-muted)',
                  backgroundColor: showPaperList ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                }}
                title={showPaperList ? 'Hide paper list' : 'Show paper list'}
              >
                <PanelLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowRightPanel(!showRightPanel)}
                className="toolbar-btn"
                style={{
                  color: showRightPanel ? '#3b82f6' : 'var(--text-muted)',
                  backgroundColor: showRightPanel ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                }}
                title={showRightPanel ? 'Hide notes panel' : 'Show notes panel'}
              >
                <PanelRight className="w-4 h-4" />
              </button>
            </div>

            {/* Zoom Controls with Fit to Width */}
            <div className="toolbar">
              <button
                onClick={() => {
                  // Use current effectiveScale as base when turning off fitToWidth
                  const newScale = Math.max(0.5, effectiveScale - 0.1);
                  setFitToWidth(false);
                  setScale(newScale);
                }}
                className="toolbar-btn"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs text-[var(--text-secondary)] min-w-[40px] text-center font-medium">
                {Math.round(effectiveScale * 100)}%
              </span>
              <button
                onClick={() => {
                  // Use current effectiveScale as base when turning off fitToWidth
                  const newScale = Math.min(3, effectiveScale + 0.1);
                  setFitToWidth(false);
                  setScale(newScale);
                }}
                className="toolbar-btn"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <div className="w-px h-4 bg-[var(--border-default)] mx-0.5" />
              <button
                onClick={() => setFitToWidth(!fitToWidth)}
                className="toolbar-btn"
                style={{
                  color: fitToWidth ? '#3b82f6' : 'var(--text-muted)',
                  backgroundColor: fitToWidth ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                }}
                title="Fit to Width"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>

            {/* Download Button */}
            <button
              onClick={handleDownloadPDF}
              className="toolbar-btn"
              title="Download PDF"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Paper List */}
        <div
          className={`flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${showPaperList ? 'w-64' : 'w-0'
            }`}
        >
          <div
            className={`w-64 h-full flex flex-col bg-[var(--bg-secondary)] border-r border-[var(--border-default)] transition-transform duration-200 ease-out ${showPaperList ? 'translate-x-0' : '-translate-x-full'
              }`}
          >
            {/* Sticky Search Bar + Sort */}
            <div className="px-2 py-1.5 border-b border-[var(--border-default)] flex-shrink-0 sticky top-0 bg-[var(--bg-secondary)] z-10">
              <div className="flex items-center gap-2">
                {/* Search Input Container - clicking anywhere focuses input */}
                <div
                  className={`flex-1 flex items-center gap-1.5 rounded-lg px-2 cursor-text transition-colors ${searchFocused
                    ? 'bg-[var(--bg-card)] ring-1 ring-[var(--border-default)]'
                    : 'bg-[var(--bg-tertiary)]'
                    }`}
                  style={{ height: '28px' }}
                  onClick={(e) => {
                    // Focus the input when clicking anywhere in the container
                    const input = e.currentTarget.querySelector('input');
                    if (input) input.focus();
                  }}
                >
                  <Search className={`w-3.5 h-3.5 flex-shrink-0 transition-colors ${searchFocused ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'
                    }`} />
                  <input
                    type="text"
                    value={paperSearch}
                    onChange={(e) => {
                      setPaperSearch(e.target.value);
                      setExpandSearch(false);
                    }}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    placeholder="Search"
                    className="flex-1 min-w-0 text-xs bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none caret-[var(--text-primary)]"
                    style={{ border: 'none', boxShadow: 'none', padding: '0 0 0 1px', height: 'auto' }}
                  />
                  {paperSearch && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPaperSearch('');
                        setExpandSearch(false);
                      }}
                      className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Sort Button */}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => setShowSortDropdown(!showSortDropdown)}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    title="Sort papers"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                  </button>

                  {showSortDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowSortDropdown(false)}
                      />
                      <div className="absolute right-0 top-full mt-1 bg-[var(--bg-card)] border border-[var(--border-default)] rounded-lg shadow-lg z-50 py-1 min-w-[120px]">
                        {[
                          { value: 'date-desc' as SortOption, label: 'Newest first' },
                          { value: 'date-asc' as SortOption, label: 'Oldest first' },
                          { value: 'title-asc' as SortOption, label: 'Title A-Z' },
                          { value: 'title-desc' as SortOption, label: 'Title Z-A' },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => {
                              setSortOption(opt.value);
                              setShowSortDropdown(false);
                            }}
                            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${sortOption === opt.value
                              ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                              }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Filter Button */}
                <button
                  onClick={() => setShowFilterModal(true)}
                  className={`relative p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                    activeFilterCount > 0
                      ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                  }`}
                  title="Filter papers"
                >
                  <Filter className="w-3.5 h-3.5" />
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-[var(--accent-primary)] text-white text-[9px] font-medium rounded-full flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Filter Modal */}
            {showFilterModal && (
              <>
                <div
                  className="fixed inset-0 bg-black/30 z-40"
                  onClick={() => setShowFilterModal(false)}
                />
                <div className="absolute left-2 right-2 top-12 bg-[var(--bg-card)] border border-[var(--border-default)] rounded-lg shadow-xl z-50 max-h-[70vh] overflow-y-auto">
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">Filters</h3>
                      {activeFilterCount > 0 && (
                        <button
                          onClick={() => {
                            setSelectedTags([]);
                            setShowStarredOnly(false);
                            setShowUnreadOnly(false);
                            setShowFinishedOnly(false);
                            setShowUnfinishedOnly(false);
                          }}
                          className="text-[10px] text-[var(--accent-red)] hover:underline"
                        >
                          Clear all
                        </button>
                      )}
                    </div>

                    {/* Quick Filters */}
                    <div className="space-y-1 mb-4">
                      <button
                        onClick={() => setShowStarredOnly(!showStarredOnly)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                          showStarredOnly
                            ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                        }`}
                      >
                        <Star className={`w-3.5 h-3.5 ${showStarredOnly ? 'fill-current' : ''}`} />
                        Starred
                      </button>
                      <button
                        onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                          showUnreadOnly
                            ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                        }`}
                      >
                        <BookMarked className="w-3.5 h-3.5" />
                        Unread
                      </button>
                      <button
                        onClick={() => {
                          setShowFinishedOnly(!showFinishedOnly);
                          if (!showFinishedOnly) setShowUnfinishedOnly(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                          showFinishedOnly
                            ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                        }`}
                      >
                        <div className="w-3.5 h-3.5 flex items-center justify-center">
                          <div className="w-3 h-3 rounded-full border-2 border-current bg-current" />
                        </div>
                        Finished
                      </button>
                      <button
                        onClick={() => {
                          setShowUnfinishedOnly(!showUnfinishedOnly);
                          if (!showUnfinishedOnly) setShowFinishedOnly(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                          showUnfinishedOnly
                            ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                        }`}
                      >
                        <div className="w-3.5 h-3.5 flex items-center justify-center">
                          <div className="w-3 h-3 rounded-full border-2 border-current" />
                        </div>
                        Unfinished
                      </button>
                    </div>

                    {/* Tags */}
                    {tagsWithCounts.length > 0 && (
                      <>
                        <h4 className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Tags</h4>
                        <div className="space-y-1">
                          {tagsWithCounts.map(({ tag, count }) => (
                            <button
                              key={tag}
                              onClick={() => {
                                setSelectedTags(prev =>
                                  prev.includes(tag)
                                    ? prev.filter(t => t !== tag)
                                    : [...prev, tag]
                                );
                              }}
                              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors ${
                                selectedTags.includes(tag)
                                  ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
                                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                              }`}
                            >
                              <span>{tag}</span>
                              <span className={`text-[10px] tabular-nums ${
                                selectedTags.includes(tag) ? 'opacity-60' : 'text-[var(--text-muted)]'
                              }`}>{count}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            <div className="flex-1 overflow-y-auto">
              {paperSearch.trim() && displayPapers.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-xs text-[var(--text-muted)]">No papers found</p>
                </div>
              ) : (
                <>
                  {displayPapers.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => switchToPaper(p.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && switchToPaper(p.id)}
                      className={`group w-full text-left px-3 py-2.5 border-b border-[var(--border-muted)] transition-colors cursor-pointer ${p.id === paperId
                        ? 'bg-[var(--bg-tertiary)]'
                        : 'hover:bg-[var(--bg-tertiary)]/50'
                        }`}
                    >
                      <div className="flex items-start gap-2">
                        <FileText className={`w-4 h-4 flex-shrink-0 mt-0.5 ${p.id === paperId ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                          }`} />
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs leading-snug line-clamp-2 ${p.id === paperId
                            ? 'text-[var(--text-primary)] font-semibold'
                            : 'text-[var(--text-primary)] font-normal opacity-80'
                            }`}>
                            {p.title}
                          </p>
                          {p.authors && (
                            <p className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate">
                              {p.authors.split(',')[0]}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={(e) => togglePaperStarred(e, p)}
                            className={`p-0.5 rounded transition-all ${p.isStarred
                              ? 'text-yellow-500'
                              : 'text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-yellow-500'
                              }`}
                            title={p.isStarred ? "Unstar" : "Star"}
                          >
                            <Star className={`w-3 h-3 ${p.isStarred ? 'fill-current' : ''}`} />
                          </button>
                          <div className="relative flex items-center justify-center w-3 h-3">
                            {!p.isRead ? (
                              <button
                                onClick={(e) => togglePaperReadStatus(e, p)}
                                className="relative w-3 h-3 flex items-center justify-center group/button"
                                title="Mark as read"
                              >
                                {/* Outer circle with faint blue fill - only on hover (2x dot width = 3px) */}
                                <div className="absolute inset-0 w-3 h-3 rounded-full bg-blue-500/20 opacity-0 group-hover/button:opacity-100 transition-opacity" />
                                {/* Inner blue dot - always visible, centered */}
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-500" />
                              </button>
                            ) : (
                              <button
                                onClick={(e) => togglePaperReadStatus(e, p)}
                                className="relative w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center group/button"
                                title="Mark as unread"
                              >
                                {/* Outer circle with faint grey fill - only on hover (2x dot width = 3px) */}
                                <div className="absolute inset-0 w-3 h-3 rounded-full bg-[var(--text-muted)]/15 opacity-0 group-hover/button:opacity-100 transition-opacity" />
                                {/* Inner grey dot - centered */}
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]/40 group-hover/button:bg-[var(--text-muted)]/60 transition-colors" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Expand search button */}
                  {hiddenCount > 0 && (
                    <button
                      onClick={() => setExpandSearch(true)}
                      className="w-full py-2.5 text-xs text-[var(--accent-primary)] hover:bg-[var(--bg-tertiary)]/50 transition-colors border-b border-[var(--border-muted)]"
                    >
                      Show {hiddenCount} more result{hiddenCount !== 1 ? 's' : ''}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* PDF Viewer */}
        <div
          ref={containerRef}
          className="pdf-viewer-container flex-1 overflow-auto relative"
          style={{ background: 'var(--bg-tertiary)' }}
          onClick={() => {
            // Dismiss floating editor when clicking on background (only if no text entered)
            if (editingHighlight && !noteInput.trim()) {
              setEditingHighlight(null);
              setEditingHighlightPosition(null);
              setNoteInput('');
              setCurrentNoteIndex(0);
              setIsAddingNewNote(false);
              setEditingNoteId(null);
              setIsEditingNote(false);
            }
          }}
        >
          {/* Overlay that fades out when PDF is ready */}
          <div
            className={`absolute inset-0 z-40 pointer-events-none transition-opacity duration-300 flex items-center justify-center ${pdfContainerReady ? 'opacity-0' : 'opacity-100'
              }`}
            style={{ background: 'var(--bg-tertiary)' }}
          >
            {isLoading && (
              <Loader2 className="w-8 h-8 text-[var(--text-muted)] animate-spin" />
            )}
          </div>
          <div className="flex flex-col py-6 gap-4 px-8 w-full">
            {pdfData && paperId && (
              <Document
                key={`${paperId}-${documentKey}`} // Force recreation when paperId or documentKey changes
                file={pdfData}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={onDocumentLoadError}
                loading={
                  <div className="flex items-center justify-center p-20">
                    <Loader2 className="w-8 h-8 text-[var(--accent-primary)] animate-spin" />
                  </div>
                }
                error={
                  <div className="flex items-center justify-center p-20">
                    <div className="text-center">
                      <p className="text-sm text-[var(--text-secondary)] mb-2">Failed to load PDF</p>
                      <p className="text-xs text-[var(--text-muted)]">Please try refreshing the page</p>
                    </div>
                  </div>
                }
              >
                {documentReady && numPages > 0 && Array.from({ length: numPages }, (_, index) => {
                  const pageNum = index + 1;
                  const pageHighlights = pageHighlightsMap.get(pageNum) || [];

                  return (
                    <div
                      key={pageNum}
                      data-page={pageNum}
                      className="relative mb-4 overflow-hidden mx-auto"
                      onClick={(e) => {
                        // Dismiss floating editor when clicking on page background (only if no text entered)
                        if (editingHighlight && !noteInput.trim() && e.target === e.currentTarget) {
                          setEditingHighlight(null);
                          setEditingHighlightPosition(null);
                          setNoteInput('');
                          setCurrentNoteIndex(0);
                          setIsAddingNewNote(false);
                          setEditingNoteId(null);
                          setIsEditingNote(false);
                        }
                      }}
                    >
                      {/* Wrapper that positions highlights relative to Page element */}
                      <div
                        ref={(el) => {
                          if (el) pageRefs.current.set(pageNum, el);
                        }}
                        className="relative inline-block"
                      >
                        <Page
                          pageNumber={pageNum}
                          scale={effectiveScale}
                          className="shadow-lg rounded-sm overflow-hidden block"
                          renderAnnotationLayer={false}
                        />
                        {/* Highlight Overlays - two layers: visual (below text) and click (above text) */}
                        {pageHighlights.map((highlight) => {
                          const isHovered = hoveredNoteHighlightId === highlight.id;
                          const isEditing = editingHighlight?.id === highlight.id;

                          return (
                            <div key={highlight.id}>
                              {/* Visual layer - below text, no pointer events */}
                              {highlight.rects.map((rect, idx) => (
                                <div
                                  key={`visual-${idx}`}
                                  className={`absolute pointer-events-none transition-all duration-300 ${isHovered ? 'animate-highlight-pulse' : ''
                                    }`}
                                  style={{
                                    left: rect.x * effectiveScale,
                                    top: rect.y * effectiveScale,
                                    width: rect.width * effectiveScale,
                                    height: rect.height * effectiveScale,
                                    backgroundColor: getHighlightBg(highlight.color, highlight.isFurtherReading),
                                    zIndex: 1,
                                    mixBlendMode: 'multiply',
                                    opacity: isHovered || isEditing ? 1 : 0.85,
                                    filter: isHovered || isEditing ? 'saturate(1.5) brightness(0.95)' : 'none',
                                    boxShadow: isHovered ? `0 0 8px 2px ${getHighlightBg(highlight.color, highlight.isFurtherReading)}` : 'none',
                                  }}
                                />
                              ))}
                              {/* Click layer - above text, transparent */}
                              {highlight.rects.map((rect, idx) => (
                                <div
                                  key={`click-${idx}`}
                                  className="absolute cursor-pointer"
                                  style={{
                                    left: rect.x * effectiveScale,
                                    top: rect.y * effectiveScale,
                                    width: rect.width * effectiveScale,
                                    height: rect.height * effectiveScale,
                                    zIndex: 15,
                                    backgroundColor: 'transparent',
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();

                                    // Get click position relative to the page container
                                    const pageEl = pageRefs.current.get(pageNum);
                                    if (!pageEl) return;
                                    const pageRect = pageEl.getBoundingClientRect();
                                    const clickX = e.clientX - pageRect.left;
                                    const clickY = e.clientY - pageRect.top;

                                    // Find the rect closest to the click position
                                    // Lower threshold to 2 to support small reference numbers like [7]
                                    const validRects = highlight.rects.filter(r => r.width > 2 && r.height > 2);
                                    if (validRects.length === 0) return;

                                    // Find which rect was clicked (or closest to click)
                                    let closestRect = validRects[0];
                                    let minDist = Infinity;
                                    for (const rect of validRects) {
                                      const rectCenterX = (rect.x + rect.width / 2) * effectiveScale;
                                      const rectCenterY = (rect.y + rect.height / 2) * effectiveScale;
                                      const dist = Math.abs(rectCenterY - clickY) + Math.abs(rectCenterX - clickX) * 0.5;
                                      if (dist < minDist) {
                                        minDist = dist;
                                        closestRect = rect;
                                      }
                                    }

                                    // Position popup above the clicked rect, centered on click X
                                    const popupX = clickX;
                                    const popupY = closestRect.y * effectiveScale - 10;
                                    setEditingHighlightPosition({ x: popupX, y: popupY });
                                    setEditingHighlight(highlight);
                                    
                                    // Initialize note state - never default to edit/add mode
                                    setCurrentNoteIndex(0);
                                    setIsAddingNewNote(false);
                                    setEditingNoteId(null);
                                    setNoteInput('');
                                    setIsEditingNote(false);
                                  }}
                                />
                              ))}
                            </div>
                          );
                        })}

                        {/* Floating Highlight Editor - rendered via portal to avoid overflow clipping */}
                        {editingHighlight && editingHighlightPosition && editingHighlight.pageNumber === pageNum && (() => {
                          const editColorInfo = HIGHLIGHT_COLORS.find(c => c.color === getHighlightColor(editingHighlight));
                          const highlightHasNotes = notes.some(n => n.highlightId === editingHighlight.id);

                          // Get page element to calculate viewport position
                          const pageEl = pageRefs.current.get(pageNum);
                          const pageRect = pageEl?.getBoundingClientRect();
                          
                          if (!pageRect) return null;
                          
                          const popupWidth = 320;
                          const halfPopup = popupWidth / 2;

                          // Calculate position in viewport coordinates
                          let viewportX = pageRect.left + editingHighlightPosition.x;
                          const viewportY = pageRect.top + editingHighlightPosition.y;
                          
                          // Clamp to viewport bounds
                          const viewportWidth = window.innerWidth;
                          const margin = 16;
                          
                          // Ensure popup right edge doesn't exceed viewport
                          if (viewportX + halfPopup > viewportWidth - margin) {
                            viewportX = viewportWidth - margin - halfPopup;
                          }
                          // Ensure popup left edge doesn't go below margin
                          if (viewportX - halfPopup < margin) {
                            viewportX = margin + halfPopup;
                          }
                          

                          return createPortal(
                            <div
                              className="fixed z-[9999] animate-scale-in"
                              style={{
                                left: viewportX,
                                top: viewportY,
                                transform: 'translate(-50%, -100%)',
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {(() => {
                                const highlightNotes = notes.filter(n => n.highlightId === editingHighlight.id);
                                const totalNotes = highlightNotes.length;
                                const isInEditMode = isAddingNewNote || editingNoteId !== null;
                                
                                // Get reference info for any highlight containing a reference number
                                const highlightRefNumber = detectReference(editingHighlight.text);
                                const highlightRefInfo = highlightRefNumber ? getReferenceInfo(highlightRefNumber) : null;
                                
                                // For reading list items, the citation is stored in the first note
                                // The note format is: "[7] Author. Year. Title..."
                                const firstNote = highlightNotes[0];
                                const citationFromNote = firstNote?.content;
                                
                                // Show reference info: either from detected number, from the note, or use the highlight text as fallback for reading list items
                                const showRefInfo = highlightRefInfo?.title || (editingHighlight.isFurtherReading && (citationFromNote || editingHighlight.text));
                                const refDisplayText = highlightRefInfo?.fullCitation || citationFromNote || (editingHighlight.isFurtherReading ? editingHighlight.text : null);
                                
                                return (
                              <div
                                className="rounded-xl overflow-hidden shadow-xl"
                                style={{
                                  backgroundColor: isDarkMode
                                    ? (editColorInfo?.bgDark || '#3d3522')
                                    : (editColorInfo?.bg || '#fef9c3'),
                                      // Narrower only when just showing color bar, wider when notes exist or adding/editing
                                      minWidth: (totalNotes > 0 || showRefInfo || isInEditMode) ? '280px' : 'auto',
                                  maxWidth: '320px',
                                      transition: 'all 0.2s ease-out',
                                    }}
                                  >
                                    {/* Reference info for highlights with detected references or reading list items */}
                                    {showRefInfo && !isInEditMode && refDisplayText && (
                                      <div 
                                        className="px-3 py-2.5 border-b transition-all duration-200"
                                        style={{
                                          borderColor: `${editColorInfo?.border}30`,
                                        }}
                                      >
                                        <p 
                                          className="text-xs leading-relaxed mb-2"
                                          style={{
                                            color: isDarkMode
                                              ? (editColorInfo?.textDark || '#fef3c7')
                                              : (editColorInfo?.dark || '#78350f'),
                                          }}
                                        >
                                          {refDisplayText}
                                        </p>
                                        <a
                                          href={`https://scholar.google.com/scholar?q=${encodeURIComponent(refDisplayText.slice(0, 200))}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full transition-opacity hover:opacity-80"
                                          style={{
                                            backgroundColor: isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)',
                                            color: isDarkMode
                                              ? (editColorInfo?.textDark || '#fef3c7')
                                              : (editColorInfo?.dark || '#78350f'),
                                          }}
                                        >
                                          <ExternalLink className="w-3 h-3" />
                                          Find on Google Scholar
                                        </a>
                                      </div>
                                    )}
                                    
                                    {/* Color picker bar - hidden during edit mode and for reading list items */}
                                    {!editingHighlight.isFurtherReading && (
                                    <div
                                      className="overflow-hidden transition-all duration-200 ease-out"
                                      style={{
                                        maxHeight: isInEditMode ? 0 : '44px',
                                        opacity: isInEditMode ? 0 : 1,
                                        borderBottom: (isInEditMode || totalNotes === 0) ? 'none' : `1px solid ${editColorInfo?.border}30`,
                                      }}
                                    >
                                      <div className={`px-3 py-2 flex items-center gap-1 ${totalNotes > 0 ? 'justify-center' : ''}`}>
                                    {HIGHLIGHT_COLORS.map(({ color, border }) => (
                                      <button
                                        key={color}
                                        onClick={() => handleChangeHighlightColor(editingHighlight, color)}
                                        className={`color-btn ${editingHighlight.color === color ? 'selected' : ''}`}
                                        style={{
                                          backgroundColor: border,
                                          boxShadow: editingHighlight.color === color ? `0 0 0 2px ${isDarkMode ? 'rgba(255,255,255,0.3)' : 'white'}` : 'none',
                                        }}
                                        title={color.charAt(0).toUpperCase() + color.slice(1)}
                                      />
                                    ))}
                                        {/* Reading list toggle button - only show for references */}
                                        {highlightRefNumber && (
                                        <button
                                          onClick={async () => {
                                            // Add to reading list
                                            const updated = { ...editingHighlight, isFurtherReading: true, color: readingListColor };
                                            await updateHighlight(updated);
                                            setHighlights(prev => prev.map(h => h.id === updated.id ? updated : h));
                                            setReadingList(prev => [...prev, updated]);
                                            setAllReadingListItems(prev => [...prev, updated]);
                                            setEditingHighlight(updated);
                                          }}
                                          className="w-6 h-6 rounded-full transition-all duration-150 hover:scale-110 relative flex items-center justify-center"
                                          style={{
                                            backgroundColor: isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)',
                                            border: '2px solid transparent',
                                          }}
                                          title="Add to reading list"
                                        >
                                          <BookMarked className="w-3.5 h-3.5" style={{ 
                                            color: isDarkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)'
                                          }} />
                                        </button>
                                        )}
                                        
                                        {/* Remove highlight button - circle with red slash */}
                                        {!highlightHasNotes && (
                                  <button
                                    onClick={() => handleDeleteHighlight(editingHighlight.id)}
                                            className="w-6 h-6 rounded-full transition-all duration-150 hover:scale-110 relative flex items-center justify-center"
                                    style={{
                                              backgroundColor: isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)',
                                              border: '2px solid transparent',
                                            }}
                                            title="Remove highlight"
                                          >
                                            {/* Red diagonal slash */}
                                            <div
                                              className="absolute w-5 h-0.5 rounded-full"
                                              style={{
                                                backgroundColor: '#ef4444',
                                                transform: 'rotate(-45deg)',
                                              }}
                                            />
                                  </button>
                                        )}
                                </div>
                                </div>
                                    )}
                                    
                                    {/* Trash icon for reading list items - positioned at bottom right */}
                                    {editingHighlight.isFurtherReading && !isInEditMode && (
                                      <div className="px-3 py-2 flex justify-end">
                                        <button
                                          onClick={async () => {
                                            const updated = { ...editingHighlight, isFurtherReading: false };
                                            await updateHighlight(updated);
                                            setHighlights(prev => prev.map(h => h.id === updated.id ? updated : h));
                                            setReadingList(prev => prev.filter(h => h.id !== updated.id));
                                            setAllReadingListItems(prev => prev.filter(h => h.id !== updated.id));
                                            setEditingHighlight(updated);
                                          }}
                                          className="p-1.5 rounded-full transition-all hover:scale-110 hover:bg-red-500/20"
                                          style={{
                                            color: isDarkMode ? 'rgba(239, 68, 68, 0.7)' : 'rgba(239, 68, 68, 0.6)',
                                          }}
                                          title="Remove from reading list"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                                    )}

                                    {/* Notes section - always show to allow adding notes */}
                                    <div 
                                      className="overflow-hidden transition-all duration-200 ease-out"
                                      style={{
                                        maxHeight: '500px',
                                        opacity: 1,
                                        padding: '12px',
                                      }}
                                    >
                                      {/* List all existing notes */}
                                      <div 
                                        className="overflow-hidden transition-all duration-200 ease-out"
                                        style={{
                                          maxHeight: highlightNotes.length > 0 ? '400px' : 0,
                                          opacity: highlightNotes.length > 0 ? 1 : 0,
                                          marginBottom: highlightNotes.length > 0 ? '8px' : 0,
                                        }}
                                      >
                                        <div className="space-y-2">
                                          {highlightNotes.map((note) => (
                                            <div
                                              key={note.id}
                                              className="group relative transition-all duration-200 ease-out"
                                            >
                                              {/* View mode for this note - click to edit */}
                                              {editingNoteId !== note.id && (
                                                <div
                                                  className="relative text-xs py-2 px-3 pr-8 leading-relaxed transition-all duration-200 ease-out cursor-pointer hover:opacity-80"
                                                  style={{
                                                    borderRadius: '8px',
                                                    backgroundColor: isDarkMode ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.6)',
                                                    color: isDarkMode
                                                      ? (editColorInfo?.textDark || '#fef3c7')
                                                      : (editColorInfo?.dark || '#78350f'),
                                                  }}
                                                >
                                                  <div
                                                    onClick={() => {
                                                      if (!isInEditMode) {
                                                        setEditingNoteId(note.id);
                                                        setNoteInput(note.content);
                                                        setIsAddingNewNote(false);
                                                      }
                                                    }}
                                                  >
                                                    {note.content}
                                                  </div>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleDeleteNote(note.id);
                                                    }}
                                                    className="absolute top-1.5 right-1.5 p-0.5 rounded-full transition-all opacity-40 hover:opacity-100 hover:scale-110"
                                                    style={{
                                                      color: isDarkMode ? 'rgba(239, 68, 68, 0.9)' : 'var(--accent-red)',
                                                    }}
                                                    title="Delete note"
                                                  >
                                                    <X className="w-3 h-3" />
                                                  </button>
                                                </div>
                                              )}
                                              
                                              {/* Edit mode for this note */}
                                              {editingNoteId === note.id && !isAddingNewNote && (
                                                <div className="animate-in fade-in duration-200">
                                                  <textarea
                                                    value={noteInput}
                                                    onChange={(e) => setNoteInput(e.target.value)}
                                                    placeholder="Edit note..."
                                                    rows={2}
                                                    autoFocus
                                                    className="w-full text-xs py-2 px-3 mb-2 resize-none border-0"
                                                    style={{
                                                      borderRadius: '8px',
                                                      backgroundColor: isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.8)',
                                                      color: isDarkMode
                                                        ? (editColorInfo?.textDark || '#fef3c7')
                                                        : (editColorInfo?.dark || '#78350f'),
                                                      outline: 'none',
                                                    }}
                                                    onKeyDown={(e) => {
                                                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                                        e.preventDefault();
                                                        if (noteInput.trim()) {
                                                          handleUpdateNote();
                                                          setEditingNoteId(null);
                                                        }
                                                      } else if (e.key === 'Escape') {
                                                        setEditingNoteId(null);
                                                        setNoteInput('');
                                                      }
                                                    }}
                                                  />
                                                  <div className="flex gap-2">
                                                    <button
                                                      onClick={() => {
                                                        setEditingNoteId(null);
                                                        setNoteInput('');
                                                      }}
                                                      className="flex-1 text-xs py-1 px-2 rounded-full transition-colors"
                                                      style={{
                                                        backgroundColor: isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)',
                                                        color: isDarkMode
                                                          ? (editColorInfo?.textDark || '#fef3c7')
                                                          : (editColorInfo?.dark || '#78350f'),
                                                      }}
                                                    >
                                                      Cancel
                                                    </button>
                                                    <button
                                                      onClick={() => {
                                                        if (noteInput.trim()) {
                                                          handleUpdateNote();
                                                          setEditingNoteId(null);
                                                        }
                                                      }}
                                                      disabled={!noteInput.trim()}
                                                      className="flex-1 btn-primary text-xs py-1 px-2 disabled:opacity-50"
                                                    >
                                                      Save
                                                    </button>
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                      
                                      {/* Add new note input - shown when adding */}
                                      <div
                                        className="overflow-hidden transition-all duration-200 ease-out"
                                        style={{
                                          maxHeight: isAddingNewNote ? '200px' : 0,
                                          opacity: isAddingNewNote ? 1 : 0,
                                          marginBottom: isAddingNewNote ? '8px' : 0,
                                        }}
                                      >
                                        {isAddingNewNote && (
                                  <textarea
                                    value={noteInput}
                                    onChange={(e) => setNoteInput(e.target.value)}
                                    placeholder="Create note..."
                                    rows={2}
                                    autoFocus
                                    className="w-full text-xs py-2 px-3 mb-2 resize-none border-0"
                                    style={{
                                      borderRadius: '8px',
                                      backgroundColor: isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.8)',
                                      color: isDarkMode
                                        ? (editColorInfo?.textDark || '#fef3c7')
                                        : (editColorInfo?.dark || '#78350f'),
                                      outline: 'none',
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                        e.preventDefault();
                                        if (noteInput.trim()) {
                                          handleAddNote();
                                        }
                                      } else if (e.key === 'Escape') {
                                                setIsAddingNewNote(false);
                                        setNoteInput('');
                                      }
                                    }}
                                  />
                                        )}
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => {
                                                setIsAddingNewNote(false);
                                        setNoteInput('');
                                      }}
                                              className="flex-1 text-xs py-1 px-2 rounded-full transition-colors"
                                      style={{
                                        backgroundColor: isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)',
                                        color: isDarkMode
                                          ? (editColorInfo?.textDark || '#fef3c7')
                                          : (editColorInfo?.dark || '#78350f'),
                                      }}
                                    >
                                              Cancel
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (noteInput.trim()) {
                                          handleAddNote();
                                        }
                                      }}
                                      disabled={!noteInput.trim()}
                                              className="flex-1 btn-primary text-xs py-1 px-2 disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                  </div>
                                      </div>
                                      
                                      {/* Add note pill button - hidden during any edit mode */}
                                      <div
                                        className="overflow-hidden transition-all duration-200 ease-out"
                                        style={{
                                          maxHeight: isInEditMode ? 0 : '40px',
                                          opacity: isInEditMode ? 0 : 1,
                                          marginTop: isInEditMode ? 0 : (totalNotes > 0 ? '8px' : '0'),
                                        }}
                                      >
                                        <button
                                          onClick={() => {
                                            setIsAddingNewNote(true);
                                            setEditingNoteId(null);
                                            setNoteInput('');
                                          }}
                                          className="w-full flex items-center justify-center gap-1.5 text-xs py-2 px-3 rounded-full transition-all duration-150 hover:opacity-80"
                                          style={{
                                            backgroundColor: isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)',
                                            color: isDarkMode
                                              ? (editColorInfo?.textDark || '#fef3c7')
                                              : (editColorInfo?.dark || '#78350f'),
                                          }}
                                        >
                                          <Plus className="w-3.5 h-3.5" />
                                          {totalNotes > 0 ? 'Create another note' : 'Create note'}
                                        </button>
                                </div>
                              </div>
                            </div>
                                );
                              })()}
                            </div>,
                            document.body
                          );
                        })()}
                      </div>{/* Close the inner wrapper for highlights */}
                    </div>
                  );
                })}
              </Document>
            )}
          </div>

          {/* Inline Color Picker */}
          {showColorPicker && (() => {
            // Only detect references for short selections (< 100 chars)
            // Longer selections are treated as regular text to highlight
            const isShortSelection = selectedText.length < 100;
            const detectedRef = isShortSelection ? detectReference(selectedText) : null;
            const looksLikeRef = isShortSelection && isLikelyReference(selectedText);
            const showRefButton = detectedRef || looksLikeRef;

            // Get reference info if available
            const refInfo = detectedRef ? getReferenceInfo(detectedRef) : null;
            const hasRefTitle = refInfo && refInfo.title;

            // Check if this reference is already in the reading list (across ALL papers)
            // Use normalization for fuzzy matching to handle citation format variations and dashes
            const isAlreadyInReadingList = hasRefTitle
              ? allReadingListItems.some(item =>
                normalizeForComparison(item.text) === normalizeForComparison(refInfo.title)
              )
              : allReadingListItems.some(item =>
                normalizeForComparison(item.text) === normalizeForComparison(selectedText)
              );

            // Also check if this reference matches any paper already in the library
            // Compare normalized titles - the reference title might be embedded in the paper title or vice versa
            const textToCheck = hasRefTitle ? refInfo.title : selectedText;
            const normalizedRef = normalizeForComparison(textToCheck);

            // Debug logging for library matching
            console.log('[LibraryMatch] Checking reference:', textToCheck.slice(0, 100));
            console.log('[LibraryMatch] Normalized reference:', normalizedRef.slice(0, 100));

            const matchingLibraryPaper = Array.from(allPapers.values()).find(paper => {
              const normalizedPaperTitle = normalizeForComparison(paper.title);
              const exactMatch = normalizedPaperTitle === normalizedRef;
              const libraryContainsRef = normalizedPaperTitle.includes(normalizedRef);
              const refContainsLibrary = normalizedRef.includes(normalizedPaperTitle);

              // Handle truncated references: check if the library title appears at a specific position
              // The reference format is usually "Author Names. Year. Title..."
              // So we look for the library title starting anywhere in the reference
              // Also handle case where reference is truncated - check if start of library title matches end of reference
              const minMatchLength = Math.min(30, normalizedPaperTitle.length); // At least 30 chars or full title
              const libraryPrefix = normalizedPaperTitle.slice(0, minMatchLength);
              const truncationMatch = normalizedRef.includes(libraryPrefix);

              const isMatch = exactMatch || libraryContainsRef || refContainsLibrary || truncationMatch;

              if (normalizedPaperTitle.includes('removal') || normalizedRef.includes('removal')) {
                console.log('[LibraryMatch] --- DETAILED DEBUG for "removal" ---');
                console.log('[LibraryMatch] Library paper:', paper.title);
                console.log('[LibraryMatch] Normalized library (full):', normalizedPaperTitle);
                console.log('[LibraryMatch] Normalized ref (full):', normalizedRef);
                console.log('[LibraryMatch] Library length:', normalizedPaperTitle.length);
                console.log('[LibraryMatch] Ref length:', normalizedRef.length);
                console.log('[LibraryMatch] Exact match:', exactMatch);
                console.log('[LibraryMatch] libraryContainsRef:', libraryContainsRef);
                console.log('[LibraryMatch] refContainsLibrary:', refContainsLibrary);
                console.log('[LibraryMatch] truncationMatch (prefix):', truncationMatch, 'prefix:', libraryPrefix);
                console.log('[LibraryMatch] Final isMatch:', isMatch);
              }
              return isMatch;
            });
            const isAlreadyInLibrary = !!matchingLibraryPaper;

            return (
              <div
                className="absolute z-50 animate-scale-in"
                style={{
                  left: colorPickerPosition.x,
                  top: colorPickerPosition.y,
                  maxWidth: '400px',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Show reference info with Add to Reading List button */}
                {showRefButton && hasRefTitle && (
                  <div
                    className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl shadow-lg"
                    style={{ maxWidth: '400px' }}
                  >
                    <div className="p-5">
                      <p className="text-[13px] text-[var(--text-primary)] leading-relaxed mb-4">
                        {refInfo.fullCitation}
                      </p>

                      <button
                        onClick={() => {
                          createHighlight(readingListColor, true, citationNoteInput.trim() || undefined);
                          setCitationNoteInput('');
                        }}
                        disabled={isAlreadyInReadingList || isAlreadyInLibrary}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-opacity ${isAlreadyInReadingList || isAlreadyInLibrary
                          ? 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed'
                          : 'bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90'
                          }`}
                      >
                        {isAlreadyInReadingList ? (
                          <>Already in reading list</>
                        ) : isAlreadyInLibrary ? (
                          <>Already in library</>
                        ) : (
                          <>
                            <Plus className="w-4 h-4" />
                            Add to Reading List
                          </>
                        )}
                      </button>
                      
                      {/* Divider and color picker for regular highlighting */}
                      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-[var(--border-default)]">
                        <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">Or highlight:</span>
                        <div className="flex gap-1.5">
                          {HIGHLIGHT_COLORS.map((c) => (
                            <button
                              key={c.color}
                              onClick={() => createHighlight(c.color, false)}
                              className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                              style={{ backgroundColor: c.border }}
                              title={c.color.charAt(0).toUpperCase() + c.color.slice(1)}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Fallback for detected ref without title */}
                {showRefButton && detectedRef && !hasRefTitle && (
                  <div
                    className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl shadow-lg"
                    style={{ minWidth: '200px' }}
                  >
                    <div className="p-5">
                      <p className="text-[13px] text-[var(--text-secondary)] text-center mb-4">
                        Reference [{detectedRef}]
                      </p>

                      <button
                        onClick={() => {
                          createHighlight(readingListColor, true, citationNoteInput.trim() || undefined);
                          setCitationNoteInput('');
                        }}
                        disabled={isAlreadyInReadingList || isAlreadyInLibrary}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-opacity ${isAlreadyInReadingList || isAlreadyInLibrary
                          ? 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed'
                          : 'bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90'
                          }`}
                      >
                        {isAlreadyInReadingList ? (
                          <>Already in reading list</>
                        ) : isAlreadyInLibrary ? (
                          <>Already in library</>
                        ) : (
                          <>
                            <Plus className="w-4 h-4" />
                            Add to Reading List
                          </>
                        )}
                      </button>
                      
                      {/* Divider and color picker for regular highlighting */}
                      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-[var(--border-default)]">
                        <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">Or highlight:</span>
                        <div className="flex gap-1.5">
                          {HIGHLIGHT_COLORS.map((c) => (
                            <button
                              key={c.color}
                              onClick={() => createHighlight(c.color, false)}
                              className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                              style={{ backgroundColor: c.border }}
                              title={c.color.charAt(0).toUpperCase() + c.color.slice(1)}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Color picker for regular highlights (when no reference detected) */}
                {!showRefButton && (
                  <div className="color-picker-popup justify-center">
                    {HIGHLIGHT_COLORS.map((c) => (
                      <button
                        key={c.color}
                        onClick={() => createHighlight(c.color, false)}
                        className="color-btn"
                        style={{ backgroundColor: c.border }}
                        title={c.color.charAt(0).toUpperCase() + c.color.slice(1)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Right Sidebar - Notes and Metadata */}
        <div
          className={`flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${showRightPanel ? 'w-80' : 'w-0'
            }`}
        >
          <div
            className={`w-80 h-full flex flex-col border-l border-[var(--border-default)] relative transition-transform duration-200 ease-out ${showRightPanel ? 'translate-x-0' : 'translate-x-full'
              }`}
            data-sidebar="notes-metadata"
          >
            {/* Loading overlay for right sidebar */}
            {isLoading && (
              <div className="absolute inset-0 z-40 bg-[var(--bg-primary)] flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
              </div>
            )}
            {/* Notes Sidebar */}
            <div className="flex flex-col overflow-hidden" style={{ height: `calc(100% - ${metadataPanelHeight}px)` }}>
              {/* Tab Header */}
              <div className="p-2 border-b border-[var(--border-default)] flex-shrink-0">
                <div className="segmented-control w-full justify-center">
                  <button
                    onClick={() => setSidebarTab('notes')}
                    className={`flex-1 justify-center ${sidebarTab === 'notes' ? 'active' : ''}`}
                  >
                    <StickyNote className="w-3.5 h-3.5 mr-1" />
                    Notes
                    {highlights.length > 0 && (
                      <span className="ml-1 text-[10px] opacity-60">({highlights.length})</span>
                    )}
                  </button>
                  <button
                    onClick={() => setSidebarTab('reading')}
                    className={`flex-1 justify-center ${sidebarTab === 'reading' ? 'active' : ''}`}
                  >
                    <BookMarked className="w-3.5 h-3.5 mr-1" />
                    Reading
                    {readingList.length > 0 && (
                      <span className="ml-1 text-[10px] opacity-60">({readingList.length})</span>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {/* Notes Tab */}
                {sidebarTab === 'notes' && (
                  <>
                    {Object.keys(groupedHighlights).length === 0 ? (
                      <div className="text-center py-8">
                        <StickyNote className="w-8 h-8 mx-auto text-[var(--text-muted)] mb-2" />
                        <p className="text-[var(--text-muted)] text-xs">
                          Click on a highlight to add a note
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {Object.entries(groupedHighlights)
                          .sort(([a], [b]) => Number(a) - Number(b))
                          .map(([pageNum, pageHighlights]) => (
                            <div key={pageNum}>
                              <button
                                onClick={() => scrollToPage(Number(pageNum))}
                                className="text-[10px] font-medium text-[var(--text-muted)] mb-1.5 hover:text-[var(--accent-primary)] transition-colors uppercase tracking-wide"
                              >
                                Page {pageNum}
                              </button>
                              {pageHighlights.map((highlight) => {
                                const highlightNotes = notes.filter(
                                  (n) => n.highlightId === highlight.id
                                );

                                const highlightColorInfo = HIGHLIGHT_COLORS.find(c => c.color === getHighlightColor(highlight));

                                return (
                                  <Fragment key={highlight.id}>
                                    {/* Render each note as a separate sticky card */}
                                    {/* Render each note as a separate sticky card */}
                                    {highlightNotes.map((note) => (
                                      <div
                                        key={note.id}
                                        className="rounded-lg mb-3 transition-all cursor-pointer group overflow-hidden relative hover:scale-[1.02] hover:shadow-lg"
                                        style={{
                                          backgroundColor: isDarkMode
                                            ? (highlightColorInfo?.bgDark || '#3d3522')
                                            : (highlightColorInfo?.bg || '#fef9c3'),
                                          boxShadow: `0 1px 3px ${highlightColorInfo?.shadow || 'rgba(251, 191, 36, 0.15)'}, 0 1px 2px ${highlightColorInfo?.shadow || 'rgba(251, 191, 36, 0.15)'}`,
                                          transformOrigin: 'center center',
                                        }}
                                        onMouseEnter={() => setHoveredNoteHighlightId(highlight.id)}
                                        onMouseLeave={() => setHoveredNoteHighlightId(null)}
                                        onClick={() => {
                                          scrollToHighlight(highlight);
                                          // Calculate position for floating editor - use bounding box of VALID rects only
                                          const validRects = highlight.rects.filter(r => r.width > 5 && r.height > 5);
                                          if (validRects.length > 0) {
                                            const minX = Math.min(...validRects.map(r => r.x));
                                            const maxX = Math.max(...validRects.map(r => r.x + r.width));
                                            const minY = Math.min(...validRects.map(r => r.y));
                                            const popupX = ((minX + maxX) / 2) * effectiveScale;
                                            const popupY = minY * effectiveScale - 10;
                                            setEditingHighlightPosition({ x: popupX, y: popupY });
                                          }
                                          setEditingHighlight(highlight);
                                          // Initialize note state - never default to edit/add mode
                                          setCurrentNoteIndex(0);
                                          setIsAddingNewNote(false);
                                          setEditingNoteId(null);
                                          setNoteInput('');
                                          setIsEditingNote(false);
                                        }}
                                      >
                                        {/* Delete button - top right */}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteNote(note.id);
                                          }}
                                          className="absolute top-2 right-2 p-1 rounded-full hover:text-[var(--accent-red)] opacity-0 group-hover:opacity-100 transition-all"
                                          style={{
                                            color: isDarkMode ? (highlightColorInfo?.textDark || '#fef3c7') : (highlightColorInfo?.accent || '#ca8a04'),
                                            backgroundColor: isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)',
                                          }}
                                        >
                                          <X className="w-3 h-3" />
                                        </button>

                                        {/* Main content */}
                                        <div className="p-3 pb-2 pr-8">
                                          {/* Quoted highlight text */}
                                          <p
                                            className="text-[10px] italic line-clamp-2 mb-2"
                                            style={{
                                              color: isDarkMode
                                                ? (highlightColorInfo?.textDark || '#fef3c7')
                                                : (highlightColorInfo?.dark || '#78350f'),
                                              opacity: isDarkMode ? 0.7 : 1,
                                            }}
                                          >
                                            "{highlight.text}"
                                          </p>

                                          {/* Note content */}
                                          <p
                                            className="text-xs font-medium"
                                            style={{
                                              color: isDarkMode
                                                ? (highlightColorInfo?.textDark || '#fef3c7')
                                                : 'var(--text-primary)',
                                            }}
                                          >
                                            {note.content}
                                          </p>
                                        </div>

                                        {/* Footer with darker tint */}
                                        <div
                                          className="px-3 py-2 flex items-center justify-between"
                                          style={{ backgroundColor: `${highlightColorInfo?.border || '#fbbf24'}20` }}
                                        >
                                          <span
                                            className="text-[9px] font-medium"
                                            style={{
                                              color: isDarkMode
                                                ? (highlightColorInfo?.textDark || '#fef3c7')
                                                : (highlightColorInfo?.dark || '#78350f'),
                                              opacity: isDarkMode ? 0.7 : 1,
                                            }}
                                          >
                                            {new Date(note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                          </span>
                                          <ChevronRight
                                            className="w-3.5 h-3.5"
                                            style={{ color: highlightColorInfo?.accent || '#ca8a04' }}
                                          />
                                        </div>
                                      </div>
                                    ))}
                                  </Fragment>
                                );
                              })}
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                )}

                {/* Reading List Tab */}
                {sidebarTab === 'reading' && (
                  <>
                    {readingList.length === 0 ? (
                      <div className="text-center py-8">
                        <BookMarked className="w-8 h-8 mx-auto text-[var(--text-muted)] mb-2" />
                        <p className="text-[var(--text-muted)] text-xs">
                          No references saved yet
                        </p>
                        <p className="text-[var(--text-muted)] text-[10px] mt-1">
                          Highlight a reference to add it
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {readingList.map((item) => {
                          const itemPaper = allPapers.get(item.paperId);
                          const resolved = isReadingItemResolved(item);
                          const isCurrentPaper = item.paperId === paperId;

                          return (
                            <div
                              key={item.id}
                              className={`p-3 rounded-xl border transition-all ${resolved
                                ? 'bg-[var(--bg-secondary)] border-[var(--border-muted)] opacity-60'
                                : isCurrentPaper
                                  ? 'bg-[var(--bg-secondary)] border-[var(--border-default)]'
                                  : 'bg-[var(--bg-card)] border-[var(--border-default)]'
                                }`}
                            >
                              <div className="flex items-start gap-2.5">
                                <button
                                  onClick={() => toggleReadingResolved(item)}
                                  className={`w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${resolved
                                    ? 'border-[var(--text-secondary)] bg-[var(--text-secondary)]'
                                    : 'border-[var(--border-default)] hover:border-[var(--text-secondary)]'
                                    }`}
                                  style={{ width: '18px', height: '18px' }}
                                >
                                  {resolved && <Check className="w-2.5 h-2.5 text-white" />}
                                </button>

                                {/* Color indicator */}
                                <div
                                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
                                  style={{
                                    backgroundColor: HIGHLIGHT_COLORS.find(c => c.color === getHighlightColor(item))?.border
                                  }}
                                />

                                <div className="flex-1 min-w-0">
                                  <button
                                    onClick={() => {
                                      if (isCurrentPaper) {
                                        // Scroll to the highlight and open the popup
                                        scrollToHighlight(item);
                                        // Open the popup after scrolling
                                        setTimeout(() => {
                                          const pageEl = pageRefs.current.get(item.pageNumber);
                                          if (pageEl && item.rects.length > 0) {
                                            const firstRect = item.rects[0];
                                            const popupX = (firstRect.x + firstRect.width / 2) * effectiveScale;
                                            const popupY = firstRect.y * effectiveScale - 10;
                                            setEditingHighlightPosition({ x: popupX, y: popupY });
                                            setEditingHighlight(item);
                                            setCurrentNoteIndex(0);
                                            setIsAddingNewNote(false);
                                            setEditingNoteId(null);
                                            setNoteInput('');
                                            setIsEditingNote(false);
                                          }
                                        }, 300);
                                      } else {
                                        navigate(`/reader/${item.paperId}`, { state: { from: sourceRoute }, replace: true });
                                      }
                                    }}
                                    className={`text-left text-xs text-[var(--text-primary)] leading-relaxed hover:text-[var(--accent-primary)] transition-colors ${resolved ? 'line-through' : ''}`}
                                    style={{ wordBreak: 'break-all' }}
                                  >
                                    {item.text}
                                  </button>

                                  {itemPaper && (
                                    <button
                                      onClick={() => {
                                        if (isCurrentPaper) {
                                          scrollToHighlight(item);
                                        } else {
                                          navigate(`/reader/${itemPaper.id}`, { state: { from: sourceRoute }, replace: true });
                                        }
                                      }}
                                      className="flex items-center gap-1 mt-1.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors"
                                    >
                                      <span className="truncate max-w-[140px]">{itemPaper.title}</span>
                                      <span>· p.{item.pageNumber}</span>
                                    </button>
                                  )}

                                  {!resolved && (
                                    <a
                                      href={`https://scholar.google.com/scholar?q=${encodeURIComponent(item.text.slice(0, 100))}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 mt-2 px-2 py-1 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-[10px] hover:text-[var(--text-primary)] transition-colors"
                                    >
                                      <ExternalLink className="w-2.5 h-2.5" />
                                      Search Scholar
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Draggable Divider */}
            <div
              className="relative h-1 bg-[var(--border-default)] cursor-row-resize hover:bg-[var(--accent-primary)] transition-colors flex-shrink-0"
              onMouseDown={(e) => {
                setIsDragging(true);
                e.preventDefault();
              }}
              style={{
                cursor: 'row-resize',
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-0.5 bg-[var(--text-muted)] opacity-30"></div>
              </div>
            </div>

            {/* Insight Panel */}
            <div
              className="flex-shrink-0 bg-[var(--bg-card)] overflow-hidden flex flex-col"
              style={{ height: `${metadataPanelHeight}px` }}
            >
              <div className="p-3 overflow-y-auto flex-1">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">Insight</h3>
                  <button
                    onClick={handleAIAutofill}
                    disabled={isAIAutofilling}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="AI Autofill"
                  >
                    {isAIAutofilling ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    {isAIAutofilling ? 'AI...' : 'AI'}
                  </button>
                </div>

                <div className="space-y-2.5">

                  {/* Methodology */}
                  <div>
                    <label className="block text-[10px] font-medium text-[var(--text-secondary)] mb-1 tracking-wide">
                      Methodology
                    </label>
                    <textarea
                      value={metadata.methodology}
                      onChange={(e) => setMetadata(prev => ({ ...prev, methodology: e.target.value }))}
                      placeholder="Research methodology..."
                      className="w-full text-xs p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] focus:bg-[var(--bg-card)] resize-none"
                      rows={5}
                    />
                  </div>

                  {/* Conclusion */}
                  <div>
                    <label className="block text-[10px] font-medium text-[var(--text-secondary)] mb-1 tracking-wide">
                      Conclusion
                    </label>
                    <textarea
                      value={metadata.conclusion}
                      onChange={(e) => setMetadata(prev => ({ ...prev, conclusion: e.target.value }))}
                      placeholder="Key conclusions..."
                      className="w-full text-xs p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] focus:bg-[var(--bg-card)] resize-none"
                      rows={5}
                    />
                  </div>

                  {/* Limitation */}
                  <div>
                    <label className="block text-[10px] font-medium text-[var(--text-secondary)] mb-1 tracking-wide">
                      Limitation
                    </label>
                    <textarea
                      value={metadata.limitation}
                      onChange={(e) => setMetadata(prev => ({ ...prev, limitation: e.target.value }))}
                      placeholder="Limitations..."
                      className="w-full text-xs p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] focus:bg-[var(--bg-card)] resize-none"
                      rows={5}
                    />
                  </div>

                  {/* Notes (Learnings) */}
                  <div>
                    <label className="block text-[10px] font-medium text-[var(--text-secondary)] mb-1 tracking-wide">
                      Notes
                    </label>
                    <textarea
                      value={metadata.notes}
                      onChange={(e) => setMetadata(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="Learnings for your research..."
                      className="w-full text-xs p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] focus:bg-[var(--bg-card)] resize-none"
                      rows={5}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Paper Modal */}
      {showEditModal && paper && (
        <EditPaperModal
          paper={paper}
          onClose={() => setShowEditModal(false)}
          onSave={handlePaperSave}
          showMetadataFields
          metadata={{
            firstAuthor: metadata.firstAuthor,
            date: metadata.date,
            venue: metadata.venue,
          }}
          onMetadataChange={handleMetadataChange}
        />
      )}
    </div>
  );
}

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
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
  Trash2,
  Info,
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
  deleteNote,
  getAllPapers,
  updatePaper,
  getSettings,
} from '../lib/database';

import 'react-pdf/dist/Page/TextLayer.css';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Pastel color palette for highlights - consistent with NotesPage
const HIGHLIGHT_COLORS: { color: HighlightColor; bg: string; border: string; accent: string; dark: string; shadow: string }[] = [
  { color: 'yellow', bg: '#fef9c3', border: '#fbbf24', accent: '#ca8a04', dark: '#78350f', shadow: 'rgba(180, 130, 20, 0.25)' },
  { color: 'green', bg: '#dcfce7', border: '#4ade80', accent: '#16a34a', dark: '#14532d', shadow: 'rgba(34, 160, 70, 0.25)' },
  { color: 'blue', bg: '#dbeafe', border: '#3b82f6', accent: '#2563eb', dark: '#1e3a5f', shadow: 'rgba(45, 100, 200, 0.25)' },
  { color: 'red', bg: '#fee2e2', border: '#f87171', accent: '#dc2626', dark: '#7f1d1d', shadow: 'rgba(200, 80, 80, 0.25)' },
  { color: 'purple', bg: '#f3e8ff', border: '#a855f7', accent: '#9333ea', dark: '#581c87', shadow: 'rgba(140, 70, 200, 0.25)' },
];

// Parse references from PDF text
function parseReferences(fullText: string): Map<string, string> {
  const references = new Map<string, string>();
  
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
  
  let refSectionStart = -1;
  for (const pattern of refSectionPatterns) {
    const match = normalizedText.match(pattern);
    if (match && match.index !== undefined) {
      // Find it in the last 40% of the document (references are usually at the end)
      const lastPortion = normalizedText.slice(Math.floor(normalizedText.length * 0.6));
      const matchInLastPortion = lastPortion.match(pattern);
      if (matchInLastPortion && matchInLastPortion.index !== undefined) {
        refSectionStart = Math.floor(normalizedText.length * 0.6) + matchInLastPortion.index + matchInLastPortion[0].length;
        console.log(`Found references section at position ${refSectionStart} using pattern: ${pattern}`);
        break;
      }
    }
  }
  
  // If we didn't find a header, look for numbered entries in the last portion
  if (refSectionStart === -1) {
    const lastThird = normalizedText.slice(-Math.floor(normalizedText.length / 3));
    // Look for [1] pattern
    const bracketMatch = lastThird.match(/\[1\]/);
    if (bracketMatch && bracketMatch.index !== undefined) {
      refSectionStart = normalizedText.length - lastThird.length + bracketMatch.index;
      console.log(`Found references by [1] pattern at position ${refSectionStart}`);
    }
  }
  
  if (refSectionStart === -1) {
    console.log('Could not find references section in PDF');
    return references;
  }
  
  const refSection = normalizedText.slice(refSectionStart);
  console.log(`Reference section length: ${refSection.length} chars`);
  console.log(`First 500 chars of ref section: ${refSection.slice(0, 500)}`);
  
  // Try bracket style first: [1] ... [2] ...
  const bracketPattern = /\[(\d+)\]/g;
  const bracketMatches: { num: string; index: number }[] = [];
  let match;
  
  while ((match = bracketPattern.exec(refSection)) !== null) {
    bracketMatches.push({ num: match[1], index: match.index });
  }
  
  if (bracketMatches.length >= 3) {
    console.log(`Found ${bracketMatches.length} bracket references`);
    for (let i = 0; i < bracketMatches.length; i++) {
      const current = bracketMatches[i];
      const next = bracketMatches[i + 1];
      const startIdx = current.index + current.num.length + 2; // skip "[N]"
      const endIdx = next ? next.index : refSection.length;
      const refText = refSection.slice(startIdx, endIdx).trim();
      
      if (refText.length > 10) {
        references.set(current.num, refText);
      }
    }
  }
  
  // If bracket style didn't work, try numbered style: 1. ... 2. ...
  if (references.size === 0) {
    const numberedPattern = /(?:^|\s)(\d{1,3})\.\s+([A-Z])/g;
    const numberedMatches: { num: string; index: number }[] = [];
    
    while ((match = numberedPattern.exec(refSection)) !== null) {
      numberedMatches.push({ num: match[1], index: match.index });
    }
    
    if (numberedMatches.length >= 3) {
      console.log(`Found ${numberedMatches.length} numbered references`);
      for (let i = 0; i < numberedMatches.length; i++) {
        const current = numberedMatches[i];
        const next = numberedMatches[i + 1];
        const startIdx = current.index;
        const endIdx = next ? next.index : refSection.length;
        let refText = refSection.slice(startIdx, endIdx).trim();
        
        // Remove the leading number
        refText = refText.replace(/^\d{1,3}\.\s*/, '');
        
        if (refText.length > 10) {
          references.set(current.num, refText);
        }
      }
    }
  }
  
  console.log(`Total parsed references: ${references.size}`);
  if (references.size > 0) {
    console.log('Sample references:', Array.from(references.entries()).slice(0, 3));
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
  const [citationNoteInput, setCitationNoteInput] = useState('');
  const [references, setReferences] = useState<Map<string, string>>(new Map());
  const [referencesLoaded, setReferencesLoaded] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'notes' | 'reading'>('notes');
  const [readingList, setReadingList] = useState<Highlight[]>([]);
  const [allPapers, setAllPapers] = useState<Map<string, Paper>>(new Map());
  const [documentReady, setDocumentReady] = useState(false);
  const [documentKey, setDocumentKey] = useState(0); // Used to force Document recreation
  
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
  const [pdfContainerReady, setPdfContainerReady] = useState(false); // For fade-in effect
  const paperScrollPositions = useRef<Map<string, number>>(new Map()); // Store scroll positions per paper
  
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
  const [editingPaper, setEditingPaper] = useState<Paper | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAuthors, setEditAuthors] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editNewTagInput, setEditNewTagInput] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const isMountedRef = useRef(true);

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
    const [papers, settings] = await Promise.all([
      getAllPapers(),
      getSettings(),
    ]);
    const paperMap = new Map<string, Paper>();
    papers.forEach((p) => paperMap.set(p.id, p));
    setAllPapers(paperMap);
    if (settings.sortOption) {
      setSortOption(settings.sortOption);
    }
  }, []);

  useEffect(() => {
    loadAllPapers();
  }, [loadAllPapers]);

  // Switch to a different paper while preserving scroll position
  const switchToPaper = useCallback((targetPaperId: string) => {
    if (targetPaperId === paperId) return;
    
    // Save current scroll position before switching
    if (paperId && containerRef.current) {
      paperScrollPositions.current.set(paperId, containerRef.current.scrollTop);
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
  }, [paperId, navigate, sourceRoute]);

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

  // Save panel states to localStorage
  useEffect(() => {
    localStorage.setItem('reader-showPaperList', String(showPaperList));
  }, [showPaperList]);

  useEffect(() => {
    localStorage.setItem('reader-showRightPanel', String(showRightPanel));
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
    setTimeout(() => setDocumentReady(true), 50);
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
    if (anchorNode) {
      let element = anchorNode.parentElement;
      while (element) {
        const pageAttr = element.getAttribute('data-page');
        if (pageAttr) {
          selectedPage = parseInt(pageAttr);
          break;
        }
        element = element.parentElement;
      }
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
    // Ensure popup doesn't go off the right edge
    const maxX = containerWidth - 250;
    
    setColorPickerPosition({
      x: Math.min(relativeX, maxX),
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
    if (!paperId || !selectedText) return;

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

    const highlight: Highlight = {
      id: uuidv4(),
      paperId,
      pageNumber: selectionPage,
      // For further reading, use the selected color (allow user to choose, default to purple)
      color: markAsFurtherReading ? (color || 'purple') : color,
      text: highlightText,
      rects,
      note: noteText,
      isFurtherReading: markAsFurtherReading,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await addHighlight(highlight);
    setHighlights((prev) => [...prev, highlight]);
    if (markAsFurtherReading && highlight.paperId === paperId) {
      // Add to reading list if it's from current paper
      setReadingList((prev) => [...prev, highlight]);
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
    setEditingHighlight(null);
    setEditingHighlightPosition(null);
  };

  const handleDeleteNote = async (noteId: string) => {
    await deleteNote(noteId);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  const handleDeleteHighlight = async (highlightId: string) => {
    await deleteHighlight(highlightId);
    setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
    setReadingList((prev) => prev.filter((h) => h.id !== highlightId));
    // Also delete related notes
    const relatedNotes = notes.filter((n) => n.highlightId === highlightId);
    for (const note of relatedNotes) {
      await deleteNote(note.id);
    }
    setNotes((prev) => prev.filter((n) => n.highlightId !== highlightId));
    setEditingHighlight(null);
    setEditingHighlightPosition(null);
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

  const searchGoogleScholar = (text: string) => {
    const query = encodeURIComponent(text.slice(0, 100));
    window.open(`https://scholar.google.com/scholar?q=${query}`, '_blank');
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

  // Edit paper modal functions
  const openEditModal = () => {
    if (!paper) return;
    setEditingPaper(paper);
    setEditTitle(paper.title);
    setEditAuthors(paper.authors || '');
    setEditTags([...paper.tags]);
    setEditNewTagInput('');
  };

  const addEditTag = () => {
    const trimmed = editNewTagInput.trim().toLowerCase();
    if (trimmed && !editTags.includes(trimmed)) {
      setEditTags(prev => [...prev, trimmed]);
      setEditNewTagInput('');
    }
  };

  const removeEditTag = (tag: string) => {
    setEditTags(prev => prev.filter(t => t !== tag));
  };

  const saveEditedPaper = async () => {
    if (!editingPaper || !paper) return;
    
    const updatedPaper: Paper = {
      ...editingPaper,
      title: editTitle || editingPaper.title,
      authors: editAuthors || undefined,
      tags: editTags,
    };
    
    await updatePaper(updatedPaper);
    setEditingPaper(null);
    setPaper(updatedPaper);
    paperRef.current = updatedPaper;
    // Update allPapers map so sidebar shows updated info
    setAllPapers(prev => {
      const newMap = new Map(prev);
      newMap.set(updatedPaper.id, updatedPaper);
      return newMap;
    });
  };

  const handleAIAutofill = async () => {
    if (!paper) return;
    
    setIsAIAutofilling(true);
    let extractionPdf: any = null;
    try {
      const settings = await getSettings();
      if (!settings.openaiApiKey) {
        alert('Please add your OpenAI API key in Settings to use AI autofill.');
        setIsAIAutofilling(false);
        return;
      }

      // Extract text from PDF using a separate instance (don't destroy the main one)
      // Reload the file from database to ensure we have a fresh, non-detached ArrayBuffer
      // This is safer than trying to copy a potentially detached buffer
      const file = await getPaperFile(paper.id);
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
        ? `\n\nMy Existing Notes on This Paper:\n${allUserNotes.join('\n\n')}\n\nIMPORTANT: In the "notes" field, directly address any TODOs, questions, or potential connections I've mentioned above. Avoid generic statements like "this paper resonates with my research"—be specific about what and why.`
        : '';

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
- venue: Publication venue (CHI, UIST, journal name, etc.)
- date: Publication year (e.g., "2023")
- methodology: Research methodology—be direct, no filler phrases (2-3 sentences)
- conclusion: Key findings—go straight to the point (2-3 sentences)
- limitation: Stated or obvious limitations (2-3 sentences)
- notes: Write in first person from my perspective (use "I", "my research", "I should consider", etc.). Include practical learnings, actionable insights, and specific risks or challenges I should keep in mind for my research. Pay special attention to any TODOs, questions, or potential connections I've already noted—address those specifically. Avoid generic statements like "this paper resonates with my research"—be concrete about what I can learn, what risks to watch for, and how this connects to my work. Be direct and thorough.

Return ONLY a valid JSON object, no other text. If a field cannot be determined, use an empty string. Format:
{
  "title": "...",
  "firstAuthor": "...",
  "venue": "...",
  "date": "...",
  "methodology": "...",
  "conclusion": "...",
  "limitation": "...",
  "notes": "..."
}`;

      // Call OpenAI API
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a seasoned CHI (ACM Conference on Human Factors in Computing Systems) paper author and reviewer helping me extract structured metadata from academic papers. For the "notes" field, write in first person from my perspective (use "I", "my research", "I should consider"). Be direct and concise—avoid filler phrases like "The research reveals that" or "This paper demonstrates." Avoid generic statements like "this paper resonates with my research"—be specific and actionable. Always respond with valid JSON only, no markdown formatting or additional text.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3,
          max_tokens: 1500,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
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
        methodology: extractedMetadata.methodology || '',
        conclusion: extractedMetadata.conclusion || '',
        limitation: extractedMetadata.limitation || '',
        notes: extractedMetadata.notes || '',
      };

      // Update the paper immediately with title, metadata and authors (if firstAuthor is available)
      // This ensures metadata.firstAuthor is saved and matches the extracted author
      if (paper) {
        const extractedTitle = extractedMetadata.title || '';
        const updatedPaper: Paper = {
          ...paper,
          title: extractedTitle || paper.title, // Update title if extracted, otherwise keep existing
          authors: extractedMetadata.firstAuthor ? extractedMetadata.firstAuthor : paper.authors, // Update main authors field with firstAuthor
          metadata: {
            ...paper.metadata,
            ...newMetadata,
          },
        };
        
        // Save immediately
        await updatePaper(updatedPaper);
        setPaper(updatedPaper);
        paperRef.current = updatedPaper;
        
        // Also update in allPapers map for sidebar
        setAllPapers(prev => {
          const newMap = new Map(prev);
          newMap.set(updatedPaper.id, updatedPaper);
          return newMap;
        });
        
        // Update metadata state (this will not trigger autosave since we already saved)
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
    const effectiveColor = isFurtherReading && color === 'blue' ? 'purple' : color;
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
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-[var(--text-primary)] truncate max-w-[300px]">
                {displayTitle}
              </h1>
              {displayAuthors && (
                <p className="text-xs text-[var(--text-muted)] truncate">{displayAuthors}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Info Button */}
            {paper && (
              <button
                onClick={openEditModal}
                className="toolbar-btn"
                title="Edit paper info"
              >
                <Info className="w-4 h-4" />
              </button>
            )}
            
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
                  setFitToWidth(false);
                  setScale((s) => Math.max(0.5, s - 0.1));
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
                  setFitToWidth(false);
                  setScale((s) => Math.min(3, s + 0.1));
                }}
                className="toolbar-btn"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <div className="w-px h-4 bg-[var(--border-default)] mx-0.5" />
              <button
                onClick={() => setFitToWidth(!fitToWidth)}
                className={`toolbar-btn ${fitToWidth ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}
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
          className={`flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
            showPaperList ? 'w-64' : 'w-0'
          }`}
        >
          <div 
            className={`w-64 h-full flex flex-col bg-[var(--bg-secondary)] border-r border-[var(--border-default)] transition-transform duration-200 ease-out ${
              showPaperList ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
          <div className="p-3 border-b border-[var(--border-default)] flex-shrink-0">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Papers</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {Array.from(allPapers.values())
              .sort((a, b) => {
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
              })
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => switchToPaper(p.id)}
                  className={`group w-full text-left px-3 py-2.5 border-b border-[var(--border-muted)] transition-colors ${
                    p.id === paperId
                      ? 'bg-[var(--bg-tertiary)]'
                      : 'hover:bg-[var(--bg-tertiary)]/50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <FileText className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                      p.id === paperId ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                    }`} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs leading-snug line-clamp-2 ${
                        p.id === paperId 
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
                        className={`p-0.5 rounded transition-all ${
                          p.isStarred
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
                </button>
              ))}
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
            }
          }}
        >
          {/* Overlay that fades out when PDF is ready */}
          <div 
            className={`absolute inset-0 z-40 pointer-events-none transition-opacity duration-300 flex items-center justify-center ${
              pdfContainerReady ? 'opacity-0' : 'opacity-100'
            }`}
            style={{ background: 'var(--bg-tertiary)' }}
          >
            {isLoading && (
              <Loader2 className="w-8 h-8 text-[var(--text-muted)] animate-spin" />
            )}
          </div>
          <div className="flex flex-col items-center py-6 gap-4 px-8">
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
                const pageHighlights = highlights.filter((h) => h.pageNumber === pageNum);

                return (
                  <div
                    key={pageNum}
                    data-page={pageNum}
                    className="relative mb-4"
                    onClick={(e) => {
                      // Dismiss floating editor when clicking on page background (only if no text entered)
                      if (editingHighlight && !noteInput.trim() && e.target === e.currentTarget) {
                        setEditingHighlight(null);
                        setEditingHighlightPosition(null);
                        setNoteInput('');
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
                              className={`absolute pointer-events-none transition-all duration-300 ${
                                isHovered ? 'animate-highlight-pulse' : ''
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
                                const validRects = highlight.rects.filter(r => r.width > 5 && r.height > 5);
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
                                setNoteInput('');
                              }}
                            />
                          ))}
                        </div>
                      );
                    })}
                    
                    {/* Floating Highlight Editor - shown when a highlight on this page is clicked */}
                    {editingHighlight && editingHighlightPosition && editingHighlight.pageNumber === pageNum && (() => {
                      const editColorInfo = HIGHLIGHT_COLORS.find(c => c.color === getHighlightColor(editingHighlight));
                      const highlightHasNotes = notes.some(n => n.highlightId === editingHighlight.id);
                      
                      // Get page width to constrain popup position
                      const pageEl = pageRefs.current.get(pageNum);
                      const pageWidth = pageEl?.getBoundingClientRect().width || 600;
                      const popupWidth = 300; // approximate popup width
                      const halfPopup = popupWidth / 2;
                      
                      // Clamp x position so popup stays within page bounds
                      const clampedX = Math.max(halfPopup, Math.min(editingHighlightPosition.x, pageWidth - halfPopup));
                      
                      return (
                        <div
                          className="absolute z-50 animate-scale-in"
                          style={{
                            left: clampedX,
                            top: editingHighlightPosition.y,
                            transform: 'translate(-50%, -100%)',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div 
                            className="rounded-xl overflow-hidden shadow-xl"
                            style={{
                              backgroundColor: editColorInfo?.bg || '#fef9c3',
                              minWidth: '280px',
                              maxWidth: '320px',
                            }}
                          >
                            {/* Color picker bar */}
                            <div 
                              className="px-3 py-2 flex items-center justify-between border-b"
                              style={{ borderColor: `${editColorInfo?.border}30` }}
                            >
                              <div className="flex items-center gap-2">
                                {HIGHLIGHT_COLORS.map(({ color, bg, border }) => (
                                  <button
                                    key={color}
                                    onClick={() => handleChangeHighlightColor(editingHighlight, color)}
                                    className="w-6 h-6 rounded-full transition-all hover:scale-110"
                                    style={{
                                      backgroundColor: bg,
                                      border: editingHighlight.color === color ? `2px solid ${border}` : '2px solid transparent',
                                      boxShadow: editingHighlight.color === color ? `0 0 0 2px white` : 'none',
                                    }}
                                    title={color.charAt(0).toUpperCase() + color.slice(1)}
                                  />
                                ))}
                              </div>
                              <button
                                onClick={() => handleDeleteHighlight(editingHighlight.id)}
                                className="p-1.5 rounded-full hover:bg-red-100 transition-colors text-[var(--text-muted)] hover:text-red-500"
                                title="Delete highlight"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            
                            {/* Note input */}
                            <div className="p-3">
                              <textarea
                                value={noteInput}
                                onChange={(e) => setNoteInput(e.target.value)}
                                placeholder="Add a note..."
                                rows={2}
                                autoFocus
                                className="w-full text-xs py-2 px-3 mb-2 resize-none bg-white/80 border-0"
                                style={{ 
                                  borderRadius: '8px',
                                  color: editColorInfo?.dark || '#78350f',
                                  outline: 'none',
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault();
                                    if (noteInput.trim()) {
                                      handleAddNote();
                                    }
                                  } else if (e.key === 'Escape') {
                                    setEditingHighlight(null);
                                    setEditingHighlightPosition(null);
                                    setNoteInput('');
                                  }
                                }}
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    setEditingHighlight(null);
                                    setEditingHighlightPosition(null);
                                    setNoteInput('');
                                  }}
                                  className="flex-1 text-xs py-1.5 px-3 rounded-full bg-white/50 hover:bg-white/80 transition-colors"
                                  style={{ color: editColorInfo?.dark || '#78350f' }}
                                >
                                  {highlightHasNotes ? 'Close' : 'Cancel'}
                                </button>
                                <button
                                  onClick={() => {
                                    if (noteInput.trim()) {
                                      handleAddNote();
                                    }
                                  }}
                                  disabled={!noteInput.trim()}
                                  className="flex-1 btn-primary text-xs py-1.5 px-3 disabled:opacity-50"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
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
            const detectedRef = detectReference(selectedText);
            const looksLikeRef = isLikelyReference(selectedText);
            const showRefButton = detectedRef || looksLikeRef;
            
            // Get reference info if available
            const refInfo = detectedRef ? getReferenceInfo(detectedRef) : null;
            const hasRefTitle = refInfo && refInfo.title;
            
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
                          createHighlight('purple', true, citationNoteInput.trim() || undefined);
                          setCitationNoteInput('');
                        }}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--text-primary)] text-[var(--bg-primary)] text-sm font-medium hover:opacity-90 transition-opacity"
                      >
                        <Plus className="w-4 h-4" />
                        Add to Reading List
                      </button>
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
                          createHighlight('purple', true, citationNoteInput.trim() || undefined);
                          setCitationNoteInput('');
                        }}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--text-primary)] text-[var(--bg-primary)] text-sm font-medium hover:opacity-90 transition-opacity"
                      >
                        <Plus className="w-4 h-4" />
                        Add to Reading List
                      </button>
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
          className={`flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
            showRightPanel ? 'w-80' : 'w-0'
          }`}
        >
          <div 
            className={`w-80 h-full flex flex-col border-l border-[var(--border-default)] relative transition-transform duration-200 ease-out ${
              showRightPanel ? 'translate-x-0' : 'translate-x-full'
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
                                        backgroundColor: highlightColorInfo?.bg || '#fef9c3',
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
                                        setNoteInput('');
                                      }}
                                    >
                                      {/* Delete button - top right */}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteNote(note.id);
                                        }}
                                        className="absolute top-2 right-2 p-1 rounded-full hover:text-[var(--accent-red)] hover:bg-white/50 opacity-0 group-hover:opacity-100 transition-all"
                                        style={{ color: highlightColorInfo?.accent || '#ca8a04' }}
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                      
                                      {/* Main content */}
                                      <div className="p-3 pb-2 pr-8">
                                        {/* Quoted highlight text - dark readable color */}
                                        <p 
                                          className="text-[10px] italic line-clamp-2 mb-2"
                                          style={{ color: highlightColorInfo?.dark || '#78350f' }}
                                        >
                                          "{highlight.text}"
                                        </p>
                                        
                                        {/* Note content - near black for emphasis */}
                                        <p className="text-xs font-medium text-[var(--text-primary)]">
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
                                          style={{ color: highlightColorInfo?.dark || '#78350f' }}
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
                            className={`p-3 rounded-xl border transition-all ${
                              resolved
                                ? 'bg-[var(--bg-secondary)] border-[var(--border-muted)] opacity-60'
                                : isCurrentPaper
                                ? 'bg-[var(--bg-secondary)] border-[var(--border-default)]'
                                : 'bg-[var(--bg-card)] border-[var(--border-default)]'
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <button
                                onClick={() => toggleReadingResolved(item)}
                                className={`w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                                  resolved
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
                                <p
                                  className={`text-xs text-[var(--text-primary)] leading-relaxed ${
                                    resolved ? 'line-through' : ''
                                  }`}
                                >
                                  {item.text}
                                </p>

                                {itemPaper && (
                                  <button
                                    onClick={() => {
                                      if (isCurrentPaper) {
                                        scrollToPage(item.pageNumber);
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
                                  <button
                                    onClick={() => searchGoogleScholar(item.text)}
                                    className="flex items-center gap-1 mt-2 px-2 py-1 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-[10px] hover:text-[var(--text-primary)] transition-colors"
                                  >
                                    <ExternalLink className="w-2.5 h-2.5" />
                                    Search Scholar
                                  </button>
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

          {/* Metadata Panel */}
          <div 
            className="flex-shrink-0 bg-[var(--bg-card)] overflow-hidden flex flex-col"
            style={{ height: `${metadataPanelHeight}px` }}
          >
            <div className="p-3 overflow-y-auto flex-1">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">Metadata</h3>
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
                {/* Title */}
                <div>
                  <label className="block text-[10px] font-medium text-[var(--text-secondary)] mb-1 tracking-wide">
                    Title
                  </label>
                  <input
                    type="text"
                    value={paper?.title || ''}
                    onChange={(e) => {
                      if (!paper) return;
                      const newTitle = e.target.value;
                      const updatedPaper = { ...paper, title: newTitle };
                      setPaper(updatedPaper);
                      paperRef.current = updatedPaper;
                      
                      // Autosave title changes
                      if (metadataSaveTimeoutRef.current) {
                        clearTimeout(metadataSaveTimeoutRef.current);
                      }
                      metadataSaveTimeoutRef.current = window.setTimeout(async () => {
                        try {
                          await updatePaper(updatedPaper);
                          // Also update in allPapers map for sidebar
                          setAllPapers(prev => {
                            const newMap = new Map(prev);
                            newMap.set(updatedPaper.id, updatedPaper);
                            return newMap;
                          });
                        } catch (err) {
                          console.error('Failed to save title:', err);
                        }
                      }, 500);
                    }}
                    placeholder="Paper title..."
                    className="w-full text-xs p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] focus:bg-[var(--bg-card)]"
                  />
                </div>

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

                {/* Divider */}
                <div className="border-t border-[var(--border-muted)] my-3"></div>

                {/* First Author */}
                <div>
                  <label className="block text-[10px] font-medium text-[var(--text-secondary)] mb-1 tracking-wide">
                    First Author
                  </label>
                  <input
                    type="text"
                    value={metadata.firstAuthor}
                    onChange={(e) => setMetadata(prev => ({ ...prev, firstAuthor: e.target.value }))}
                    placeholder="First author name"
                    className="w-full text-xs p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] focus:bg-[var(--bg-card)]"
                  />
                </div>

                {/* Date */}
                <div>
                  <label className="block text-[10px] font-medium text-[var(--text-secondary)] mb-1 tracking-wide">
                    Date
                  </label>
                  <input
                    type="text"
                    value={metadata.date}
                    onChange={(e) => setMetadata(prev => ({ ...prev, date: e.target.value }))}
                    placeholder="Publication date"
                    className="w-full text-xs p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] focus:bg-[var(--bg-card)]"
                  />
                </div>

                {/* Venue */}
                <div>
                  <label className="block text-[10px] font-medium text-[var(--text-secondary)] mb-1 tracking-wide">
                    Venue
                  </label>
                  <input
                    type="text"
                    value={metadata.venue}
                    onChange={(e) => setMetadata(prev => ({ ...prev, venue: e.target.value }))}
                    placeholder="Conference, Journal, etc."
                    className="w-full text-xs p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] focus:bg-[var(--bg-card)]"
                  />
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* Edit Paper Modal */}
      {editingPaper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setEditingPaper(null)}
          />
          <div className="relative bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-5 w-full max-w-md animate-scale-in shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Edit Paper
              </h2>
              <button
                onClick={() => setEditingPaper(null)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Paper title"
                  className="w-full text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Authors
                </label>
                <input
                  type="text"
                  value={editAuthors}
                  onChange={(e) => setEditAuthors(e.target.value)}
                  placeholder="Smith, J., Johnson, A."
                  className="w-full text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Tags
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {editTags.map((tag) => (
                    <span key={tag} className="tag active flex items-center gap-1">
                      {tag}
                      <button
                        onClick={() => removeEditTag(tag)}
                        className="hover:text-[var(--accent-red)]"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editNewTagInput}
                    onChange={(e) => setEditNewTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEditTag())}
                    placeholder="Add tag..."
                    className="flex-1 text-sm"
                  />
                  <button onClick={addEditTag} className="btn-secondary px-2.5">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setEditingPaper(null)}
                className="btn-secondary flex-1 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveEditedPaper}
                className="btn-primary flex-1 text-sm"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

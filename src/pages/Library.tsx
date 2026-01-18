import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { pdfjs } from 'react-pdf';
import {
  Upload,
  Search,
  FileText,
  Trash2,
  Settings,
  BookMarked,
  BookOpen,
  StickyNote,
  X,
  Plus,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Edit3,
  Tag,
  Check,
  Star,
  MessageSquare,
  ArrowUp,
  ArrowDown,
  Archive,
  PenTool,
  XCircle,
  Download,
  Table2,
  Sparkles,
  Loader2,
} from 'lucide-react';
import type { Paper, SortOption, Note } from '../types';
import { getAllPapers, addPaper, addPaperFile, deletePaper, getAllTags, updatePaper, updatePapersBatch, getSettings, updateSettings, getAllNotes, archivePaper } from '../lib/database';
import { EditPaperModal } from '../components/EditPaperModal';
import { ProjectSelector } from '../components/ProjectSelector';
import { useProject } from '../contexts/ProjectContext';
import { useComposingEnabled } from '../contexts/FeatureFlagContext';
import { callOpenAI } from '../lib/openai';

// Setup pdfjs worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;


interface UploadItem {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'complete' | 'error';
  progress: number;
  error?: string;
}

const SCROLL_POSITION_KEY = 'library-page-scroll';
const FILTER_STATE_KEY = 'library-filter-state';

// Helper to load filter state from sessionStorage
function loadFilterState(): { selectedTags: string[]; searchQuery: string; showStarredOnly: boolean; showUnreadOnly: boolean; showArchivedOnly: boolean; showFinishedOnly: boolean; showUnfinishedOnly: boolean } {
  try {
    const saved = sessionStorage.getItem(FILTER_STATE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        selectedTags: Array.isArray(parsed.selectedTags) ? parsed.selectedTags : [],
        searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
        showStarredOnly: Boolean(parsed.showStarredOnly),
        showUnreadOnly: Boolean(parsed.showUnreadOnly),
        showArchivedOnly: Boolean(parsed.showArchivedOnly),
        showFinishedOnly: Boolean(parsed.showFinishedOnly),
        showUnfinishedOnly: Boolean(parsed.showUnfinishedOnly),
      };
    }
  } catch (e) {
    console.warn('[Library] Failed to load filter state:', e);
  }
  return { selectedTags: [], searchQuery: '', showStarredOnly: false, showUnreadOnly: false, showArchivedOnly: false, showFinishedOnly: false, showUnfinishedOnly: false };
}

export function Library() {
  const navigate = useNavigate();
  const composingEnabled = useComposingEnabled();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);

  // Initialize filter states from sessionStorage
  const initialFilterState = loadFilterState();
  const [selectedTags, setSelectedTags] = useState<string[]>(initialFilterState.selectedTags);
  const [searchQuery, setSearchQuery] = useState(initialFilterState.searchQuery);
  const [sortOption, setSortOption] = useState<SortOption>('date-desc');
  const [isLoading, setIsLoading] = useState(true);

  // Project context
  const { currentProject, isLoading: isProjectLoading } = useProject();
  const sortOptionSaveTimeoutRef = useRef<number | null>(null);
  
  // Track if initial animation has played to prevent replay on tab switch
  const hasAnimatedRef = useRef(false);

  // Filter states (initialized from sessionStorage)
  const [showStarredOnly, setShowStarredOnly] = useState(initialFilterState.showStarredOnly);
  const [showUnreadOnly, setShowUnreadOnly] = useState(initialFilterState.showUnreadOnly);
  const [showArchivedOnly, setShowArchivedOnly] = useState(initialFilterState.showArchivedOnly);
  const [showFinishedOnly, setShowFinishedOnly] = useState(initialFilterState.showFinishedOnly);
  const [showUnfinishedOnly, setShowUnfinishedOnly] = useState(initialFilterState.showUnfinishedOnly);

  // Restore scroll position on mount and when navigating back
  useEffect(() => {
    const savedPosition = sessionStorage.getItem(SCROLL_POSITION_KEY);
    if (savedPosition) {
      // Use requestAnimationFrame for better scroll restoration
      requestAnimationFrame(() => {
        window.scrollTo(0, parseInt(savedPosition, 10));
      });
    }
  }, []);

  // Save scroll position as user scrolls
  useEffect(() => {
    const handleScroll = () => {
      sessionStorage.setItem(SCROLL_POSITION_KEY, window.scrollY.toString());
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Save filter state when it changes
  useEffect(() => {
    sessionStorage.setItem(FILTER_STATE_KEY, JSON.stringify({
      selectedTags,
      searchQuery,
      showStarredOnly,
      showUnreadOnly,
      showArchivedOnly,
      showFinishedOnly,
      showUnfinishedOnly,
    }));
  }, [selectedTags, searchQuery, showStarredOnly, showUnreadOnly, showArchivedOnly, showFinishedOnly, showUnfinishedOnly]);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploadModalClosing, setIsUploadModalClosing] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadAuthors, setUploadAuthors] = useState('');
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [showUploadTagSuggestions, setShowUploadTagSuggestions] = useState(false);
  const [uploadTagSuggestionPos, setUploadTagSuggestionPos] = useState({ top: 0, left: 0, width: 0 });
  const uploadTagInputRef = useRef<HTMLInputElement>(null);
  const uploadTagSuggestionsRef = useRef<HTMLDivElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Multi-file upload state
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [showUploadProgress, setShowUploadProgress] = useState(false);
  const [isUploadProgressMinimized, setIsUploadProgressMinimized] = useState(false);
  const isProcessingRef = useRef(false);

  // Selection state
  const [selectedPapers, setSelectedPapers] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // Edit modal state
  const [editingPaper, setEditingPaper] = useState<Paper | null>(null);

  // Batch edit state
  const [showBatchEditModal, setShowBatchEditModal] = useState(false);
  const [isBatchEditModalClosing, setIsBatchEditModalClosing] = useState(false);
  const [batchAddTags, setBatchAddTags] = useState<string[]>([]);
  const [batchRemoveTags, setBatchRemoveTags] = useState<string[]>([]);
  const [batchNewTagInput, setBatchNewTagInput] = useState('');
  const [showBatchTagSuggestions, setShowBatchTagSuggestions] = useState(false);
  const batchTagInputRef = useRef<HTMLInputElement>(null);
  const batchTagSuggestionsRef = useRef<HTMLDivElement>(null);
  
  // AI tag suggestion state
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  const [aiSuggestionInput, setAiSuggestionInput] = useState('');
  const [aiTagPlan, setAiTagPlan] = useState<{ paperId: string; title: string; currentTags: string[]; suggestedTags: string[] }[]>([]);
  const [isLoadingAISuggestions, setIsLoadingAISuggestions] = useState(false);

  // Modal close handlers with exit animations
  const handleCloseUploadModal = () => {
    setIsUploadModalClosing(true);
  };
  const handleUploadModalAnimationEnd = () => {
    if (isUploadModalClosing) {
      setIsUploadModalClosing(false);
      setShowUploadModal(false);
    }
  };
  const handleCloseBatchEditModal = () => {
    setIsBatchEditModalClosing(true);
  };
  const handleBatchEditModalAnimationEnd = () => {
    if (isBatchEditModalClosing) {
      setIsBatchEditModalClosing(false);
      setShowBatchEditModal(false);
    }
  };

  const loadData = useCallback(async () => {
    if (isProjectLoading || !currentProject) return;

    try {
      // Only show loading spinner if we have no papers yet (initial load)
      // This prevents flicker when switching projects
      if (papers.length === 0) {
        setIsLoading(true);
      }
      console.log(`[Library] Loading papers for project ${currentProject.name}...`);
      const [loadedPapers, tags, settings, notes] = await Promise.all([
        getAllPapers(currentProject.id),
        getAllTags(currentProject.id),
        getSettings(),
        getAllNotes(currentProject.id)
      ]);
      console.log(`[Library] Loaded ${loadedPapers.length} papers, ${notes.length} notes`);
      setPapers(loadedPapers);
      setAllTags(tags);
      setAllNotes(notes);
      // Load saved sort option
      if (settings.sortOption) {
        setSortOption(settings.sortOption);
      }
    } catch (error) {
      console.error('[Library] Error loading data:', error);
      // Show user-friendly error
      if (error instanceof Error) {
        alert(`Failed to load papers: ${error.message}. Please refresh the page.`);
      } else {
        alert('Failed to load papers. Please refresh the page.');
      }
      // Set empty array to prevent infinite loading state
      setPapers([]);
    } finally {
      setIsLoading(false);
      // Mark initial animation as complete after a short delay
      setTimeout(() => {
        hasAnimatedRef.current = true;
      }, 500);
    }
  }, [currentProject, isProjectLoading]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Clear filters when project changes (tags are project-specific)
  const prevProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentProject && prevProjectIdRef.current !== null && prevProjectIdRef.current !== currentProject.id) {
      // Project changed - clear filters
      setSelectedTags([]);
      setShowStarredOnly(false);
      setShowUnreadOnly(false);
      setShowArchivedOnly(false);
      setShowFinishedOnly(false);
      setShowUnfinishedOnly(false);
    }
    prevProjectIdRef.current = currentProject?.id ?? null;
  }, [currentProject]);

  // Refresh notes when page becomes visible again (user navigates back from Reader)
  useEffect(() => {
    const refreshNotes = async () => {
      if (currentProject && !isProjectLoading) {
        try {
          const notes = await getAllNotes(currentProject.id);
          setAllNotes(notes);
        } catch (error) {
          console.error('[Library] Failed to refresh notes:', error);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshNotes();
      }
    };

    const handleFocus = () => {
      refreshNotes();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [currentProject, isProjectLoading]);

  // Save sort option when it changes
  useEffect(() => {
    if (sortOptionSaveTimeoutRef.current) {
      clearTimeout(sortOptionSaveTimeoutRef.current);
    }

    sortOptionSaveTimeoutRef.current = setTimeout(async () => {
      const settings = await getSettings();
      await updateSettings({ ...settings, sortOption });
    }, 300);

    return () => {
      if (sortOptionSaveTimeoutRef.current) {
        clearTimeout(sortOptionSaveTimeoutRef.current);
      }
    };
  }, [sortOption]);

  // Compute tag counts and sort by count (descending)
  const tagsWithCounts = useMemo(() => {
    const countMap = new Map<string, number>();
    
    // Count papers for each tag
    papers.forEach(paper => {
      paper.tags.forEach(tag => {
        countMap.set(tag, (countMap.get(tag) || 0) + 1);
      });
    });
    
    // Convert to array and sort by count (descending), then alphabetically for ties
    return allTags
      .map(tag => ({ tag, count: countMap.get(tag) || 0 }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.tag.localeCompare(b.tag);
      });
  }, [papers, allTags]);

  // Extract title and authors from PDF
  const extractPDFMetadata = async (fileData: ArrayBuffer): Promise<{ title?: string; authors?: string }> => {
    try {
      const pdf = await pdfjs.getDocument({ data: fileData }).promise;

      // Try to get metadata first
      const metadata = await pdf.getMetadata();
      const info = metadata?.info;

      let title: string | undefined;
      let authors: string | undefined;

      // Extract from metadata
      if (info) {
        const infoAny = info as any;
        title = infoAny.Title || infoAny.title;
        authors = infoAny.Author || infoAny.author || infoAny.Creator || infoAny.creator;
      }

      // If title/authors not in metadata, try to extract from first page
      if (!title || !authors) {
        try {
          const firstPage = await pdf.getPage(1);
          const textContent = await firstPage.getTextContent();
          const pageText = textContent.items
            .map((item: any) => (item.str || '') as string)
            .join(' ')
            .trim();

          // Try to parse title and authors from first page
          if ((!title || !authors) && pageText) {
            const lines = pageText.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);

            // Title is usually the first substantial line (longer, often all caps or title case)
            if (!title && lines.length > 0) {
              // Look for title in first 3 lines
              for (let i = 0; i < Math.min(3, lines.length); i++) {
                const line = lines[i];
                // Title is usually:
                // - Longer than 20 chars
                // - Shorter than 200 chars
                // - Not all caps (usually title case or sentence case)
                // - Doesn't look like author list (no commas followed by initials)
                if (line.length > 20 && line.length < 200) {
                  // Skip if it looks like author list
                  if (!line.match(/^[A-Z][a-z]+\s+[A-Z]\.\s*[A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+\s+[A-Z]\.)/)) {
                    title = line;
                    break;
                  }
                }
              }
            }

            // Authors usually come after title, before abstract/introduction
            if (!authors && lines.length > 1) {
              // Skip first line (title), look in next 5 lines
              for (let i = 1; i < Math.min(6, lines.length); i++) {
                const line = lines[i];

                // Skip common section headers
                if (line.match(/^(abstract|introduction|keywords|doi|accepted|published)/i)) {
                  break;
                }

                // Author patterns:
                // - Names with initials: "Smith, J., Jones, A."
                // - Full names: "John Smith, Alice Jones"
                // - "et al." pattern
                // - Often contains commas, "and", or "&"

                // Pattern 1: Comma-separated names (most common)
                if (line.match(/[A-Z][a-z]+(?:\s+[A-Z]\.?\s*)*[A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z]\.?\s*)*[A-Z][a-z]+)+/)) {
                  // Extract just the author part (before email, affiliation, etc.)
                  authors = line.split(/[@\(\)\[\]0-9]/)[0].trim();
                  break;
                }

                // Pattern 2: Single or two authors with "and"
                if (line.match(/^[A-Z][a-z]+(?:\s+[A-Z]\.?\s*)*[A-Z][a-z]+\s+(and|&)\s+[A-Z][a-z]+(?:\s+[A-Z]\.?\s*)*[A-Z][a-z]+/i)) {
                  authors = line.split(/[@\(\)\[\]0-9]/)[0].trim();
                  break;
                }

                // Pattern 3: "et al." pattern
                if (line.match(/[A-Z][a-z]+\s+et\s+al\.?/i)) {
                  authors = line.split(/[@\(\)\[\]0-9]/)[0].trim();
                  break;
                }

                // Pattern 4: Line with email (authors often listed with emails)
                if (line.includes('@')) {
                  // Take the part before the email
                  const beforeEmail = line.split('@')[0].trim();
                  // Also check previous line for author names
                  if (i > 1 && lines[i - 1].match(/[A-Z][a-z]+/)) {
                    authors = lines[i - 1].split(/[@\(\)\[\]0-9]/)[0].trim();
                  } else if (beforeEmail.length > 5 && beforeEmail.length < 150) {
                    authors = beforeEmail;
                  }
                  if (authors) break;
                }
              }
            }
          }

          pdf.destroy();
        } catch (pageError) {
          console.error('Error extracting from first page:', pageError);
          pdf.destroy();
        }
      } else {
        pdf.destroy();
      }

      return { title, authors };
    } catch (error) {
      console.error('Error extracting PDF metadata:', error);
      return {};
    }
  };

  const handleFileSelect = async (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      alert('Please select a valid PDF file.');
      return;
    }

    // Check file size (50MB limit for Supabase free tier)
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      alert(`This file (${sizeMB}MB) exceeds the 50MB upload limit. Please compress the PDF or use a smaller file.`);
      return;
    }

    setPendingFile(file);

    // Extract title from PDF (skip author detection)
    try {
      const fileData = await file.arrayBuffer();
      const { title } = await extractPDFMetadata(fileData);

      setUploadTitle(title || file.name.replace('.pdf', ''));
      setUploadAuthors('');
    } catch (error) {
      console.error('Error extracting metadata:', error);
      setUploadTitle(file.name.replace('.pdf', ''));
      setUploadAuthors('');
    }

    setShowUploadModal(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleMultiFileSelect(Array.from(files));
    }
    // Reset input so same files can be selected again
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleMultiFileSelect(Array.from(files));
    }
  };

  // Handle multiple file selection
  const handleMultiFileSelect = (files: File[]) => {
    const pdfFiles = files.filter(f => f.type === 'application/pdf');

    if (pdfFiles.length === 0) {
      alert('Please select valid PDF files.');
      return;
    }

    // Check file sizes (50MB limit for Supabase free tier)
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    const oversizedFiles = pdfFiles.filter(f => f.size > MAX_FILE_SIZE);

    if (oversizedFiles.length > 0) {
      const fileNames = oversizedFiles.map(f => f.name).join(', ');
      const sizeMB = (oversizedFiles[0].size / (1024 * 1024)).toFixed(1);
      alert(`The following file(s) exceed the 50MB limit:\n${fileNames}\n\n${oversizedFiles[0].name} is ${sizeMB}MB. Please compress the PDF or use a smaller file.`);
      return;
    }

    // If only one file, use the existing modal flow
    if (pdfFiles.length === 1) {
      handleFileSelect(pdfFiles[0]);
      return;
    }

    // Multiple files: add to queue and process automatically
    const newItems: UploadItem[] = pdfFiles.map(file => ({
      id: uuidv4(),
      file,
      status: 'pending' as const,
      progress: 0,
    }));

    setUploadQueue(prev => [...prev, ...newItems]);
    setShowUploadProgress(true);
    setIsUploadProgressMinimized(false);
  };

  // Process upload queue
  const processUploadQueue = useCallback(async () => {
    if (isProcessingRef.current) return;

    const pendingItem = uploadQueue.find(item => item.status === 'pending');
    if (!pendingItem) return;

    isProcessingRef.current = true;

    // Update status to uploading
    setUploadQueue(prev => prev.map(item =>
      item.id === pendingItem.id ? { ...item, status: 'uploading' as const, progress: 10 } : item
    ));

    try {
      const paperId = uuidv4();

      // Progress: reading file
      setUploadQueue(prev => prev.map(item =>
        item.id === pendingItem.id ? { ...item, progress: 30 } : item
      ));

      console.log(`[Batch Upload] Reading file: ${pendingItem.file.name}, size: ${pendingItem.file.size}`);
      const fileData = await pendingItem.file.arrayBuffer();
      console.log(`[Batch Upload] ArrayBuffer size after read: ${fileData.byteLength}`);

      // Create a fresh copy immediately for upload before anything else touches it
      const uploadCopy = fileData.slice(0);
      console.log(`[Batch Upload] Upload copy size: ${uploadCopy.byteLength}`);

      // Progress: extracting metadata
      setUploadQueue(prev => prev.map(item =>
        item.id === pendingItem.id ? { ...item, progress: 40 } : item
      ));

      // Extract title from PDF - use a separate copy and skip if it fails
      let title: string | undefined;
      try {
        const metadataCopy = fileData.slice(0);
        const metadata = await extractPDFMetadata(metadataCopy);
        title = metadata.title;
      } catch (e) {
        console.warn('[Batch Upload] Metadata extraction failed:', e);
        title = undefined;
      }

      console.log(`[Batch Upload] Upload copy size after metadata: ${uploadCopy.byteLength}`);

      // Progress: creating paper record
      setUploadQueue(prev => prev.map(item =>
        item.id === pendingItem.id ? { ...item, progress: 50 } : item
      ));

      const paper: Paper = {
        id: paperId,
        title: title || pendingItem.file.name.replace('.pdf', ''),
        authors: undefined,
        fileName: pendingItem.file.name,
        fileSize: pendingItem.file.size,
        tags: [],
        uploadedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await addPaper(paper);

      // Progress: saving file data
      setUploadQueue(prev => prev.map(item =>
        item.id === pendingItem.id ? { ...item, progress: 80 } : item
      ));

      console.log(`[Batch Upload] About to upload, copy size: ${uploadCopy.byteLength}`);

      // Use the upload copy (guaranteed to not be detached)
      await addPaperFile({
        id: uuidv4(),
        paperId,
        data: uploadCopy,
      });

      console.log(`[Batch Upload] Upload complete for ${pendingItem.file.name}`);

      // Complete
      setUploadQueue(prev => prev.map(item =>
        item.id === pendingItem.id ? { ...item, status: 'complete' as const, progress: 100 } : item
      ));

      loadData();
    } catch (err) {
      console.error('Failed to upload paper:', err);
      let errorMessage = 'Upload failed';

      if (err instanceof Error) {
        // Parse common error messages
        if (err.message.includes('413') || err.message.includes('too large') || err.message.includes('exceeded')) {
          errorMessage = 'File too large (max 50MB)';
        } else if (err.message.includes('400')) {
          errorMessage = 'Invalid file format';
        } else if (err.message.includes('500') || err.message.includes('Internal Server Error')) {
          errorMessage = 'Server error - please try again';
        } else {
          errorMessage = err.message.length > 50 ? err.message.substring(0, 50) + '...' : err.message;
        }
      }

      setUploadQueue(prev => prev.map(item =>
        item.id === pendingItem.id ? {
          ...item,
          status: 'error' as const,
          error: errorMessage
        } : item
      ));
    } finally {
      isProcessingRef.current = false;
    }
  }, [uploadQueue, loadData]);

  // Process queue when items are added
  useEffect(() => {
    const hasPending = uploadQueue.some(item => item.status === 'pending');
    const hasUploading = uploadQueue.some(item => item.status === 'uploading');

    if (hasPending && !hasUploading) {
      processUploadQueue();
    }
  }, [uploadQueue, processUploadQueue]);

  // Auto-hide progress after all complete
  useEffect(() => {
    if (uploadQueue.length > 0) {
      const allDone = uploadQueue.every(item => item.status === 'complete' || item.status === 'error');
      if (allDone) {
        const timer = setTimeout(() => {
          setShowUploadProgress(false);
          setUploadQueue([]);
        }, 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [uploadQueue]);

  const clearUploadQueue = () => {
    setUploadQueue([]);
    setShowUploadProgress(false);
  };

  // Selection handlers
  const handlePaperClick = (e: React.MouseEvent, paper: Paper) => {
    const isMetaKey = e.metaKey || e.ctrlKey;
    const isShiftKey = e.shiftKey;

    if (isMetaKey) {
      // Toggle selection
      setSelectedPapers(prev => {
        const next = new Set(prev);
        if (next.has(paper.id)) {
          next.delete(paper.id);
        } else {
          next.add(paper.id);
        }
        return next;
      });
      setLastSelectedId(paper.id);
    } else if (isShiftKey) {
      // Range selection with Shift
      if (lastSelectedId && lastSelectedId !== paper.id) {
        // Select range from lastSelectedId to current paper
        const paperIds = filteredAndSortedPapers.map(p => p.id);
        const lastIndex = paperIds.indexOf(lastSelectedId);
        const currentIndex = paperIds.indexOf(paper.id);

        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          const rangeIds = paperIds.slice(start, end + 1);

          setSelectedPapers(prev => {
            const next = new Set(prev);
            rangeIds.forEach(id => next.add(id));
            return next;
          });
        }
      } else if (!lastSelectedId) {
        // No previous selection, just select this one
        setSelectedPapers(prev => {
          const next = new Set(prev);
          next.add(paper.id);
          return next;
        });
        setLastSelectedId(paper.id);
      }
    } else if (selectedPapers.size > 0 && !selectedPapers.has(paper.id)) {
      // Click outside selection clears it
      setSelectedPapers(new Set());
      setLastSelectedId(null);
    } else if (selectedPapers.size === 0) {
      // No selection, open the paper
      handleOpenPaper(paper);
    } else if (selectedPapers.size === 1 && selectedPapers.has(paper.id)) {
      // Clicking selected paper opens it
      handleOpenPaper(paper);
    }
  };

  const togglePaperSelection = (e: React.MouseEvent, paperId: string) => {
    e.stopPropagation();
    const isMetaKey = e.metaKey || e.ctrlKey;
    const isShiftKey = e.shiftKey;

    if (isShiftKey && lastSelectedId && lastSelectedId !== paperId) {
      // Range selection with Shift
      const paperIds = filteredAndSortedPapers.map(p => p.id);
      const lastIndex = paperIds.indexOf(lastSelectedId);
      const currentIndex = paperIds.indexOf(paperId);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeIds = paperIds.slice(start, end + 1);

        setSelectedPapers(prev => {
          const next = new Set(prev);
          rangeIds.forEach(id => next.add(id));
          return next;
        });
        setLastSelectedId(paperId);
      }
    } else if (isMetaKey) {
      // Toggle selection with Cmd/Ctrl
      setSelectedPapers(prev => {
        const next = new Set(prev);
        if (next.has(paperId)) {
          next.delete(paperId);
        } else {
          next.add(paperId);
        }
        return next;
      });
      setLastSelectedId(paperId);
    } else {
      // Regular toggle (or single selection)
      setSelectedPapers(prev => {
        const next = new Set(prev);
        if (next.has(paperId)) {
          next.delete(paperId);
        } else {
          next.add(paperId);
        }
        return next;
      });
      setLastSelectedId(paperId);
    }
  };

  const selectAllPapers = () => {
    setSelectedPapers(new Set(filteredAndSortedPapers.map(p => p.id)));
  };

  const clearSelection = () => {
    setSelectedPapers(new Set());
    setLastSelectedId(null);
  };

  // Edit single paper
  const openEditModal = (e: React.MouseEvent, paper: Paper) => {
    e.stopPropagation();
    setEditingPaper(paper);
  };

  const handleSaveEditedPaper = () => {
    loadData();
  };

  // Batch edit
  const openBatchEditModal = () => {
    setBatchAddTags([]);
    setBatchRemoveTags([]);
    setBatchNewTagInput('');
    setShowAISuggestions(false);
    setAiSuggestionInput('');
    setAiTagPlan([]);
    setShowBatchEditModal(true);
  };

  const addBatchTag = () => {
    const trimmed = batchNewTagInput.trim().toLowerCase();
    if (trimmed && !batchAddTags.includes(trimmed)) {
      setBatchAddTags(prev => [...prev, trimmed]);
      setBatchNewTagInput('');
    }
  };

  const toggleBatchRemoveTag = (tag: string) => {
    setBatchRemoveTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const generateAITagSuggestions = async () => {
    if (selectedPapers.size === 0) return;
    
    setIsLoadingAISuggestions(true);
    setAiTagPlan([]);
    
    try {
      const selectedPapersList = papers.filter(p => selectedPapers.has(p.id));
      
      // Prepare paper info for the AI
      const paperInfo = selectedPapersList.map(p => ({
        id: p.id,
        title: p.title,
        authors: p.authors,
        abstract: p.abstract?.slice(0, 300),
        currentTags: p.tags,
      }));
      
      const systemPrompt = `You are an expert research librarian helping organize academic papers.

Your task is to suggest relevant tags for EACH paper individually. Consider:
1. Research themes and topics
2. Methodologies used
3. Application domains
4. Paper types (e.g., survey, empirical study, system, etc.)

${allTags.length > 0 ? `Existing tags in this library (prefer reusing these when appropriate): ${allTags.join(', ')}` : 'No existing tags yet.'}

${aiSuggestionInput.trim() ? `User's grouping ideas: "${aiSuggestionInput.trim()}"` : ''}

Respond with a JSON object containing a "papers" array. Each item should have:
- "id": the paper id from input
- "suggestedTags": array of 2-5 lowercase tag strings for this specific paper

Example:
{
  "papers": [
    { "id": "abc123", "suggestedTags": ["machine learning", "healthcare", "empirical study"] },
    { "id": "def456", "suggestedTags": ["nlp", "survey", "transformers"] }
  ]
}`;

      const userMessage = `Papers to tag:\n${JSON.stringify(paperInfo, null, 2)}`;
      
      const response = await callOpenAI({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });
      
      const content = response.choices[0].message.content;
      // Parse the JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.papers)) {
          const plan = parsed.papers.map((item: { id: string; suggestedTags: string[] }) => {
            const paper = selectedPapersList.find(p => p.id === item.id);
            return {
              paperId: item.id,
              title: paper?.title || 'Unknown',
              currentTags: paper?.tags || [],
              suggestedTags: item.suggestedTags.map((t: string) => t.toLowerCase().trim()),
            };
          });
          setAiTagPlan(plan);
        }
      }
    } catch (error) {
      console.error('Error generating AI tag suggestions:', error);
      alert('Failed to generate AI suggestions. Please try again.');
    } finally {
      setIsLoadingAISuggestions(false);
    }
  };

  const updateTagPlan = (paperId: string, newTags: string[]) => {
    setAiTagPlan(prev => prev.map(item => 
      item.paperId === paperId ? { ...item, suggestedTags: newTags } : item
    ));
  };

  const addTagToPlan = (paperId: string, tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed) return;
    setAiTagPlan(prev => prev.map(item => 
      item.paperId === paperId && !item.suggestedTags.includes(trimmed)
        ? { ...item, suggestedTags: [...item.suggestedTags, trimmed] }
        : item
    ));
  };

  const removeTagFromPlan = (paperId: string, tag: string) => {
    setAiTagPlan(prev => prev.map(item => 
      item.paperId === paperId
        ? { ...item, suggestedTags: item.suggestedTags.filter(t => t !== tag) }
        : item
    ));
  };

  const applyAITagPlan = async () => {
    if (aiTagPlan.length === 0) return;
    
    try {
      const papersToUpdate: Paper[] = [];
      
      for (const planItem of aiTagPlan) {
        const paper = papers.find(p => p.id === planItem.paperId);
        if (!paper) continue;
        
        // Merge current tags with suggested tags (no duplicates)
        const mergedTags = [...new Set([...paper.tags, ...planItem.suggestedTags])];
        
        if (JSON.stringify(mergedTags.sort()) !== JSON.stringify(paper.tags.sort())) {
          papersToUpdate.push({ ...paper, tags: mergedTags });
        }
      }
      
      if (papersToUpdate.length > 0) {
        await updatePapersBatch(papersToUpdate);
        console.log(`[Library] Applied AI tags to ${papersToUpdate.length} paper(s)`);
      }
      
      // Reset state
      setShowBatchEditModal(false);
      setAiTagPlan([]);
      setAiSuggestionInput('');
      setShowAISuggestions(false);
      clearSelection();
      await loadData();
    } catch (error) {
      console.error('Error applying AI tag plan:', error);
      alert('Failed to apply tags. Please try again.');
    }
  };

  const applyBatchEdit = async () => {
    if (selectedPapers.size === 0) return;

    const selectedPapersList = papers.filter(p => selectedPapers.has(p.id));
    if (selectedPapersList.length === 0) {
      alert('No papers selected');
      return;
    }

    try {
      // Prepare all updates in memory first
      const papersToUpdate: Paper[] = [];

      for (const paper of selectedPapersList) {
        // Ensure tags is an array
        const currentTags = Array.isArray(paper.tags) ? paper.tags : [];
        const newTags = [...currentTags];

        // Add new tags
        batchAddTags.forEach(tag => {
          if (!newTags.includes(tag)) {
            newTags.push(tag);
          }
        });

        // Remove tags
        const filteredTags = newTags.filter(tag => !batchRemoveTags.includes(tag));

        // Only include if tags actually changed
        if (JSON.stringify(filteredTags.sort()) !== JSON.stringify(currentTags.sort())) {
          papersToUpdate.push({ ...paper, tags: filteredTags });
        }
      }

      if (papersToUpdate.length === 0) {
        // No changes needed
        setShowBatchEditModal(false);
        setBatchAddTags([]);
        setBatchRemoveTags([]);
        setBatchNewTagInput('');
        setAiTagPlan([]);
        setAiSuggestionInput('');
        setShowAISuggestions(false);
        clearSelection();
        return;
      }

      // Update all papers in a single batch operation
      await updatePapersBatch(papersToUpdate);

      console.log(`[Library] Batch updated ${papersToUpdate.length} paper(s)`);

      setShowBatchEditModal(false);
      setBatchAddTags([]);
      setBatchRemoveTags([]);
      setBatchNewTagInput('');
      setAiTagPlan([]);
      setAiSuggestionInput('');
      setShowAISuggestions(false);
      clearSelection();

      // Reload data to reflect changes
      await loadData();
    } catch (err) {
      console.error('[Library] Batch edit error:', err);
      alert('Failed to apply batch edit. Check console for details.');
    }
  };

  const deleteSelectedPapers = async () => {
    if (selectedPapers.size === 0) return;

    const count = selectedPapers.size;
    if (!confirm(`Are you sure you want to delete ${count} paper${count > 1 ? 's' : ''}?`)) {
      return;
    }

    for (const paperId of selectedPapers) {
      await deletePaper(paperId);
    }

    clearSelection();
    loadData();
  };

  // Export selected papers as BibTeX citations
  const exportCitations = () => {
    if (selectedPapers.size === 0) return;

    const selectedPapersList = papers.filter(p => selectedPapers.has(p.id));
    
    const bibtexEntries = selectedPapersList.map(paper => {
      // Generate a citation key: firstAuthorLastName + year + firstWordOfTitle
      const firstAuthor = paper.authors?.split(/[,&]|and/i)[0]?.trim() || 'Unknown';
      const lastName = firstAuthor.split(/\s+/).pop()?.replace(/[^a-zA-Z]/g, '') || 'Unknown';
      const year = paper.metadata?.date || new Date(paper.uploadedAt).getFullYear().toString();
      const titleFirstWord = paper.title.split(/\s+/)[0]?.replace(/[^a-zA-Z]/g, '').toLowerCase() || 'paper';
      const citeKey = `${lastName.toLowerCase()}${year}${titleFirstWord}`;

      // Build BibTeX entry
      const fields: string[] = [];
      fields.push(`  author = {${paper.authors || 'Unknown'}}`);
      fields.push(`  title = {${paper.title}}`);
      
      if (paper.metadata?.venue) {
        fields.push(`  booktitle = {${paper.metadata.venue}}`);
      }
      fields.push(`  year = {${year}}`);
      
      if (paper.metadata?.doi) {
        fields.push(`  doi = {${paper.metadata.doi}}`);
      }
      if (paper.metadata?.pages) {
        fields.push(`  pages = {${paper.metadata.pages}}`);
      }
      if (paper.metadata?.articleNo) {
        fields.push(`  articleno = {${paper.metadata.articleNo}}`);
      }
      if (paper.metadata?.publisher) {
        fields.push(`  publisher = {${paper.metadata.publisher}}`);
      }
      if (paper.metadata?.location) {
        fields.push(`  address = {${paper.metadata.location}}`);
      }
      if (paper.metadata?.keywords) {
        fields.push(`  keywords = {${paper.metadata.keywords}}`);
      }

      return `@inproceedings{${citeKey},\n${fields.join(',\n')}\n}`;
    });

    const bibtexContent = bibtexEntries.join('\n\n');

    // Download as .bib file
    const blob = new Blob([bibtexContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `citations-${selectedPapers.size}-papers.bib`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Get all tags from selected papers for batch removal options
  const selectedPapersTags = Array.from(
    new Set(
      papers
        .filter(p => selectedPapers.has(p.id))
        .flatMap(p => p.tags)
    )
  ).sort();

  const handleUpload = async () => {
    if (!pendingFile) return;

    setIsUploading(true);
    try {
      const paperId = uuidv4();
      const fileData = await pendingFile.arrayBuffer();

      const paper: Paper = {
        id: paperId,
        title: uploadTitle || pendingFile.name.replace('.pdf', ''),
        authors: uploadAuthors || undefined,
        fileName: pendingFile.name,
        fileSize: pendingFile.size,
        tags: uploadTags,
        uploadedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await addPaper(paper);
      await addPaperFile({
        id: uuidv4(),
        paperId,
        data: fileData,
      });

      // Close modal and reset form
      setShowUploadModal(false);
      setUploadTitle('');
      setUploadAuthors('');
      setUploadTags([]);
      setPendingFile(null);
      setNewTagInput('');

      // Refresh the papers list
      await loadData();
    } catch (err) {
      console.error('Failed to upload paper:', err);

      let errorMessage = 'Failed to upload paper.';
      if (err instanceof Error) {
        if (err.message.includes('413') || err.message.includes('too large') || err.message.includes('exceeded')) {
          errorMessage = 'File too large. Maximum file size is 50MB. Please compress the PDF or use a smaller file.';
        } else if (err.message.includes('400')) {
          errorMessage = 'Invalid file format. Please ensure the file is a valid PDF.';
        } else if (err.message.includes('500')) {
          errorMessage = 'Server error. Please try again later.';
        } else {
          errorMessage = `Upload failed: ${err.message}`;
        }
      }

      alert(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, paperId: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this paper?')) {
      await deletePaper(paperId);
      loadData();
    }
  };

  const handleOpenPaper = async (paper: Paper) => {
    // Save scroll position before navigating
    sessionStorage.setItem(SCROLL_POSITION_KEY, window.scrollY.toString());
    await updatePaper({ ...paper, lastOpenedAt: new Date() });
    navigate(`/reader/${paper.id}`, { state: { from: '/' } });
  };

  const togglePaperReadStatus = async (e: React.MouseEvent, paper: Paper) => {
    e.stopPropagation();
    const updatedPaper = { ...paper, isRead: !paper.isRead };

    // Optimistically update local state immediately
    setPapers(prev => prev.map(p => p.id === paper.id ? updatedPaper : p));

    // Save to database in background
    try {
      await updatePaper(updatedPaper);
    } catch (error) {
      console.error('Failed to update paper read status:', error);
      // Revert on error
      setPapers(prev => prev.map(p => p.id === paper.id ? paper : p));
    }
  };

  const togglePaperStarred = async (e: React.MouseEvent, paper: Paper) => {
    e.stopPropagation();
    const updatedPaper = { ...paper, isStarred: !paper.isStarred };

    // Optimistically update local state immediately
    setPapers(prev => prev.map(p => p.id === paper.id ? updatedPaper : p));

    // Save to database in background
    try {
      await updatePaper(updatedPaper);
    } catch (error) {
      console.error('Failed to update paper starred status:', error);
      // Revert on error
      setPapers(prev => prev.map(p => p.id === paper.id ? paper : p));
    }
  };

  const togglePaperArchived = async (e: React.MouseEvent, paper: Paper) => {
    e.stopPropagation();
    const newArchivedStatus = !paper.isArchived;

    // Optimistically update local state immediately
    setPapers(prev => prev.map(p => p.id === paper.id ? { ...p, isArchived: newArchivedStatus } : p));

    // Save to database in background
    try {
      await archivePaper(paper.id, newArchivedStatus);
    } catch (error) {
      console.error('Failed to update paper archive status:', error);
      // Revert on error
      setPapers(prev => prev.map(p => p.id === paper.id ? paper : p));
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const addUploadTag = () => {
    const trimmed = newTagInput.trim().toLowerCase();
    if (trimmed && !uploadTags.includes(trimmed)) {
      setUploadTags((prev) => [...prev, trimmed]);
      setNewTagInput('');
    }
  };

  const removeUploadTag = (tag: string) => {
    setUploadTags((prev) => prev.filter((t) => t !== tag));
  };

  // Helper to get note count for a paper
  const getNoteCountForPaper = useCallback((paperId: string): number => {
    return allNotes.filter(note => note.paperId === paperId).length;
  }, [allNotes]);

  // Helper to get latest update date for a paper (lastOpenedAt or most recent note)
  const getLastUpdatedDate = useCallback((paper: Paper): Date => {
    // Get notes for this paper
    const paperNotes = allNotes.filter(n => n.paperId === paper.id);
    const latestNoteDate = paperNotes.length > 0
      ? Math.max(...paperNotes.map(n => new Date(n.updatedAt).getTime()))
      : 0;

    const lastOpenedTime = paper.lastOpenedAt ? new Date(paper.lastOpenedAt).getTime() : 0;
    const uploadedTime = new Date(paper.uploadedAt).getTime();

    // Return the most recent date
    const latestTime = Math.max(latestNoteDate, lastOpenedTime, uploadedTime);
    return new Date(latestTime);
  }, [allNotes]);

  // Toggle sort direction for a column
  const toggleSort = (column: 'title' | 'date' | 'notes' | 'progress') => {
    if (column === 'title') {
      setSortOption(prev => prev === 'title-asc' ? 'title-desc' : 'title-asc');
    } else if (column === 'notes') {
      setSortOption(prev => prev === 'notes-desc' ? 'notes-asc' : 'notes-desc');
    } else if (column === 'progress') {
      setSortOption(prev => prev === 'progress-desc' ? 'progress-asc' : 'progress-desc');
    } else {
      setSortOption(prev => prev === 'date-desc' ? 'date-asc' : 'date-desc');
    }
  };

  const filteredAndSortedPapers = papers
    .filter((paper) => {
      const matchesSearch =
        searchQuery === '' ||
        paper.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        paper.authors?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesTags =
        selectedTags.length === 0 ||
        selectedTags.every((tag) => paper.tags.includes(tag));

      const matchesStarred = !showStarredOnly || paper.isStarred;
      const matchesUnread = !showUnreadOnly || !paper.isRead;
      // If showArchivedOnly is true, show only archived papers; otherwise hide archived papers
      const matchesArchived = showArchivedOnly ? paper.isArchived : !paper.isArchived;
      const matchesFinished = !showFinishedOnly || (paper.readingProgress === 100);
      const matchesUnfinished = !showUnfinishedOnly || (paper.readingProgress !== 100);

      return matchesSearch && matchesTags && matchesStarred && matchesUnread && matchesArchived && matchesFinished && matchesUnfinished;
    })
    .sort((a, b) => {
      switch (sortOption) {
        case 'title-asc':
          return a.title.localeCompare(b.title);
        case 'title-desc':
          return b.title.localeCompare(a.title);
        case 'notes-asc':
          return getNoteCountForPaper(a.id) - getNoteCountForPaper(b.id);
        case 'notes-desc':
          return getNoteCountForPaper(b.id) - getNoteCountForPaper(a.id);
        case 'progress-asc':
          return (a.readingProgress || 0) - (b.readingProgress || 0);
        case 'progress-desc':
          return (b.readingProgress || 0) - (a.readingProgress || 0);
        case 'date-asc':
          return getLastUpdatedDate(a).getTime() - getLastUpdatedDate(b).getTime();
        case 'date-desc':
        default:
          return getLastUpdatedDate(b).getTime() - getLastUpdatedDate(a).getTime();
      }
    });

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;

    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[var(--bg-primary)]/80 backdrop-blur-xl border-b border-[var(--border-default)]">
        <div className="max-w-6xl mx-auto px-2 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-base font-semibold text-[var(--text-primary)]">
              Paper Lab
            </span>
            <div className="h-4 w-px bg-[var(--border-default)] mx-1"></div>
            <ProjectSelector />
          </div>

          <nav className="flex items-center gap-1">
            <button
              onClick={() => navigate('/notes')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
            >
              <StickyNote className="w-4 h-4" />
              <span className="font-medium">Notes</span>
            </button>
            <button
              onClick={() => navigate('/journal')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
            >
              <BookOpen className="w-4 h-4" />
              <span className="font-medium">Journal</span>
            </button>
            <button
              onClick={() => navigate('/further-reading')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
            >
              <BookMarked className="w-4 h-4" />
              <span className="font-medium">Reading List</span>
            </button>
            <button
              onClick={() => navigate('/lit-review')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
            >
              <Table2 className="w-4 h-4" />
              <span className="font-medium">Lit Review</span>
            </button>
            {composingEnabled && (
              <button
                onClick={() => navigate('/compose')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
              >
                <PenTool className="w-4 h-4" />
                <span className="font-medium">Compose</span>
              </button>
            )}
            <button
              onClick={() => navigate('/settings')}
              className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-2 py-8">
        <div className="flex gap-8 items-start">
          {/* Left Sidebar - Filters */}
          <aside className="w-52 flex-shrink-0">
            <div className="sticky top-24">
              {/* Search */}
              <div className="mb-6">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full py-2 text-sm"
                    style={{ paddingLeft: '2.25rem', paddingRight: searchQuery ? '1.75rem' : '0.75rem' }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                      aria-label="Clear search"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Quick Filters */}
              <div className="mb-6">
                <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">Filters</h3>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => setShowStarredOnly(!showStarredOnly)}
                    className={`text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${showStarredOnly
                      ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] font-medium'
                      }`}
                  >
                    <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                      <Star className={`w-3.5 h-3.5 ${showStarredOnly ? 'fill-current' : ''}`} />
                    </div>
                    Starred
                  </button>
                  <button
                    onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                    className={`text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${showUnreadOnly
                      ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] font-medium'
                      }`}
                  >
                    <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                      <div className={`w-2 h-2 rounded-full ${showUnreadOnly ? 'bg-[var(--bg-primary)]' : 'bg-blue-500'}`} />
                    </div>
                    Unread
                  </button>
                  <button
                    onClick={() => {
                      setShowFinishedOnly(!showFinishedOnly);
                      if (!showFinishedOnly) setShowUnfinishedOnly(false);
                    }}
                    className={`text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${showFinishedOnly
                      ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] font-medium'
                      }`}
                  >
                    <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                      <svg width="16" height="16" viewBox="0 0 16 16" className="-rotate-90">
                        <circle
                          cx="8"
                          cy="8"
                          r="7"
                          fill="none"
                          stroke={showFinishedOnly ? 'currentColor' : '#22c55e'}
                          strokeWidth="2"
                        />
                      </svg>
                    </div>
                    Finished
                  </button>
                  <button
                    onClick={() => {
                      setShowUnfinishedOnly(!showUnfinishedOnly);
                      if (!showUnfinishedOnly) setShowFinishedOnly(false);
                    }}
                    className={`text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${showUnfinishedOnly
                      ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] font-medium'
                      }`}
                  >
                    <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                      <svg width="16" height="16" viewBox="0 0 16 16" className="-rotate-90">
                        <circle
                          cx="8"
                          cy="8"
                          r="7"
                          fill="none"
                          stroke={showUnfinishedOnly ? 'currentColor' : 'var(--text-muted)'}
                          strokeWidth="2"
                          opacity={showUnfinishedOnly ? 1 : 0.4}
                        />
                        <circle
                          cx="8"
                          cy="8"
                          r="7"
                          fill="none"
                          stroke={showUnfinishedOnly ? 'currentColor' : 'var(--accent-primary)'}
                          strokeWidth="2"
                          strokeDasharray={2 * Math.PI * 7}
                          strokeDashoffset={2 * Math.PI * 7 * 0.5}
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                    Unfinished
                  </button>
                  <button
                    onClick={() => setShowArchivedOnly(!showArchivedOnly)}
                    className={`text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${showArchivedOnly
                      ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] font-medium'
                      }`}
                  >
                    <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                      <Archive className="w-3.5 h-3.5" />
                    </div>
                    Archived
                  </button>
                </div>
              </div>

              {/* Tags Filter */}
              {tagsWithCounts.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">Tags</h3>
                  <div className="flex flex-col gap-1">
                    {tagsWithCounts.map(({ tag, count }) => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-sm transition-colors ${selectedTags.includes(tag)
                          ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] font-medium'
                          }`}
                      >
                        <span>{tag}</span>
                        <span className={`text-xs tabular-nums ${selectedTags.includes(tag) 
                          ? 'text-[var(--bg-primary)] opacity-60' 
                          : 'text-[var(--text-muted)]'
                        }`}>{count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Clear Filters */}
              <button
                onClick={() => {
                  setSelectedTags([]);
                  setShowStarredOnly(false);
                  setShowUnreadOnly(false);
                  setShowFinishedOnly(false);
                  setShowUnfinishedOnly(false);
                }}
                className={`text-left px-3 py-1.5 text-xs text-[var(--accent-red)] hover:underline transition-opacity mb-6 ${selectedTags.length > 0 || showStarredOnly || showUnreadOnly || showFinishedOnly || showUnfinishedOnly ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
              >
                Clear all filters
              </button>

              {/* Upload Button */}
              <label className="btn-primary flex items-center justify-center gap-1.5 cursor-pointer text-sm w-full">
                <Upload className="w-4 h-4" />
                <span>Upload</span>
                <input
                  type="file"
                  accept=".pdf"
                  multiple
                  onChange={handleInputChange}
                  className="hidden"
                />
              </label>
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Controls Bar */}
            <div className="flex items-center justify-between mb-6 h-8">
              <span className="text-sm text-[var(--text-muted)] min-w-[80px]">
                {filteredAndSortedPapers.length} {filteredAndSortedPapers.length === 1 ? 'paper' : 'papers'}
              </span>
            </div>

            {/* Papers List */}
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredAndSortedPapers.length === 0 ? (
              <div
                ref={dropZoneRef}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`drop-zone text-center py-16 px-8 ${isDragging ? 'drag-over' : ''}`}
              >
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center">
                  {isDragging ? (
                    <Upload className="w-7 h-7 text-[var(--text-primary)]" />
                  ) : (
                    <FileText className="w-7 h-7 text-[var(--text-muted)]" />
                  )}
                </div>
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">
                  {isDragging ? 'Drop PDFs here' : papers.length === 0 ? 'No papers yet' : 'No results'}
                </h3>
                <p className="text-sm text-[var(--text-muted)] mb-4">
                  {isDragging
                    ? 'Release to upload multiple files'
                    : papers.length === 0
                      ? 'Drag & drop or click to upload'
                      : 'Try different search terms'}
                </p>
                {!isDragging && papers.length === 0 && (
                  <label className="btn-primary inline-flex items-center gap-1.5 cursor-pointer text-sm">
                    <Upload className="w-4 h-4" />
                    <span>Upload PDFs</span>
                    <input
                      type="file"
                      accept=".pdf"
                      multiple
                      onChange={handleInputChange}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            ) : (
              <div
                ref={dropZoneRef}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className="relative"
              >
                {isDragging && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--accent-primary-muted)] border-2 border-dashed border-[var(--accent-primary)] rounded-xl">
                    <div className="text-center">
                      <Upload className="w-10 h-10 mx-auto text-[var(--accent-primary)] mb-2" />
                      <p className="text-sm font-medium text-[var(--accent-primary)]">
                        Drop PDFs to upload
                      </p>
                    </div>
                  </div>
                )}
                {/* List View */}
                <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
                  <table className="w-full table-fixed">
                    <thead>
                      <tr className="border-b border-[var(--border-default)]">
                        <th className="w-8 pl-4"></th>
                        <th
                          className="text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider px-3 py-3 cursor-pointer hover:text-[var(--text-primary)] transition-colors select-none"
                          style={{ width: '42%' }}
                          onClick={() => toggleSort('title')}
                        >
                          <div className="flex items-center gap-1">
                            Title
                            {(sortOption === 'title-asc' || sortOption === 'title-desc') && (
                              sortOption === 'title-asc'
                                ? <ArrowUp className="w-3 h-3" />
                                : <ArrowDown className="w-3 h-3" />
                            )}
                          </div>
                        </th>
                        <th className="text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider px-3 py-3" style={{ width: '20%' }}>Tags</th>
                        <th
                          className="text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider px-3 py-3 w-20 cursor-pointer hover:text-[var(--text-primary)] transition-colors select-none"
                          onClick={() => toggleSort('notes')}
                        >
                          <div className="flex items-center gap-1">
                            Notes
                            {(sortOption === 'notes-asc' || sortOption === 'notes-desc') && (
                              sortOption === 'notes-asc'
                                ? <ArrowUp className="w-3 h-3" />
                                : <ArrowDown className="w-3 h-3" />
                            )}
                          </div>
                        </th>
                        <th
                          className="text-center text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider px-3 py-3 w-24 cursor-pointer hover:text-[var(--text-primary)] transition-colors select-none"
                          onClick={() => toggleSort('progress')}
                        >
                          <div className="flex items-center justify-center gap-1">
                            Progress
                            {(sortOption === 'progress-asc' || sortOption === 'progress-desc') && (
                              sortOption === 'progress-asc'
                                ? <ArrowUp className="w-3 h-3" />
                                : <ArrowDown className="w-3 h-3" />
                            )}
                          </div>
                        </th>
                        <th
                          className="text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider px-3 py-3 w-24 cursor-pointer hover:text-[var(--text-primary)] transition-colors select-none"
                          onClick={() => toggleSort('date')}
                        >
                          <div className="flex items-center gap-1">
                            Updated
                            {(sortOption === 'date-asc' || sortOption === 'date-desc') && (
                              sortOption === 'date-asc'
                                ? <ArrowUp className="w-3 h-3" />
                                : <ArrowDown className="w-3 h-3" />
                            )}
                          </div>
                        </th>
                        <th className="w-32 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAndSortedPapers.map((paper, index) => {
                        const isSelected = selectedPapers.has(paper.id);
                        const isUnread = !paper.isRead;
                        // Only animate on initial load, not on tab switch
                        const shouldAnimate = !hasAnimatedRef.current;
                        const totalItems = filteredAndSortedPapers.length;
                        const animationDuration = 300;
                        const maxTotalTime = 450;
                        const maxDelay = Math.max(0, maxTotalTime - animationDuration);
                        const delay = totalItems > 1 ? (maxDelay * index) / (totalItems - 1) : 0;

                        return (
                          <tr
                            key={paper.id}
                            onClick={(e) => handlePaperClick(e, paper)}
                            className={`group border-b border-[var(--border-muted)] last:border-0 hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors ${shouldAnimate ? 'animate-fade-in' : ''} ${isSelected ? 'bg-[var(--bg-tertiary)]' : ''
                              }`}
                            style={shouldAnimate ? { animationDelay: `${delay}ms` } : undefined}
                          >
                            {/* Unread indicator */}
                            <td className="pl-4 py-3 w-8">
                              <div className="relative flex items-center justify-center w-4 h-4">
                                {isUnread ? (
                                  <button
                                    onClick={(e) => togglePaperReadStatus(e, paper)}
                                    className="relative w-4 h-4 flex items-center justify-center group/button"
                                    title="Mark as read"
                                  >
                                    <div className="absolute inset-0 w-4 h-4 rounded-full bg-blue-500/20 opacity-0 group-hover/button:opacity-100 transition-opacity" />
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-500" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={(e) => togglePaperReadStatus(e, paper)}
                                    className="relative w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center group/button"
                                    title="Mark as unread"
                                  >
                                    <div className="absolute inset-0 w-4 h-4 rounded-full bg-[var(--text-muted)]/15 opacity-0 group-hover/button:opacity-100 transition-opacity" />
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[var(--text-muted)]/40 group-hover/button:bg-[var(--text-muted)]/60 transition-colors" />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-3 overflow-hidden">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <button
                                    onClick={(e) => togglePaperSelection(e, paper.id)}
                                    className={`p-1 rounded transition-all ${isSelected
                                      ? ''
                                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]'
                                      }`}
                                    style={isSelected ? {
                                      backgroundColor: '#3b82f6',
                                      color: '#ffffff'
                                    } : undefined}
                                  >
                                    {isSelected ? <Check className="w-3.5 h-3.5" style={{ color: '#ffffff' }} /> : <FileText className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                                <span className={`text-sm line-clamp-2 ${isUnread ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-primary)]'}`}>
                                  {paper.title}
                                </span>
                              </div>
                            </td>
                            {/* Tags column */}
                            <td className="px-3 py-3 overflow-hidden">
                              <div className="flex items-center gap-1 flex-wrap max-w-full">
                                {paper.tags.slice(0, 3).map((tag) => (
                                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                                    {tag}
                                  </span>
                                ))}
                                {paper.tags.length > 3 && (
                                  <span className="text-[10px] text-[var(--text-muted)]">+{paper.tags.length - 3}</span>
                                )}
                              </div>
                            </td>
                            {/* Notes column */}
                            <td className="px-3 py-3 w-20">
                              <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                                <MessageSquare className="w-3 h-3" />
                                {getNoteCountForPaper(paper.id)}
                              </span>
                            </td>
                            {/* Progress column */}
                            <td className="px-3 py-3 w-24">
                              <div className="flex items-center justify-center">
                                {(() => {
                                  const progress = paper.readingProgress || 0;
                                  const size = 16;
                                  const strokeWidth = 2;
                                  const radius = (size - strokeWidth) / 2;
                                  const circumference = 2 * Math.PI * radius;
                                  const offset = circumference - (progress / 100) * circumference;
                                  
                                  if (progress === 0) {
                                    return (
                                      <svg width={size} height={size} className="opacity-25">
                                        <circle
                                          cx={size / 2}
                                          cy={size / 2}
                                          r={radius}
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth={strokeWidth}
                                          className="text-[var(--text-muted)]"
                                        />
                                      </svg>
                                    );
                                  }
                                  
                                  if (progress === 100) {
                                    return (
                                      <svg width={size} height={size} className="-rotate-90">
                                        <circle
                                          cx={size / 2}
                                          cy={size / 2}
                                          r={radius}
                                          fill="none"
                                          stroke="#22c55e"
                                          strokeWidth={strokeWidth}
                                        />
                                      </svg>
                                    );
                                  }
                                  
                                  return (
                                    <svg width={size} height={size} className="-rotate-90">
                                      <circle
                                        cx={size / 2}
                                        cy={size / 2}
                                        r={radius}
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth={strokeWidth}
                                        className="text-[var(--border-default)]"
                                      />
                                      <circle
                                        cx={size / 2}
                                        cy={size / 2}
                                        r={radius}
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth={strokeWidth}
                                        strokeDasharray={circumference}
                                        strokeDashoffset={offset}
                                        strokeLinecap="round"
                                        className="text-[var(--accent-primary)]"
                                      />
                                    </svg>
                                  );
                                })()}
                              </div>
                            </td>
                            {/* Updated column */}
                            <td className="px-3 py-3">
                              <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{formatDate(getLastUpdatedDate(paper))}</span>
                            </td>
                            {/* Actions column - star, archive, edit, delete */}
                            <td className="px-3 py-3 pr-4">
                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={(e) => togglePaperStarred(e, paper)}
                                  className={`p-1.5 rounded transition-all ${paper.isStarred
                                    ? 'text-yellow-500'
                                    : 'text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-yellow-500'
                                    }`}
                                  title={paper.isStarred ? "Unstar" : "Star"}
                                >
                                  <Star className={`w-3.5 h-3.5 ${paper.isStarred ? 'fill-current' : ''}`} />
                                </button>
                                <button
                                  onClick={(e) => openEditModal(e, paper)}
                                  className="p-1.5 rounded text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-tertiary)] transition-all"
                                  title="Edit"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={(e) => togglePaperArchived(e, paper)}
                                  className={`p-1.5 rounded transition-all ${paper.isArchived
                                    ? 'text-[var(--accent-primary)]'
                                    : 'text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--accent-primary)]'
                                    }`}
                                  title={paper.isArchived ? "Unarchive" : "Archive"}
                                >
                                  <Archive className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={(e) => handleDelete(e, paper.id)}
                                  className="p-1.5 rounded text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 transition-all"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Upload Modal (Single File) */}
      {
        showUploadModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className={`absolute inset-0 bg-black/40 backdrop-blur-sm ${isUploadModalClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
              onClick={handleCloseUploadModal}
            />
            <div 
              className={`relative bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-5 w-full max-w-md shadow-xl ${isUploadModalClosing ? 'animate-scale-out' : 'animate-scale-in'}`}
              onAnimationEnd={handleUploadModalAnimationEnd}
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  Add Paper
                </h2>
                <button
                  onClick={handleCloseUploadModal}
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
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
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
                    value={uploadAuthors}
                    onChange={(e) => setUploadAuthors(e.target.value)}
                    placeholder="Smith, J., Johnson, A."
                    className="w-full text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    Tags
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {uploadTags.map((tag) => (
                      <span key={tag} className="tag active flex items-center gap-1">
                        {tag}
                        <button
                          onClick={() => removeUploadTag(tag)}
                          className="hover:text-[var(--accent-red)]"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2 relative">
                    <input
                      ref={uploadTagInputRef}
                      type="text"
                      value={newTagInput}
                      onChange={(e) => {
                        setNewTagInput(e.target.value);
                        setShowUploadTagSuggestions(true);
                        if (uploadTagInputRef.current) {
                          const rect = uploadTagInputRef.current.getBoundingClientRect();
                          setUploadTagSuggestionPos({ top: rect.bottom + 4, left: rect.left, width: rect.width + 44 });
                        }
                      }}
                      onFocus={() => {
                        setShowUploadTagSuggestions(true);
                        if (uploadTagInputRef.current) {
                          const rect = uploadTagInputRef.current.getBoundingClientRect();
                          setUploadTagSuggestionPos({ top: rect.bottom + 4, left: rect.left, width: rect.width + 44 });
                        }
                      }}
                      onBlur={() => {
                        // Delay to allow click on suggestion
                        setTimeout(() => setShowUploadTagSuggestions(false), 150);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addUploadTag();
                          setShowUploadTagSuggestions(false);
                        } else if (e.key === 'Escape') {
                          setShowUploadTagSuggestions(false);
                        }
                      }}
                      placeholder="Add tag..."
                      className="flex-1 text-sm"
                    />
                    <button onClick={() => { addUploadTag(); setShowUploadTagSuggestions(false); }} className="btn-secondary px-2.5">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  {/* Tag Suggestions */}
                  {showUploadTagSuggestions && (() => {
                    const filtered = allTags.filter(tag =>
                      !uploadTags.includes(tag) &&
                      (newTagInput.trim() === '' || tag.toLowerCase().includes(newTagInput.toLowerCase()))
                    ).slice(0, 8);
                    return filtered.length > 0 ? (
                      <div
                        ref={uploadTagSuggestionsRef}
                        className="fixed bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden z-[100]"
                        style={{ top: uploadTagSuggestionPos.top, left: uploadTagSuggestionPos.left, width: uploadTagSuggestionPos.width }}
                      >
                        <div className="py-1 max-h-48 overflow-y-auto">
                          {filtered.map((tag) => (
                            <button
                              key={tag}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                if (!uploadTags.includes(tag)) {
                                  setUploadTags([...uploadTags, tag]);
                                }
                                setNewTagInput('');
                                setShowUploadTagSuggestions(false);
                              }}
                              className="w-full text-left px-3.5 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>

              <div className="flex gap-2 mt-6">
                <button
                  onClick={handleCloseUploadModal}
                  className="btn-secondary flex-1 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="btn-primary flex-1 text-sm disabled:opacity-50"
                >
                  {isUploading ? 'Adding...' : 'Add Paper'}
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Multi-File Upload Progress (Google Drive style) */}
      {
        showUploadProgress && uploadQueue.length > 0 && (
          <div className="fixed bottom-6 right-6 z-50 w-80 bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden animate-slide-up">
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-default)] cursor-pointer"
              onClick={() => setIsUploadProgressMinimized(!isUploadProgressMinimized)}
            >
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-[var(--accent-primary)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {(() => {
                    const completed = uploadQueue.filter(i => i.status === 'complete').length;
                    const total = uploadQueue.length;
                    const uploading = uploadQueue.find(i => i.status === 'uploading');
                    if (uploading) {
                      return `Uploading ${completed + 1} of ${total}`;
                    }
                    if (completed === total) {
                      return `${total} upload${total > 1 ? 's' : ''} complete`;
                    }
                    return `${completed} of ${total} complete`;
                  })()}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsUploadProgressMinimized(!isUploadProgressMinimized);
                  }}
                  className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                >
                  {isUploadProgressMinimized ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearUploadQueue();
                  }}
                  className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* File List */}
            {!isUploadProgressMinimized && (
              <div className="max-h-64 overflow-y-auto">
                {uploadQueue.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border-muted)] last:border-0"
                  >
                    {/* Status Icon */}
                    <div className="flex-shrink-0">
                      {item.status === 'complete' ? (
                        <CheckCircle className="w-5 h-5 text-[var(--accent-green)]" />
                      ) : item.status === 'error' ? (
                        <AlertCircle className="w-5 h-5 text-[var(--accent-red)]" />
                      ) : (
                        <FileText className="w-5 h-5 text-[var(--text-muted)]" />
                      )}
                    </div>

                    {/* File Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate">
                        {item.file.name}
                      </p>
                      {item.status === 'uploading' && (
                        <div className="mt-1.5 h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[var(--accent-primary)] rounded-full transition-all duration-300"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      )}
                      {item.status === 'error' && (
                        <p className="text-xs text-[var(--accent-red)] mt-0.5">
                          {item.error || 'Upload failed'}
                        </p>
                      )}
                    </div>

                    {/* Size */}
                    <span className="text-xs text-[var(--text-muted)] flex-shrink-0">
                      {(item.file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      }

      {/* Selection Toolbar */}
      {
        selectedPapers.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--bg-card)] border border-[var(--border-default)] rounded-full shadow-2xl px-4 py-2.5 flex items-center gap-3 animate-slide-up">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {selectedPapers.size} selected
            </span>
            <div className="w-px h-5 bg-[var(--border-default)]" />
            <button
              onClick={selectAllPapers}
              className="text-sm text-[var(--accent-primary)] hover:underline"
            >
              Select all
            </button>
            <button
              onClick={openBatchEditModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
              style={{
                backgroundColor: '#3b82f6',
                color: '#ffffff'
              }}
            >
              <Tag className="w-3.5 h-3.5" style={{ color: '#ffffff' }} />
              <span style={{ color: '#ffffff' }}>Edit Tags</span>
            </button>
            <button
              onClick={exportCitations}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
              style={{
                backgroundColor: '#10b981',
                color: '#ffffff'
              }}
              title="Export as BibTeX"
            >
              <Download className="w-3.5 h-3.5" style={{ color: '#ffffff' }} />
              <span style={{ color: '#ffffff' }}>Export</span>
            </button>
            <button
              onClick={deleteSelectedPapers}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent-red)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
            <button
              onClick={clearSelection}
              className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )
      }

      {/* Edit Single Paper Modal */}
      {
        editingPaper && (
          <EditPaperModal
            paper={editingPaper}
            onClose={() => setEditingPaper(null)}
            onSave={handleSaveEditedPaper}
            showCitationFields={true}
          />
        )
      }

      {/* Batch Edit Tags Modal */}
      {
        showBatchEditModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className={`absolute inset-0 bg-black/40 backdrop-blur-sm ${isBatchEditModalClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
              onClick={handleCloseBatchEditModal}
            />
            <div 
              className={`relative bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-5 w-full shadow-xl transition-all ${
                aiTagPlan.length > 0 ? 'max-w-xl' : 'max-w-md'
              } ${isBatchEditModalClosing ? 'animate-scale-out' : 'animate-scale-in'}`}
              onAnimationEnd={handleBatchEditModalAnimationEnd}
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  Edit Tags for {selectedPapers.size} Paper{selectedPapers.size > 1 ? 's' : ''}
                </h2>
                <button
                  onClick={handleCloseBatchEditModal}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-5">
                {/* Add Tags */}
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">
                    Add Tags
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {batchAddTags.map((tag) => (
                      <span key={tag} className="tag active flex items-center gap-1">
                        + {tag}
                        <button
                          onClick={() => setBatchAddTags(prev => prev.filter(t => t !== tag))}
                          className="hover:text-[var(--accent-red)]"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="relative">
                    <div className="flex gap-2">
                      <input
                        ref={batchTagInputRef}
                        type="text"
                        value={batchNewTagInput}
                        onChange={(e) => {
                          setBatchNewTagInput(e.target.value);
                          setShowBatchTagSuggestions(true);
                        }}
                        onFocus={() => setShowBatchTagSuggestions(true)}
                        onBlur={() => {
                          setTimeout(() => setShowBatchTagSuggestions(false), 150);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addBatchTag();
                            setShowBatchTagSuggestions(false);
                          } else if (e.key === 'Escape') {
                            setShowBatchTagSuggestions(false);
                          }
                        }}
                        placeholder="Add new tag..."
                        className="flex-1 text-sm"
                      />
                      <button onClick={() => { addBatchTag(); setShowBatchTagSuggestions(false); }} className="btn-secondary px-2.5">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Tag Suggestions */}
                    {showBatchTagSuggestions && (() => {
                      const filtered = allTags.filter(tag =>
                        !batchAddTags.includes(tag) &&
                        (batchNewTagInput.trim() === '' || tag.toLowerCase().includes(batchNewTagInput.toLowerCase()))
                      );
                      return filtered.length > 0 ? (
                        <div
                          ref={batchTagSuggestionsRef}
                          className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden z-[100]"
                        >
                          <div className="py-1 max-h-48 overflow-y-auto">
                            {filtered.map((tag) => (
                              <button
                                key={tag}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  if (!batchAddTags.includes(tag)) {
                                    setBatchAddTags(prev => [...prev, tag]);
                                  }
                                  setBatchNewTagInput('');
                                  setShowBatchTagSuggestions(false);
                                }}
                                className="w-full text-left px-3.5 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>

                {/* AI Tag Suggestions */}
                <div className="border-t border-[var(--border-default)] pt-4">
                  <button
                    onClick={() => setShowAISuggestions(!showAISuggestions)}
                    className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    AI Tag Suggestions
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAISuggestions ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {showAISuggestions && (
                    <div className="mt-3 space-y-3">
                      {aiTagPlan.length === 0 ? (
                        <>
                          <div>
                            <label className="text-xs text-[var(--text-muted)] mb-1.5 block">
                              How should papers be grouped?
                            </label>
                            <textarea
                              value={aiSuggestionInput}
                              onChange={(e) => setAiSuggestionInput(e.target.value)}
                              placeholder="e.g., 'group by research method (qualitative, quantitative, mixed)', 'categorize by domain (healthcare, education, finance)', 'tag by paper type and main contribution'"
                              className="w-full text-sm resize-none"
                              rows={3}
                            />
                          </div>
                          <button
                            onClick={generateAITagSuggestions}
                            disabled={isLoadingAISuggestions}
                            className="btn-secondary w-full text-sm flex items-center justify-center gap-2"
                          >
                            {isLoadingAISuggestions ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Analyzing {selectedPapers.size} papers...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4" />
                                Generate Tag Plan
                              </>
                            )}
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-[var(--text-muted)]">
                            Review and edit suggested tags for each paper:
                          </p>
                          <div className="max-h-64 overflow-y-auto border border-[var(--border-default)] rounded-lg">
                            {aiTagPlan.map((item, idx) => (
                              <div 
                                key={item.paperId}
                                className={`p-3 ${idx !== aiTagPlan.length - 1 ? 'border-b border-[var(--border-default)]' : ''}`}
                              >
                                <p className="text-sm text-[var(--text-primary)] font-medium mb-2 line-clamp-1">
                                  {item.title}
                                </p>
                                {item.currentTags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mb-2">
                                    {item.currentTags.map(tag => (
                                      <span key={tag} className="tag text-[10px] opacity-50">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-1.5">
                                  {item.suggestedTags.map(tag => (
                                    <span 
                                      key={tag} 
                                      className="tag active flex items-center gap-1 text-xs"
                                    >
                                      <Sparkles className="w-2.5 h-2.5" />
                                      {tag}
                                      <button
                                        onClick={() => removeTagFromPlan(item.paperId, tag)}
                                        className="hover:text-[var(--accent-red)] ml-0.5"
                                      >
                                        <X className="w-2.5 h-2.5" />
                                      </button>
                                    </span>
                                  ))}
                                  <input
                                    type="text"
                                    placeholder="+ add"
                                    className="w-16 text-xs px-2 py-0.5 bg-transparent border border-dashed border-[var(--border-default)] rounded focus:border-[var(--accent-primary)] focus:outline-none"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        addTagToPlan(item.paperId, (e.target as HTMLInputElement).value);
                                        (e.target as HTMLInputElement).value = '';
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setAiTagPlan([])}
                              className="btn-secondary flex-1 text-sm"
                            >
                              Reset
                            </button>
                            <button
                              onClick={applyAITagPlan}
                              className="btn-primary flex-1 text-sm flex items-center justify-center gap-2"
                            >
                              <Check className="w-4 h-4" />
                              Apply Tags
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Remove Tags */}
                {selectedPapersTags.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">
                      Remove Tags (click to select)
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedPapersTags.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => toggleBatchRemoveTag(tag)}
                          className={`tag transition-all ${batchRemoveTags.includes(tag)
                            ? 'bg-[var(--accent-red)]/20 text-[var(--accent-red)] line-through'
                            : ''
                            }`}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-6">
                <button
                  onClick={handleCloseBatchEditModal}
                  className="btn-secondary flex-1 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={applyBatchEdit}
                  disabled={batchAddTags.length === 0 && batchRemoveTags.length === 0}
                  className="btn-primary flex-1 text-sm disabled:opacity-50"
                >
                  Apply Changes
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}

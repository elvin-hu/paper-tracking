import { useState, useEffect, useCallback, useRef } from 'react';
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
} from 'lucide-react';
import type { Paper, SortOption, Note } from '../types';
import { getAllPapers, addPaper, addPaperFile, deletePaper, getAllTags, updatePaper, updatePapersBatch, getSettings, updateSettings, getAllNotes } from '../lib/database';

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

export function Library() {
  const navigate = useNavigate();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('date-desc');
  const [isLoading, setIsLoading] = useState(true);
  const sortOptionSaveTimeoutRef = useRef<number | null>(null);
  
  // Filter states
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

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
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadAuthors, setUploadAuthors] = useState('');
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
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
  const [editTitle, setEditTitle] = useState('');
  const [editAuthors, setEditAuthors] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editNewTagInput, setEditNewTagInput] = useState('');
  
  // Batch edit state
  const [showBatchEditModal, setShowBatchEditModal] = useState(false);
  const [batchAddTags, setBatchAddTags] = useState<string[]>([]);
  const [batchRemoveTags, setBatchRemoveTags] = useState<string[]>([]);
  const [batchNewTagInput, setBatchNewTagInput] = useState('');
  

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('[Library] Loading papers...');
      const [loadedPapers, tags, settings, notes] = await Promise.all([
        getAllPapers(), 
        getAllTags(), 
        getSettings(),
        getAllNotes()
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
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
    if (!editingPaper) return;
    
    const updatedPaper: Paper = {
      ...editingPaper,
      title: editTitle || editingPaper.title,
      authors: editAuthors || undefined,
      tags: editTags,
    };
    
    await updatePaper(updatedPaper);
    setEditingPaper(null);
    loadData();
  };

  // Batch edit
  const openBatchEditModal = () => {
    setBatchAddTags([]);
    setBatchRemoveTags([]);
    setBatchNewTagInput('');
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
  const toggleSort = (column: 'title' | 'date') => {
    if (column === 'title') {
      setSortOption(prev => prev === 'title-asc' ? 'title-desc' : 'title-asc');
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

      return matchesSearch && matchesTags && matchesStarred && matchesUnread;
    })
    .sort((a, b) => {
      switch (sortOption) {
        case 'title-asc':
          return a.title.localeCompare(b.title);
        case 'title-desc':
          return b.title.localeCompare(a.title);
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
      <header className="glass sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-base font-semibold text-[var(--text-primary)]">
                Paper Lab
              </span>
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
                onClick={() => navigate('/settings')}
                className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
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
                    style={{ paddingLeft: '2.25rem', paddingRight: '0.75rem' }}
                  />
                </div>
              </div>

              {/* Quick Filters */}
              <div className="mb-6">
                <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">Filters</h3>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => setShowStarredOnly(!showStarredOnly)}
                    className={`text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                      showStarredOnly 
                        ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium' 
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] font-medium'
                    }`}
                  >
                    <Star className={`w-3.5 h-3.5 ${showStarredOnly ? 'fill-current' : ''}`} />
                    Starred
                  </button>
                  <button
                    onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                    className={`text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                      showUnreadOnly 
                        ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium' 
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] font-medium'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full ${showUnreadOnly ? 'bg-[var(--bg-primary)]' : 'bg-blue-500'}`} />
                    Unread
                  </button>
                </div>
              </div>

              {/* Tags Filter */}
              {allTags.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">Tags</h3>
                  <div className="flex flex-col gap-1">
                    {allTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={`text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                          selectedTags.includes(tag) 
                            ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-medium' 
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] font-medium'
                        }`}
                      >
                        {tag}
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
                }}
                className={`text-left px-3 py-1.5 text-xs text-[var(--accent-red)] hover:underline transition-opacity mb-6 ${
                  selectedTags.length > 0 || showStarredOnly || showUnreadOnly ? 'opacity-100' : 'opacity-0 pointer-events-none'
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
                    <th className="w-8"></th>
                    <th 
                      className="text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider px-4 py-3 cursor-pointer hover:text-[var(--text-primary)] transition-colors select-none" 
                      style={{ width: '40%' }}
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
                    <th className="text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider px-4 py-3" style={{ width: '20%' }}>Authors</th>
                    <th className="text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider px-4 py-3" style={{ width: '15%' }}>Tags</th>
                    <th 
                      className="text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider px-4 py-3 w-24 cursor-pointer hover:text-[var(--text-primary)] transition-colors select-none"
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
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedPapers.map((paper, index) => {
                    const isSelected = selectedPapers.has(paper.id);
                    const isUnread = !paper.isRead;
                    const totalItems = filteredAndSortedPapers.length;
                    const animationDuration = 300;
                    const maxTotalTime = 450;
                    const maxDelay = Math.max(0, maxTotalTime - animationDuration);
                    const delay = totalItems > 1 ? (maxDelay * index) / (totalItems - 1) : 0;
                    
                    return (
                      <tr
                        key={paper.id}
                        onClick={(e) => handlePaperClick(e, paper)}
                        className={`group border-b border-[var(--border-muted)] last:border-0 hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors animate-fade-in ${
                          isSelected ? 'bg-[var(--accent-primary)]/5' : ''
                        }`}
                        style={{ animationDelay: `${delay}ms` }}
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
                                {/* Outer circle with faint blue fill - only on hover (2x dot width = 4px) */}
                                <div className="absolute inset-0 w-4 h-4 rounded-full bg-blue-500/20 opacity-0 group-hover/button:opacity-100 transition-opacity" />
                                {/* Inner blue dot - always visible for unread, centered */}
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-500" />
                              </button>
                            ) : (
                              <button
                                onClick={(e) => togglePaperReadStatus(e, paper)}
                                className="relative w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center group/button"
                                title="Mark as unread"
                              >
                                {/* Outer circle with faint grey fill - only on hover (2x dot width = 4px) */}
                                <div className="absolute inset-0 w-4 h-4 rounded-full bg-[var(--text-muted)]/15 opacity-0 group-hover/button:opacity-100 transition-opacity" />
                                {/* Inner grey dot - centered */}
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[var(--text-muted)]/40 group-hover/button:bg-[var(--text-muted)]/60 transition-colors" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 overflow-hidden">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                onClick={(e) => togglePaperSelection(e, paper.id)}
                                className={`p-1 rounded transition-all ${
                                  isSelected 
                                    ? 'bg-[var(--accent-primary)] text-white' 
                                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]'
                                }`}
                              >
                                {isSelected ? <Check className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={(e) => togglePaperStarred(e, paper)}
                                className={`p-1 rounded transition-all ${
                                  paper.isStarred
                                    ? 'text-yellow-500'
                                    : 'text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-yellow-500'
                                }`}
                                title={paper.isStarred ? "Unstar" : "Star"}
                              >
                                <Star className={`w-3.5 h-3.5 ${paper.isStarred ? 'fill-current' : ''}`} />
                              </button>
                            </div>
                            <span className={`text-sm line-clamp-2 ${isUnread ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-primary)]'}`}>
                              {paper.title}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 overflow-hidden">
                          <span className="text-xs text-[var(--text-muted)] truncate block max-w-full">{paper.authors || '—'}</span>
                        </td>
                        <td className="px-4 py-3 overflow-hidden">
                          <div className="flex items-center gap-1 flex-wrap max-w-full">
                            {paper.tags.slice(0, 2).map((tag) => (
                              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                                {tag}
                              </span>
                            ))}
                            {paper.tags.length > 2 && (
                              <span className="text-[10px] text-[var(--text-muted)]">+{paper.tags.length - 2}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[var(--text-muted)]">{formatDate(getLastUpdatedDate(paper))}</span>
                            {getNoteCountForPaper(paper.id) > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px] text-[var(--text-muted)]" title={`${getNoteCountForPaper(paper.id)} notes`}>
                                <MessageSquare className="w-3 h-3" />
                                {getNoteCountForPaper(paper.id)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button
                              onClick={(e) => openEditModal(e, paper)}
                              className="p-1.5 rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-all"
                              title="Edit"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDelete(e, paper.id)}
                              className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 transition-all"
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
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowUploadModal(false)}
          />
          <div className="relative bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-5 w-full max-w-md animate-scale-in shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Add Paper
              </h2>
              <button
                onClick={() => setShowUploadModal(false)}
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
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addUploadTag())}
                    placeholder="Add tag..."
                    className="flex-1 text-sm"
                  />
                  <button onClick={addUploadTag} className="btn-secondary px-2.5">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowUploadModal(false)}
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
      )}

      {/* Multi-File Upload Progress (Google Drive style) */}
      {showUploadProgress && uploadQueue.length > 0 && (
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
      )}

      {/* Selection Toolbar */}
      {selectedPapers.size > 0 && (
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Tag className="w-3.5 h-3.5" />
            Edit Tags
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
      )}

      {/* Edit Single Paper Modal */}
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

      {/* Batch Edit Tags Modal */}
      {showBatchEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowBatchEditModal(false)}
          />
          <div className="relative bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-5 w-full max-w-md animate-scale-in shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Edit Tags for {selectedPapers.size} Paper{selectedPapers.size > 1 ? 's' : ''}
              </h2>
              <button
                onClick={() => setShowBatchEditModal(false)}
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
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={batchNewTagInput}
                    onChange={(e) => setBatchNewTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addBatchTag())}
                    placeholder="Add new tag..."
                    className="flex-1 text-sm"
                  />
                  <button onClick={addBatchTag} className="btn-secondary px-2.5">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
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
                        className={`tag transition-all ${
                          batchRemoveTags.includes(tag)
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
                onClick={() => setShowBatchEditModal(false)}
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
      )}
    </div>
  );
}

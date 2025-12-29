import { useState, useRef, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import type { Paper } from '../types';
import { updatePaper, getAllTags } from '../lib/database';

interface EditPaperModalProps {
  paper: Paper;
  onClose: () => void;
  onSave: (updatedPaper: Paper) => void;
  // For Reader view, we also handle metadata
  metadata?: {
    firstAuthor: string;
    date: string;
    venue: string;
  };
  onMetadataChange?: (field: string, value: string) => void;
  showMetadataFields?: boolean;
}

export function EditPaperModal({
  paper,
  onClose,
  onSave,
  metadata,
  onMetadataChange,
  showMetadataFields = false,
}: EditPaperModalProps) {
  const [title, setTitle] = useState(paper.title);
  const [authors, setAuthors] = useState(paper.authors || '');
  const [tags, setTags] = useState<string[]>([...paper.tags]);
  const [newTagInput, setNewTagInput] = useState('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  
  const tagInputRef = useRef<HTMLInputElement>(null);
  const tagSuggestionsRef = useRef<HTMLDivElement>(null);
  const [suggestionPosition, setSuggestionPosition] = useState({ top: 0, left: 0, width: 0 });

  // Load available tags
  useEffect(() => {
    getAllTags().then(setAvailableTags);
  }, []);

  // Close tag suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tagSuggestionsRef.current &&
        tagInputRef.current &&
        !tagSuggestionsRef.current.contains(event.target as Node) &&
        !tagInputRef.current.contains(event.target as Node)
      ) {
        setShowTagSuggestions(false);
      }
    };

    if (showTagSuggestions) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showTagSuggestions]);

  // Update suggestion position when input is focused
  const updateSuggestionPosition = () => {
    if (tagInputRef.current) {
      const rect = tagInputRef.current.getBoundingClientRect();
      setSuggestionPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width + 44, // Include the + button width
      });
    }
  };

  const addTag = (tagToAdd?: string) => {
    const tag = tagToAdd || newTagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setNewTagInput('');
      setShowTagSuggestions(false);
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleSave = async () => {
    const updatedPaper: Paper = {
      ...paper,
      title: title || paper.title,
      authors: authors || undefined,
      tags,
    };
    
    await updatePaper(updatedPaper);
    onSave(updatedPaper);
    onClose();
  };

  const filteredTags = availableTags
    .filter(tag => 
      !tags.includes(tag) && 
      (newTagInput.trim() === '' || tag.toLowerCase().includes(newTagInput.toLowerCase()))
    )
    .slice(0, 8);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl w-full max-w-md animate-scale-in shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-muted)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Edit Paper
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Paper title"
              className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
            />
          </div>

          {/* Authors (only in Library view) */}
          {!showMetadataFields && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Authors
              </label>
              <input
                type="text"
                value={authors}
                onChange={(e) => setAuthors(e.target.value)}
                placeholder="Smith, J., Johnson, A."
                className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
              />
            </div>
          )}

          {/* Metadata fields (only in Reader view) */}
          {showMetadataFields && metadata && onMetadataChange && (
            <>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  First Author
                </label>
                <input
                  type="text"
                  value={metadata.firstAuthor}
                  onChange={(e) => onMetadataChange('firstAuthor', e.target.value)}
                  placeholder="First author name"
                  className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Date
                </label>
                <input
                  type="text"
                  value={metadata.date}
                  onChange={(e) => onMetadataChange('date', e.target.value)}
                  placeholder="Publication date"
                  className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Venue
                </label>
                <input
                  type="text"
                  value={metadata.venue}
                  onChange={(e) => onMetadataChange('venue', e.target.value)}
                  placeholder="Conference, Journal, etc."
                  className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
                />
              </div>
            </>
          )}

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Tags
            </label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((tag) => (
                  <span 
                    key={tag} 
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-xs font-medium"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="hover:text-[var(--accent-red)] transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={tagInputRef}
                type="text"
                value={newTagInput}
                onChange={(e) => {
                  setNewTagInput(e.target.value);
                  setShowTagSuggestions(true);
                  updateSuggestionPosition();
                }}
                onFocus={() => {
                  setShowTagSuggestions(true);
                  updateSuggestionPosition();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  } else if (e.key === 'Escape') {
                    setShowTagSuggestions(false);
                  }
                }}
                placeholder="Add tag..."
                className="flex-1 text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
              />
              <button 
                onClick={() => addTag()} 
                className="px-3 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-[var(--border-muted)] bg-[var(--bg-secondary)]/50">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] border border-[var(--border-default)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity"
          >
            Save
          </button>
        </div>
      </div>

      {/* Tag Suggestions Popup - Fixed position, outside modal */}
      {showTagSuggestions && filteredTags.length > 0 && (
        <div
          ref={tagSuggestionsRef}
          className="fixed bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden animate-fade-in"
          style={{
            top: suggestionPosition.top,
            left: suggestionPosition.left,
            width: suggestionPosition.width,
            zIndex: 100,
          }}
        >
          <div className="py-1 max-h-48 overflow-y-auto">
            {filteredTags.map((tag) => (
              <button
                key={tag}
                onClick={() => addTag(tag)}
                className="w-full text-left px-3.5 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


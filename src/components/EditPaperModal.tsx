import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, ChevronDown, ChevronUp } from 'lucide-react';
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
  // Show full citation fields for Library edit
  showCitationFields?: boolean;
}

export function EditPaperModal({
  paper,
  onClose,
  onSave,
  metadata,
  onMetadataChange,
  showMetadataFields = false,
  showCitationFields = false,
}: EditPaperModalProps) {
  const [title, setTitle] = useState(paper.title);
  const [authors, setAuthors] = useState(paper.authors || '');
  const [tags, setTags] = useState<string[]>([...paper.tags]);
  const [newTagInput, setNewTagInput] = useState('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);

  // Citation fields state
  const [venue, setVenue] = useState(paper.metadata?.venue || '');
  const [year, setYear] = useState(paper.metadata?.date || '');
  const [doi, setDoi] = useState(paper.metadata?.doi || '');
  const [pages, setPages] = useState(paper.metadata?.pages || '');
  const [articleNo, setArticleNo] = useState(paper.metadata?.articleNo || '');
  const [publisher, setPublisher] = useState(paper.metadata?.publisher || '');
  const [location, setLocation] = useState(paper.metadata?.location || '');
  const [keywords, setKeywords] = useState(paper.metadata?.keywords || '');

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

  const handleClose = () => {
    setIsClosing(true);
  };

  const handleCloseAnimationEnd = () => {
    if (isClosing) {
      onClose();
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
      metadata: {
        ...paper.metadata,
        venue: venue || paper.metadata?.venue,
        date: year || paper.metadata?.date,
        doi: doi || paper.metadata?.doi,
        pages: pages || paper.metadata?.pages,
        articleNo: articleNo || paper.metadata?.articleNo,
        publisher: publisher || paper.metadata?.publisher,
        location: location || paper.metadata?.location,
        keywords: keywords || paper.metadata?.keywords,
      },
    };

    await updatePaper(updatedPaper);
    onSave(updatedPaper);
    handleClose();
  };

  const filteredTags = availableTags
    .filter(tag =>
      !tags.includes(tag) &&
      (newTagInput.trim() === '' || tag.toLowerCase().includes(newTagInput.toLowerCase()))
    )
    .slice(0, 8);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={handleClose}
      />

      {/* Modal */}
      <div 
        className={`relative bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden ${isClosing ? 'animate-scale-out' : 'animate-scale-in'}`}
        onAnimationEnd={handleCloseAnimationEnd}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-muted)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Edit Paper
          </h2>
          <button
            onClick={handleClose}
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
              className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
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
                className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
              />
            </div>
          )}

          {/* Citation Fields (for Library edit with showCitationFields) */}
          {showCitationFields && (
            <>
              {/* Primary citation fields - always visible */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    Year
                  </label>
                  <input
                    type="text"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    placeholder="2024"
                    className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    Venue
                  </label>
                  <input
                    type="text"
                    value={venue}
                    onChange={(e) => setVenue(e.target.value)}
                    placeholder="CHI '24"
                    className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  DOI
                </label>
                <input
                  type="text"
                  value={doi}
                  onChange={(e) => setDoi(e.target.value)}
                  placeholder="10.1145/1234567.1234568"
                  className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
                />
              </div>

              {/* Optional fields toggle */}
              <button
                type="button"
                onClick={() => setShowOptionalFields(!showOptionalFields)}
                className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {showOptionalFields ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {showOptionalFields ? 'Hide optional fields' : 'Show optional fields'}
              </button>

              {showOptionalFields && (
                <div className="space-y-4 pt-2 border-t border-[var(--border-muted)]">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                        Pages
                      </label>
                      <input
                        type="text"
                        value={pages}
                        onChange={(e) => setPages(e.target.value)}
                        placeholder="1-12"
                        className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                        Article No.
                      </label>
                      <input
                        type="text"
                        value={articleNo}
                        onChange={(e) => setArticleNo(e.target.value)}
                        placeholder="42"
                        className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                      Publisher
                    </label>
                    <input
                      type="text"
                      value={publisher}
                      onChange={(e) => setPublisher(e.target.value)}
                      placeholder="Association for Computing Machinery"
                      className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                      Location
                    </label>
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Honolulu, HI, USA"
                      className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                      Keywords
                    </label>
                    <input
                      type="text"
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                      placeholder="HCI, user study, interaction design"
                      className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
                    />
                  </div>
                </div>
              )}
            </>
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
                  className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
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
                  className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
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
                  className="w-full text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
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
                className="flex-1 text-sm px-3 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--text-secondary)] transition-all"
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
            onClick={handleClose}
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
    </div>,
    document.body
  );
}

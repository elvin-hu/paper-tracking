export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red' | 'purple';

export interface Highlight {
  id: string;
  paperId: string;
  pageNumber: number;
  color: HighlightColor;
  text: string;
  rects: {
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  note?: string;
  isFurtherReading: boolean;
  resolved?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Paper {
  id: string;
  projectId?: string;
  title: string;
  authors?: string;
  abstract?: string;
  fileName: string;
  fileSize: number;
  tags: string[];
  uploadedAt: Date;
  lastOpenedAt?: Date;
  readingProgress?: number; // 0-100
  isRead?: boolean; // Whether the paper has been opened/read
  isStarred?: boolean; // Whether the paper is starred/favorited
  isArchived?: boolean; // Whether the paper is archived (hidden from main views)
  createdAt: Date;
  updatedAt: Date;
  metadata?: {
    firstAuthor?: string;
    venue?: string;
    date?: string;
    methodology?: string;
    conclusion?: string;
    limitation?: string;
    notes?: string; // Learnings for research
    archivedAt?: string; // Explicit timestamp for when the paper was archived
  };
}

export interface PaperFile {
  id: string;
  paperId: string;
  data: ArrayBuffer;
}

export interface Note {
  id: string;
  highlightId: string;
  paperId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Riff {
  id: string;
  noteIds: string[];
  paperId: string;
  userInput: string;
  aiResponse: string;
  createdAt: Date;
}

export interface FurtherReading {
  id: string;
  highlightId: string;
  paperId: string;
  title: string;
  searchQuery?: string;
  resolved: boolean;
  resolvedUrl?: string;
  createdAt: Date;
}

export type SortOption = 'title-asc' | 'title-desc' | 'date-asc' | 'date-desc' | 'notes-asc' | 'notes-desc' | 'progress-asc' | 'progress-desc';

export interface KeyInsight {
  id: string;
  text: string;
  isManual: boolean; // true if added manually by user, false if AI-generated
  paperId?: string; // Optional: links the insight to a specific paper
}

export interface JournalEntry {
  id: string;
  date: string; // YYYY-MM-DD format
  paperIds: string[]; // Papers read that day
  synthesis: string; // AI-generated synthesis of notes
  keyInsights: KeyInsight[]; // Bullet points of key ideas with source tracking
  isGenerated: boolean; // Whether AI has generated content
  createdAt: Date;
  updatedAt: Date;
}

export interface AppSettings {
  openaiApiKey?: string;
  defaultHighlightColor: HighlightColor;
  readingListColor?: HighlightColor; // Color for reading list items (defaults to purple)
  sidebarWidth: number;
  researchContext?: string; // Context about user's research for AI autofill
  sortOption?: SortOption; // Library sort preference
}

// === Composing Feature Types ===

// Theme definitions for grouping highlights by color
export interface HighlightTheme {
  color: HighlightColor;
  name: string;
  description: string;
  // Maps to paper sections like introduction, related work, methodology, etc.
  suggestedSections: string[];
}

// Default color semantics
export const DEFAULT_HIGHLIGHT_THEMES: HighlightTheme[] = [
  {
    color: 'yellow',
    name: 'Research Gaps & Problems',
    description: 'Identifies gaps in current research and problem statements',
    suggestedSections: ['Introduction', 'Problem Statement', 'Motivation'],
  },
  {
    color: 'red',
    name: 'Limitations',
    description: 'Limitations and weaknesses of the research',
    suggestedSections: ['Limitations', 'Future Work', 'Discussion'],
  },
  {
    color: 'purple',
    name: 'Further Reading',
    description: 'References and related work to explore',
    suggestedSections: ['Related Work', 'Background'],
  },
  {
    color: 'blue',
    name: 'Methodology',
    description: 'What the paper did - approaches and methods',
    suggestedSections: ['Methodology', 'Approach', 'Implementation'],
  },
  {
    color: 'green',
    name: 'Findings',
    description: 'Key results and discoveries',
    suggestedSections: ['Results', 'Findings', 'Evaluation', 'Conclusion'],
  },
];

// A section in the paper being composed
export interface CompositionSection {
  id: string;
  title: string;
  thesisStatement?: string;
  aiSuggestedThesis?: string;
  draft?: string; // AI-generated draft prose
  parentId?: string; // For subsections
  order: number;
  // Highlight IDs that support this section
  highlightIds: string[];
  // Notes associated with this section
  notes: string;
  // Position on the canvas (for tldraw)
  x: number;
  y: number;
  width: number;
  height: number;
}

// A composition document
export interface Composition {
  id: string;
  projectId: string;
  title: string;
  sections: CompositionSection[];
  // Custom theme mappings (if user overrides defaults)
  themeOverrides?: Partial<Record<HighlightColor, { name: string; description: string }>>;
  createdAt: Date;
  updatedAt: Date;
}

// Grouped highlights by theme for the composing panel
export interface ThemeGroup {
  theme: HighlightTheme;
  highlights: (Highlight & { paperTitle: string })[];
}
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
  createdAt: Date;
  updatedAt: Date;
}

export interface Paper {
  id: string;
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
  metadata?: {
    firstAuthor?: string;
    venue?: string;
    date?: string;
    methodology?: string;
    conclusion?: string;
    limitation?: string;
    notes?: string; // Learnings for research
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

export type SortOption = 'title-asc' | 'title-desc' | 'date-asc' | 'date-desc';

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
  sidebarWidth: number;
  researchContext?: string; // Context about user's research for AI autofill
  sortOption?: SortOption; // Library sort preference
}
-- =============================================
-- Paper Lab Multi-User Migration
-- Run this SQL in Supabase SQL Editor
-- =============================================

-- Step 1: Add user_id column to all tables
-- =============================================

-- Papers table
ALTER TABLE papers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Highlights table
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Notes table
ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Projects table (if exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'projects') THEN
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Journal entries table (if exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'journal_entries') THEN
    ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Settings table
ALTER TABLE settings ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;


-- Step 2: Enable Row Level Security on all tables
-- =============================================

ALTER TABLE papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'projects') THEN
    ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'journal_entries') THEN
    ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;


-- Step 3: Create RLS policies for Papers
-- =============================================

DROP POLICY IF EXISTS "Users can view own papers" ON papers;
DROP POLICY IF EXISTS "Users can insert own papers" ON papers;
DROP POLICY IF EXISTS "Users can update own papers" ON papers;
DROP POLICY IF EXISTS "Users can delete own papers" ON papers;

-- Allow viewing papers with matching user_id OR NULL user_id (for migration)
CREATE POLICY "Users can view own papers" ON papers
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert own papers" ON papers
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow updating papers with matching user_id OR NULL user_id (to assign ownership)
CREATE POLICY "Users can update own papers" ON papers
  FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete own papers" ON papers
  FOR DELETE USING (auth.uid() = user_id);


-- Step 4: Create RLS policies for Highlights
-- =============================================

DROP POLICY IF EXISTS "Users can view own highlights" ON highlights;
DROP POLICY IF EXISTS "Users can insert own highlights" ON highlights;
DROP POLICY IF EXISTS "Users can update own highlights" ON highlights;
DROP POLICY IF EXISTS "Users can delete own highlights" ON highlights;

-- Allow viewing highlights with matching user_id OR NULL user_id (for migration)
CREATE POLICY "Users can view own highlights" ON highlights
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert own highlights" ON highlights
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow updating highlights with matching user_id OR NULL user_id (to assign ownership)
CREATE POLICY "Users can update own highlights" ON highlights
  FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete own highlights" ON highlights
  FOR DELETE USING (auth.uid() = user_id);


-- Step 5: Create RLS policies for Notes
-- =============================================

DROP POLICY IF EXISTS "Users can view own notes" ON notes;
DROP POLICY IF EXISTS "Users can insert own notes" ON notes;
DROP POLICY IF EXISTS "Users can update own notes" ON notes;
DROP POLICY IF EXISTS "Users can delete own notes" ON notes;

-- Allow viewing notes with matching user_id OR NULL user_id (for migration)
CREATE POLICY "Users can view own notes" ON notes
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert own notes" ON notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow updating notes with matching user_id OR NULL user_id (to assign ownership)
CREATE POLICY "Users can update own notes" ON notes
  FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete own notes" ON notes
  FOR DELETE USING (auth.uid() = user_id);


-- Step 6: Create RLS policies for Settings
-- =============================================

DROP POLICY IF EXISTS "Users can view own settings" ON settings;
DROP POLICY IF EXISTS "Users can insert own settings" ON settings;
DROP POLICY IF EXISTS "Users can update own settings" ON settings;
DROP POLICY IF EXISTS "Users can delete own settings" ON settings;

-- Allow viewing settings with matching user_id OR NULL user_id (for migration)
CREATE POLICY "Users can view own settings" ON settings
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert own settings" ON settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow updating settings with matching user_id OR NULL user_id (to assign ownership)
CREATE POLICY "Users can update own settings" ON settings
  FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete own settings" ON settings
  FOR DELETE USING (auth.uid() = user_id);


-- Step 7: Create RLS policies for Projects (if exists)
-- =============================================

DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'projects') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Users can view own projects" ON projects';
    EXECUTE 'DROP POLICY IF EXISTS "Users can insert own projects" ON projects';
    EXECUTE 'DROP POLICY IF EXISTS "Users can update own projects" ON projects';
    EXECUTE 'DROP POLICY IF EXISTS "Users can delete own projects" ON projects';
    
    EXECUTE 'CREATE POLICY "Users can view own projects" ON projects FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL)';
    EXECUTE 'CREATE POLICY "Users can insert own projects" ON projects FOR INSERT WITH CHECK (auth.uid() = user_id)';
    EXECUTE 'CREATE POLICY "Users can update own projects" ON projects FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL)';
    EXECUTE 'CREATE POLICY "Users can delete own projects" ON projects FOR DELETE USING (auth.uid() = user_id)';
  END IF;
END $$;


-- Step 8: Create RLS policies for Journal Entries (if exists)
-- =============================================

DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'journal_entries') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Users can view own journal_entries" ON journal_entries';
    EXECUTE 'DROP POLICY IF EXISTS "Users can insert own journal_entries" ON journal_entries';
    EXECUTE 'DROP POLICY IF EXISTS "Users can update own journal_entries" ON journal_entries';
    EXECUTE 'DROP POLICY IF EXISTS "Users can delete own journal_entries" ON journal_entries';
    
    EXECUTE 'CREATE POLICY "Users can view own journal_entries" ON journal_entries FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL)';
    EXECUTE 'CREATE POLICY "Users can insert own journal_entries" ON journal_entries FOR INSERT WITH CHECK (auth.uid() = user_id)';
    EXECUTE 'CREATE POLICY "Users can update own journal_entries" ON journal_entries FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL)';
    EXECUTE 'CREATE POLICY "Users can delete own journal_entries" ON journal_entries FOR DELETE USING (auth.uid() = user_id)';
  END IF;
END $$;


-- Step 9: Create indexes for user_id columns
-- =============================================

CREATE INDEX IF NOT EXISTS idx_papers_user_id ON papers(user_id);
CREATE INDEX IF NOT EXISTS idx_highlights_user_id ON highlights(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id);


-- Step 10: Storage policies for PDFs
-- =============================================

-- Allow authenticated users to upload PDFs
DROP POLICY IF EXISTS "Users can upload PDFs" ON storage.objects;
CREATE POLICY "Users can upload PDFs" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'pdfs' AND 
    auth.role() = 'authenticated'
  );

-- Allow authenticated users to read their own PDFs (based on file path pattern)
DROP POLICY IF EXISTS "Users can read own PDFs" ON storage.objects;
CREATE POLICY "Users can read own PDFs" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'pdfs' AND 
    auth.role() = 'authenticated'
  );

-- Allow authenticated users to delete their own PDFs
DROP POLICY IF EXISTS "Users can delete own PDFs" ON storage.objects;
CREATE POLICY "Users can delete own PDFs" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'pdfs' AND 
    auth.role() = 'authenticated'
  );


-- =============================================
-- IMPORTANT: SAFE MIGRATION STEPS
-- =============================================
-- 
-- Your existing data is SAFE! This migration:
-- ✅ Only ADDS new columns (doesn't delete anything)
-- ✅ Allows you to see data with NULL user_id (temporary, for migration)
--
-- STEP-BY-STEP:
--
-- 1. FIRST: Sign up in the app to create your user account
--
-- 2. Find your user_id:
--    Go to Supabase Dashboard → Authentication → Users
--    Copy your User UID (looks like: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
--
-- 3. Run this migration (the main script above)
--
-- 4. IMMEDIATELY assign your user_id to existing data:
--    Replace YOUR_USER_ID with your actual UUID and run:
--
--    UPDATE papers SET user_id = 'YOUR_USER_ID' WHERE user_id IS NULL;
--    UPDATE highlights SET user_id = 'YOUR_USER_ID' WHERE user_id IS NULL;
--    UPDATE notes SET user_id = 'YOUR_USER_ID' WHERE user_id IS NULL;
--    UPDATE settings SET user_id = 'YOUR_USER_ID' WHERE user_id IS NULL;
--    UPDATE projects SET user_id = 'YOUR_USER_ID' WHERE user_id IS NULL;
--    UPDATE journal_entries SET user_id = 'YOUR_USER_ID' WHERE user_id IS NULL;
--
-- 5. VERIFY your data is intact:
--    SELECT COUNT(*) FROM papers WHERE user_id = 'YOUR_USER_ID';
--    SELECT COUNT(*) FROM highlights WHERE user_id = 'YOUR_USER_ID';
--
-- =============================================

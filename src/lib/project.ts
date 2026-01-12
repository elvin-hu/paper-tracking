
import { supabase } from './supabase';

export interface Project {
    id: string;
    name: string;
    createdAt: Date;
}

// Helper to get current user ID
async function getCurrentUserId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
}

export async function getProjects(): Promise<Project[]> {
    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('[Project] Error fetching projects:', error);
        throw error;
    }

    return (data || []).map(row => ({
        id: row.id,
        name: row.name,
        createdAt: new Date(row.created_at),
    }));
}

export async function createProject(name: string): Promise<Project> {
    const userId = await getCurrentUserId();
    
    const { data, error } = await supabase
        .from('projects')
        .insert({ 
            name,
            user_id: userId,
        })
        .select()
        .single();

    if (error) {
        console.error('[Project] Error creating project:', error);
        throw error;
    }

    return {
        id: data.id,
        name: data.name,
        createdAt: new Date(data.created_at),
    };
}

export async function updateProject(id: string, name: string): Promise<void> {
    const { error } = await supabase
        .from('projects')
        .update({ name })
        .eq('id', id);

    if (error) throw error;
}

export async function deleteProject(id: string): Promise<void> {
    // Delete related data first to avoid foreign key constraint violations
    // Order matters: settings, notes, highlights, journal_entries, papers, then project
    
    // Delete settings for this project
    const { error: settingsError } = await supabase
        .from('settings')
        .delete()
        .eq('project_id', id);
    if (settingsError) {
        console.error('[Project] Error deleting project settings:', settingsError);
        // Continue anyway - settings might not exist
    }

    // Delete notes for papers in this project
    const { error: notesError } = await supabase
        .from('notes')
        .delete()
        .eq('project_id', id);
    if (notesError) {
        console.error('[Project] Error deleting project notes:', notesError);
    }

    // Delete highlights for papers in this project
    const { error: highlightsError } = await supabase
        .from('highlights')
        .delete()
        .eq('project_id', id);
    if (highlightsError) {
        console.error('[Project] Error deleting project highlights:', highlightsError);
    }

    // Delete journal entries for this project
    const { error: journalError } = await supabase
        .from('journal_entries')
        .delete()
        .eq('project_id', id);
    if (journalError) {
        console.error('[Project] Error deleting project journal entries:', journalError);
    }

    // Delete papers for this project
    const { error: papersError } = await supabase
        .from('papers')
        .delete()
        .eq('project_id', id);
    if (papersError) {
        console.error('[Project] Error deleting project papers:', papersError);
    }

    // Finally delete the project itself
    const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('[Project] Error deleting project:', error);
        throw error;
    }
}

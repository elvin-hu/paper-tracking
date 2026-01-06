
import { supabase } from './supabase';

export interface Project {
    id: string;
    name: string;
    createdAt: Date;
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
    const { data, error } = await supabase
        .from('projects')
        .insert({ name })
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
    // Check if it's the default project - prevent deletion (logic can be improved)
    // relying on DB constraints or UI to prevent deleting the last project
    const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

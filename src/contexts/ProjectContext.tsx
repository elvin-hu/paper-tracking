
import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { getProjects, createProject, updateProject, type Project } from '../lib/project';
import { setDatabaseProjectId } from '../lib/database';
import { useAuth } from './AuthContext';

interface ProjectContextType {
    projects: Project[];
    currentProject: Project | null;
    isLoading: boolean;
    createProject: (name: string) => Promise<void>;
    switchProject: (projectId: string) => void;
    updateProjectName: (projectId: string, newName: string) => Promise<void>;
    refreshProjects: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const PROJECT_ID_STORAGE_KEY = 'paper-tracking-project-id';

export function ProjectProvider({ children }: { children: ReactNode }) {
    const { user, isLoading: isAuthLoading } = useAuth();
    const [projects, setProjects] = useState<Project[]>([]);
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    
    // Track user ID to prevent unnecessary reloads on tab switch
    // (Supabase creates new user object references on session refresh)
    const lastUserIdRef = useRef<string | null>(null);

    // Load projects only when auth is ready and user is logged in
    useEffect(() => {
        if (isAuthLoading) {
            // Still loading auth, wait
            return;
        }
        if (!user) {
            // Not logged in, clear projects
            setProjects([]);
            setCurrentProject(null);
            setIsLoading(false);
            lastUserIdRef.current = null;
            return;
        }
        
        // Only load projects if user ID actually changed (not just object reference)
        if (lastUserIdRef.current === user.id) {
            // Same user, no need to reload
            return;
        }
        
        lastUserIdRef.current = user.id;
        // Auth is ready and user is logged in, load projects
        loadProjects();
    }, [user, isAuthLoading]);

    // Update database context whenever current project changes
    useEffect(() => {
        if (currentProject) {
            console.log('[ProjectContext] Setting DB project ID to:', currentProject.id);
            setDatabaseProjectId(currentProject.id);
            localStorage.setItem(PROJECT_ID_STORAGE_KEY, currentProject.id);
        } else if (!isLoading && projects.length > 0) {
            // If we finished loading but have no current project, try to restore from local storage
            const savedId = localStorage.getItem(PROJECT_ID_STORAGE_KEY);
            if (savedId) {
                const found = projects.find(p => p.id === savedId);
                if (found) {
                    setCurrentProject(found);
                    return;
                }
            }

            // Fallback: Default Project or first project
            // We assume "Default Project" exists with the zero UUID from our migration
            const defaultProject = projects.find(p => p.id === '00000000-0000-0000-0000-000000000000');
            if (defaultProject) {
                setCurrentProject(defaultProject);
            } else if (projects.length > 0) {
                setCurrentProject(projects[0]);
            }
        }
    }, [currentProject, projects, isLoading]);

    async function loadProjects() {
        try {
            setIsLoading(true);
            let data = await getProjects();
            
            // If user has no projects, create a default one
            if (data.length === 0) {
                console.log('[ProjectContext] No projects found, creating default project for new user');
                const defaultProject = await createProject('My Research');
                data = [defaultProject];
                setCurrentProject(defaultProject);
            }
            
            setProjects(data);
        } catch (error) {
            console.error('[ProjectContext] Failed to load projects:', error);
        } finally {
            setIsLoading(false);
        }
    }

    async function handleCreateProject(name: string) {
        try {
            const newProject = await createProject(name);
            await loadProjects();
            setCurrentProject(newProject);
        } catch (error) {
            console.error('[ProjectContext] Failed to create project:', error);
            throw error;
        }
    }

    async function handleUpdateProject(projectId: string, name: string) {
        try {
            await updateProject(projectId, name);
            await loadProjects();
            if (currentProject?.id === projectId) {
                setCurrentProject(prev => prev ? { ...prev, name } : null);
            }
        } catch (error) {
            console.error('[ProjectContext] Failed to update project:', error);
            throw error;
        }
    }

    function switchProject(projectId: string) {
        const project = projects.find(p => p.id === projectId);
        if (project) {
            setCurrentProject(project);
            // window.location.reload() removed to prevent flickering
        }
    }

    return (
        <ProjectContext.Provider value={{
            projects,
            currentProject,
            isLoading,
            createProject: handleCreateProject,
            switchProject,
            updateProjectName: handleUpdateProject,
            refreshProjects: loadProjects
        }}>
            {children}
        </ProjectContext.Provider>
    );
}

export function useProject() {
    const context = useContext(ProjectContext);
    if (context === undefined) {
        throw new Error('useProject must be used within a ProjectProvider');
    }
    return context;
}


import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Project, getProjects, createProject } from '../lib/project';
import { setDatabaseProjectId } from '../lib/database';

interface ProjectContextType {
    projects: Project[];
    currentProject: Project | null;
    isLoading: boolean;
    createProject: (name: string) => Promise<void>;
    switchProject: (projectId: string) => void;
    refreshProjects: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const PROJECT_ID_STORAGE_KEY = 'paper-tracking-project-id';

export function ProjectProvider({ children }: { children: ReactNode }) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Load projects on amount
    useEffect(() => {
        loadProjects();
    }, []);

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
            const data = await getProjects();
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

    function switchProject(projectId: string) {
        const project = projects.find(p => p.id === projectId);
        if (project) {
            setCurrentProject(project);
            // Force a reload of the page to ensure all components re-fetch data with new project ID
            // This is a simpler approach than refactoring every component to listen to context changes for data refetch
            // In a more complex app we might use React Query or SWR with keys including projectId
            window.location.reload();
        }
    }

    return (
        <ProjectContext.Provider value={{
            projects,
            currentProject,
            isLoading,
            createProject: handleCreateProject,
            switchProject,
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

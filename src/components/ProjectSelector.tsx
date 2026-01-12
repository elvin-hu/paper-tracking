import { useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { Check, ChevronDown, Folder, FolderPlus, Pencil } from 'lucide-react';
import { EditProjectModal } from './EditProjectModal';
import { CreateProjectModal } from './CreateProjectModal';

export function ProjectSelector() {
    const { projects, currentProject, switchProject, createProject, updateProjectName, deleteProject, isLoading } = useProject();
    const [isOpen, setIsOpen] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingProject, setEditingProject] = useState<{ id: string, name: string } | null>(null);

    const handleUpdateProject = async (id: string, name: string) => {
        await updateProjectName(id, name);
    };

    const handleDeleteProject = async (id: string) => {
        await deleteProject(id);
    };

    const handleCreateProject = async (name: string) => {
        await createProject(name);
    };

    if (isLoading) return <div className="animate-pulse h-8 w-32 bg-[var(--bg-tertiary)] rounded-lg"></div>;

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
            >
                <Folder className="w-4 h-4 text-[var(--text-muted)]" />
                <span className="max-w-[150px] truncate">
                    {currentProject?.name || 'Select Project'}
                </span>
                <ChevronDown className={`w-3 h-3 text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => {
                            setIsOpen(false);
                        }}
                    />
                    <div className="absolute top-full left-0 mt-1 w-72 bg-[var(--bg-card)] rounded-xl shadow-xl border border-[var(--border-default)] py-1.5 z-20 overflow-hidden">
                        <div className="max-h-64 overflow-y-auto space-y-0.5">
                            {projects.map(project => {
                                const isSelected = project.id === currentProject?.id;

                                return (
                                    <div
                                        key={project.id}
                                        className={`group relative flex items-center px-3 py-2 mx-1.5 rounded-lg transition-colors ${isSelected ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-secondary)]'}`}
                                    >
                                        {/* Checkmark - anchored to left */}
                                        <div className="flex-shrink-0 w-5 flex justify-center mr-2">
                                            {isSelected && (
                                                <Check className="w-4 h-4 text-[var(--accent-primary)]" />
                                            )}
                                        </div>

                                        {/* Project name */}
                                        <button
                                            onClick={() => {
                                                if (!isSelected) {
                                                    switchProject(project.id);
                                                }
                                                setIsOpen(false);
                                            }}
                                            className="flex-1 text-left min-w-0"
                                        >
                                            <span className={`truncate text-sm ${isSelected ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                                                {project.name}
                                            </span>
                                        </button>

                                        {/* Edit button - next to name, on hover */}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingProject({ id: project.id, name: project.name });
                                                setIsOpen(false);
                                            }}
                                            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md hover:bg-[var(--bg-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-1"
                                            title="Edit project"
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="border-t border-[var(--border-default)] mt-1.5 pt-1.5 mx-1.5">
                            <button
                                onClick={() => {
                                    setShowCreateModal(true);
                                    setIsOpen(false);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--accent-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                            >
                                <FolderPlus className="w-4 h-4" />
                                New Project
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Edit Project Modal */}
            <EditProjectModal
                isOpen={editingProject !== null}
                project={editingProject}
                onClose={() => setEditingProject(null)}
                onSave={handleUpdateProject}
                onDelete={handleDeleteProject}
                canDelete={projects.length > 1}
            />

            {/* Create Project Modal */}
            <CreateProjectModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreate={handleCreateProject}
            />
        </div>
    );
}

import { useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { Check, ChevronDown, Folder, FolderPlus, Pencil } from 'lucide-react';

export function ProjectSelector() {
    const { projects, currentProject, switchProject, createProject, updateProjectName, isLoading } = useProject();
    const [isOpen, setIsOpen] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [editingProject, setEditingProject] = useState<{ id: string, name: string } | null>(null);

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingProject || !editingProject.name.trim()) return;

        try {
            await updateProjectName(editingProject.id, editingProject.name.trim());
            setEditingProject(null);
        } catch (error) {
            console.error('Failed to update project:', error);
            alert('Failed to update project');
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProjectName.trim()) return;

        try {
            await createProject(newProjectName.trim());
            setNewProjectName('');
            setShowCreate(false);
            setIsOpen(false);
        } catch (error) {
            console.error('Failed to create project:', error);
            alert('Failed to create project');
        }
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
                            setShowCreate(false);
                            setEditingProject(null);
                        }}
                    />
                    <div className="absolute top-full left-0 mt-1 w-72 bg-[var(--bg-card)] rounded-xl shadow-xl border border-[var(--border-default)] py-1.5 z-20 overflow-hidden">
                        {!showCreate ? (
                            <>
                                <div className="max-h-64 overflow-y-auto space-y-0.5">
                                    {projects.map(project => {
                                        const isSelected = project.id === currentProject?.id;
                                        const isEditing = editingProject?.id === project.id;

                                        return (
                                            <div
                                                key={project.id}
                                                className={`group relative flex items-center px-3 py-2 mx-1.5 rounded-lg transition-colors ${isSelected && !isEditing ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-secondary)]'
                                                    }`}
                                            >
                                                {isEditing ? (
                                                    <form
                                                        onSubmit={handleUpdate}
                                                        className="flex-1 flex items-center gap-2"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <input
                                                            type="text"
                                                            value={editingProject.name}
                                                            onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })}
                                                            className="flex-1 px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-md text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-transparent"
                                                            autoFocus
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Escape') setEditingProject(null);
                                                            }}
                                                        />
                                                        <button
                                                            type="submit"
                                                            className="px-2 py-1 text-xs font-medium text-[var(--bg-primary)] bg-[var(--accent-primary)] rounded-md hover:opacity-90 disabled:opacity-50"
                                                            disabled={!editingProject.name.trim()}
                                                        >
                                                            Save
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setEditingProject(null)}
                                                            className="px-2 py-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </form>
                                                ) : (
                                                    <>
                                                        {/* Project name with inline edit button */}
                                                        <button
                                                            onClick={() => {
                                                                if (!isSelected) {
                                                                    switchProject(project.id);
                                                                }
                                                                setIsOpen(false);
                                                            }}
                                                            className="flex-1 flex items-center gap-2 text-left min-w-0"
                                                        >
                                                            <span className={`truncate text-sm ${isSelected ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                                                                {project.name}
                                                            </span>
                                                            {/* Edit button - appears on hover, inline with text */}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setEditingProject({ id: project.id, name: project.name });
                                                                }}
                                                                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md hover:bg-[var(--bg-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                                                title="Rename project"
                                                            >
                                                                <Pencil className="w-3 h-3" />
                                                            </button>
                                                        </button>

                                                        {/* Checkmark - anchored to right */}
                                                        <div className="flex-shrink-0 w-5 flex justify-center">
                                                            {isSelected && (
                                                                <Check className="w-4 h-4 text-[var(--accent-primary)]" />
                                                            )}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="border-t border-[var(--border-default)] mt-1.5 pt-1.5 mx-1.5">
                                    <button
                                        onClick={() => setShowCreate(true)}
                                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--accent-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                                    >
                                        <FolderPlus className="w-4 h-4" />
                                        New Project
                                    </button>
                                </div>
                            </>
                        ) : (
                            <form onSubmit={handleCreate} className="p-3">
                                <input
                                    type="text"
                                    value={newProjectName}
                                    onChange={(e) => setNewProjectName(e.target.value)}
                                    placeholder="Project Name"
                                    className="w-full px-3 py-2 text-sm bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] mb-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-transparent"
                                    autoFocus
                                />
                                <div className="flex gap-2 justify-end">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowCreate(false);
                                            setNewProjectName('');
                                        }}
                                        className="px-3 py-1.5 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={!newProjectName.trim()}
                                        className="px-3 py-1.5 text-sm font-medium text-[var(--bg-primary)] bg-[var(--accent-primary)] rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                                    >
                                        Create
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

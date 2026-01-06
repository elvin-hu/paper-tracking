
import { useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { Check, ChevronDown, Folder, FolderPlus, Edit2 } from 'lucide-react';

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

    if (isLoading) return <div className="animate-pulse h-8 w-32 bg-gray-200 rounded"></div>;

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            >
                <Folder className="w-4 h-4 text-gray-500" />
                <span className="max-w-[150px] truncate">
                    {currentProject?.name || 'Select Project'}
                </span>
                <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => {
                            setIsOpen(false);
                            setShowCreate(false);
                        }}
                    />
                    <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                        {!showCreate ? (
                            <>
                                <div className="max-h-60 overflow-y-auto">
                                    {projects.map(project => (
                                        <div key={project.id} className="group flex items-center justify-between px-4 py-2 hover:bg-gray-50">
                                            {editingProject?.id === project.id ? (
                                                <form
                                                    onSubmit={handleUpdate}
                                                    className="flex-1 flex gap-2"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <input
                                                        type="text"
                                                        value={editingProject.name}
                                                        onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })}
                                                        className="flex-1 px-2 py-0.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                        autoFocus
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Escape') setEditingProject(null);
                                                        }}
                                                    />
                                                    <button
                                                        type="submit"
                                                        className="text-xs text-blue-600 font-medium hover:text-blue-700 disabled:opacity-50"
                                                        disabled={!editingProject.name.trim()}
                                                    >
                                                        Save
                                                    </button>
                                                </form>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => {
                                                            if (project.id !== currentProject?.id) {
                                                                switchProject(project.id);
                                                            }
                                                            setIsOpen(false);
                                                        }}
                                                        className="flex-1 flex items-center text-left text-sm"
                                                    >
                                                        <span className={`truncate ${project.id === currentProject?.id ? 'font-medium text-blue-600' : 'text-gray-700'}`}>
                                                            {project.name}
                                                        </span>
                                                    </button>

                                                    <div className="flex items-center gap-1 ml-2">
                                                        {project.id === currentProject?.id && (
                                                            <Check className="w-4 h-4 text-blue-600" />
                                                        )}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEditingProject({ id: project.id, name: project.name });
                                                            }}
                                                            className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-200 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            title="Rename project"
                                                        >
                                                            <Edit2 className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <div className="border-t border-gray-100 mt-1 pt-1">
                                    <button
                                        onClick={() => setShowCreate(true)}
                                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50"
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
                                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    autoFocus
                                />
                                <div className="flex gap-2 justify-end">
                                    <button
                                        type="button"
                                        onClick={() => setShowCreate(false)}
                                        className="px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-700"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={!newProjectName.trim()}
                                        className="px-2 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
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

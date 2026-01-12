import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, AlertTriangle } from 'lucide-react';

interface EditProjectModalProps {
    isOpen: boolean;
    project: { id: string; name: string } | null;
    onClose: () => void;
    onSave: (id: string, name: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    canDelete: boolean; // False if this is the only project
}

export function EditProjectModal({ isOpen, project, onClose, onSave, onDelete, canDelete }: EditProjectModalProps) {
    const [name, setName] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (project) {
            setName(project.name);
            setShowDeleteConfirm(false);
        }
    }, [project]);

    const handleSave = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!project || !name.trim() || isSaving) return;

        setIsSaving(true);
        try {
            await onSave(project.id, name.trim());
            onClose();
        } catch (error) {
            console.error('Failed to update project:', error);
            alert('Failed to update project');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!project || isDeleting) return;

        setIsDeleting(true);
        try {
            await onDelete(project.id);
            setShowDeleteConfirm(false);
            onClose();
        } catch (error) {
            console.error('Failed to delete project:', error);
            alert('Failed to delete project. Please try again.');
        } finally {
            setIsDeleting(false);
        }
    };

    if (!isOpen || !project) return null;

    // Delete Confirmation Modal
    const deleteConfirmModal = showDeleteConfirm && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
                onClick={() => setShowDeleteConfirm(false)}
            />

            {/* Modal */}
            <div className="relative bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border-default)] w-full max-w-sm mx-4 animate-scale-in overflow-hidden">
                {/* Header with warning icon */}
                <div className="flex items-center gap-3 px-6 py-5 bg-[var(--accent-red)]/10 border-b border-[var(--accent-red)]/20">
                    <div className="p-2 bg-[var(--accent-red)]/20 rounded-full">
                        <AlertTriangle className="w-5 h-5 text-[var(--accent-red)]" />
                    </div>
                    <h2 className="text-lg font-semibold text-[var(--text-primary)]">Delete Project</h2>
                </div>

                {/* Content */}
                <div className="p-6">
                    <p className="text-sm text-[var(--text-primary)] mb-2">
                        Are you sure you want to delete <strong>"{project.name}"</strong>?
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                        This will permanently delete all papers, highlights, notes, and settings in this project. This action cannot be undone.
                    </p>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]/50">
                    <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className="px-4 py-2 text-sm font-medium text-white bg-[var(--accent-red)] rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                        {isDeleting ? 'Deleting...' : 'Delete Project'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );

    // Edit Modal
    const editModal = createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border-default)] w-full max-w-md mx-4 animate-scale-in">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
                    <h2 className="text-lg font-semibold text-[var(--text-primary)]">Edit Project</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <form onSubmit={handleSave} className="p-6">
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                        Project Name
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-4 py-3 text-sm bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-transparent transition-shadow"
                        placeholder="Enter project name"
                        autoFocus
                    />

                    {/* Delete Button */}
                    {canDelete && (
                        <div className="mt-6 pt-6 border-t border-[var(--border-default)]">
                            <button
                                type="button"
                                onClick={() => setShowDeleteConfirm(true)}
                                className="flex items-center gap-2 text-sm text-[var(--accent-red)] hover:text-[var(--accent-red)]/80 transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                                Delete Project
                            </button>
                        </div>
                    )}

                    {!canDelete && (
                        <p className="mt-4 text-xs text-[var(--text-muted)]">
                            This is your only project and cannot be deleted.
                        </p>
                    )}
                </form>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]/50 rounded-b-2xl">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!name.trim() || isSaving}
                        className="px-4 py-2 text-sm font-medium text-[var(--bg-primary)] bg-[var(--accent-primary)] rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                        {isSaving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );

    return (
        <>
            {editModal}
            {deleteConfirmModal}
        </>
    );
}

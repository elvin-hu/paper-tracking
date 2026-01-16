import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, FolderPlus } from 'lucide-react';

interface CreateProjectModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (name: string) => Promise<void>;
}

export function CreateProjectModal({ isOpen, onClose, onCreate }: CreateProjectModalProps) {
    const [name, setName] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [isClosing, setIsClosing] = useState(false);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setName('');
            setIsClosing(false);
            setIsCreating(false);
        }
    }, [isOpen]);

    const handleClose = () => {
        setIsClosing(true);
    };

    const handleCloseAnimationEnd = () => {
        if (isClosing) {
            setIsClosing(false);
            onClose();
        }
    };

    const handleCreate = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!name.trim() || isCreating) return;

        setIsCreating(true);
        try {
            // onCreate is expected to close the modal via onClose callback
            // Don't call handleClose() here - parent handles closing before async completes
            await onCreate(name.trim());
        } catch (error) {
            console.error('Failed to create project:', error);
            alert('Failed to create project');
            setIsCreating(false);
        }
        // Note: Don't reset isCreating on success - component will unmount
    };

    if (!isOpen) return null;

    const modalContent = (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className={`absolute inset-0 bg-black/50 backdrop-blur-sm ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
                onClick={handleClose}
            />

            {/* Modal */}
            <div 
                className={`relative bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border-default)] w-full max-w-md mx-4 ${isClosing ? 'animate-scale-out' : 'animate-scale-in'}`}
                onAnimationEnd={handleCloseAnimationEnd}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-[var(--accent-primary)]/10 rounded-full">
                            <FolderPlus className="w-5 h-5 text-[var(--accent-primary)]" />
                        </div>
                        <h2 className="text-lg font-semibold text-[var(--text-primary)]">New Project</h2>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <form onSubmit={handleCreate} className="p-6">
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
                    <p className="mt-3 text-xs text-[var(--text-muted)]">
                        Create a new project to organize your papers, highlights, and notes separately.
                    </p>
                </form>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]/50 rounded-b-2xl">
                    <button
                        type="button"
                        onClick={handleClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!name.trim() || isCreating}
                        className="px-4 py-2 text-sm font-medium text-[var(--bg-primary)] bg-[var(--accent-primary)] rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                        {isCreating ? 'Creating...' : 'Create Project'}
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}

import { createContext, useContext, useState, type ReactNode } from 'react';

interface FeatureFlags {
    composingEnabled: boolean;
}

interface FeatureFlagContextType {
    flags: FeatureFlags;
    setFlag: (flag: keyof FeatureFlags, value: boolean) => void;
}

const defaultFlags: FeatureFlags = {
    // Composing feature is disabled by default
    // Enable by setting localStorage: localStorage.setItem('ff_composing', 'true')
    composingEnabled: typeof window !== 'undefined' && localStorage.getItem('ff_composing') === 'true',
};

const FeatureFlagContext = createContext<FeatureFlagContextType | undefined>(undefined);

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
    const [flags, setFlags] = useState<FeatureFlags>(defaultFlags);

    const setFlag = (flag: keyof FeatureFlags, value: boolean) => {
        setFlags(prev => ({ ...prev, [flag]: value }));
        // Persist to localStorage
        localStorage.setItem(`ff_${flag.replace(/([A-Z])/g, '_$1').toLowerCase()}`, value.toString());
    };

    return (
        <FeatureFlagContext.Provider value={{ flags, setFlag }}>
            {children}
        </FeatureFlagContext.Provider>
    );
}

export function useFeatureFlags() {
    const context = useContext(FeatureFlagContext);
    if (context === undefined) {
        throw new Error('useFeatureFlags must be used within a FeatureFlagProvider');
    }
    return context;
}

// Helper hook for specific flags
export function useComposingEnabled() {
    const { flags } = useFeatureFlags();
    return flags.composingEnabled;
}

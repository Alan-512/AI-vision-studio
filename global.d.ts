// Global type declarations for the Lumina Studio project

interface AIStudioAPI {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
}

declare global {
    interface Window {
        aistudio?: AIStudioAPI;
    }
}

export { };

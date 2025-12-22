/**
 * Lightweight Agent Service
 * 
 * Provides:
 * 1. Multi-step workflow (search → analyze → generate)
 * 2. State machine (explicit phase management)
 * 3. Retry/rollback (automatic failure recovery)
 * 4. HITL pause (human-in-the-loop confirmation points)
 */

// ==================== Types ====================

export type AgentPhase =
    | 'IDLE'              // Waiting for user input
    | 'UNDERSTANDING'     // Analyzing user request
    | 'CLARIFYING'        // Asking clarifying questions
    | 'PLANNING'          // Creating execution plan
    | 'AWAITING_CONFIRMATION' // HITL: Waiting for user approval
    | 'EXECUTING'         // Running tool/action
    | 'RETRYING'          // Retrying failed action
    | 'COMPLETED'         // Successfully finished
    | 'ERROR';            // Unrecoverable error

export type ActionType =
    | 'SEARCH'            // Web search
    | 'ANALYZE'           // Content analysis
    | 'GENERATE_IMAGE'    // Image generation
    | 'GENERATE_VIDEO'    // Video generation
    | 'EDIT_IMAGE';       // Image editing

export interface PendingAction {
    type: ActionType;
    params: Record<string, any>;
    description: string;           // Human-readable description
    requiresConfirmation: boolean; // HITL flag
    estimatedDuration?: number;    // Seconds
}

export interface AgentContext {
    userIntent: string;           // Parsed user intent
    referenceImages: string[];    // Base64 images from user
    conversationHistory: string[]; // Key points from conversation
    searchResults?: any[];        // Results from web search
    planSteps?: PendingAction[];  // Multi-step execution plan
    currentStepIndex: number;     // Current step in plan
    generatedAssets: string[];    // IDs of generated assets
}

export interface AgentState {
    phase: AgentPhase;
    context: AgentContext;
    pendingAction?: PendingAction;
    retryCount: number;
    maxRetries: number;
    error?: string;
    lastUpdated: number;
}

export interface AgentEvent {
    type: 'USER_MESSAGE' | 'USER_CONFIRM' | 'USER_REJECT' | 'USER_MODIFY' |
    'ACTION_SUCCESS' | 'ACTION_FAILURE' | 'CANCEL';
    payload?: any;
}

// ==================== Initial State ====================

export const createInitialAgentState = (): AgentState => ({
    phase: 'IDLE',
    context: {
        userIntent: '',
        referenceImages: [],
        conversationHistory: [],
        currentStepIndex: 0,
        generatedAssets: []
    },
    retryCount: 0,
    maxRetries: 3,
    lastUpdated: Date.now()
});

// ==================== State Machine ====================

export class AgentStateMachine {
    private state: AgentState;
    private onStateChange?: (state: AgentState) => void;
    private onRequestConfirmation?: (action: PendingAction) => Promise<'confirm' | 'reject' | 'modify'>;
    private onExecuteAction?: (action: PendingAction) => Promise<any>;

    constructor(
        initialState?: AgentState,
        callbacks?: {
            onStateChange?: (state: AgentState) => void;
            onRequestConfirmation?: (action: PendingAction) => Promise<'confirm' | 'reject' | 'modify'>;
            onExecuteAction?: (action: PendingAction) => Promise<any>;
        }
    ) {
        this.state = initialState || createInitialAgentState();
        this.onStateChange = callbacks?.onStateChange;
        this.onRequestConfirmation = callbacks?.onRequestConfirmation;
        this.onExecuteAction = callbacks?.onExecuteAction;
    }

    getState(): AgentState {
        return { ...this.state };
    }

    private updateState(updates: Partial<AgentState>) {
        this.state = {
            ...this.state,
            ...updates,
            lastUpdated: Date.now()
        };
        this.onStateChange?.(this.state);
    }

    private updateContext(updates: Partial<AgentContext>) {
        this.updateState({
            context: { ...this.state.context, ...updates }
        });
    }

    /**
     * Transition to a new phase with validation
     */
    private transitionTo(phase: AgentPhase, extras?: Partial<AgentState>) {
        const validTransitions: Record<AgentPhase, AgentPhase[]> = {
            'IDLE': ['UNDERSTANDING', 'AWAITING_CONFIRMATION', 'EXECUTING'], // Allow direct tool calls from chat
            'UNDERSTANDING': ['CLARIFYING', 'PLANNING', 'EXECUTING', 'ERROR'],
            'CLARIFYING': ['UNDERSTANDING', 'PLANNING', 'IDLE'],
            'PLANNING': ['AWAITING_CONFIRMATION', 'EXECUTING', 'ERROR'],
            'AWAITING_CONFIRMATION': ['EXECUTING', 'PLANNING', 'IDLE'],
            'EXECUTING': ['COMPLETED', 'RETRYING', 'ERROR', 'AWAITING_CONFIRMATION'],
            'RETRYING': ['EXECUTING', 'ERROR'],
            'COMPLETED': ['IDLE', 'PLANNING', 'EXECUTING'], // Allow new actions after completion
            'ERROR': ['IDLE']
        };

        // Allow self-transition (no-op)
        if (this.state.phase === phase) {
            return true;
        }

        if (!validTransitions[this.state.phase]?.includes(phase)) {
            console.warn(`Invalid transition: ${this.state.phase} → ${phase}`);
            return false;
        }

        this.updateState({ phase, ...extras });
        return true;
    }

    /**
     * Process an event and advance the state machine
     */
    async processEvent(event: AgentEvent): Promise<AgentState> {
        switch (event.type) {
            case 'USER_MESSAGE':
                return this.handleUserMessage(event.payload);

            case 'USER_CONFIRM':
                return this.handleUserConfirm();

            case 'USER_REJECT':
                return this.handleUserReject();

            case 'USER_MODIFY':
                return this.handleUserModify(event.payload);

            case 'ACTION_SUCCESS':
                return this.handleActionSuccess(event.payload);

            case 'ACTION_FAILURE':
                return this.handleActionFailure(event.payload);

            case 'CANCEL':
                return this.handleCancel();

            default:
                return this.state;
        }
    }

    private async handleUserMessage(message: { text: string; images?: string[] }): Promise<AgentState> {
        // Reset for new conversation
        if (this.state.phase === 'IDLE' || this.state.phase === 'COMPLETED' || this.state.phase === 'ERROR') {
            this.updateState({
                ...createInitialAgentState(),
                phase: 'UNDERSTANDING'
            });
        }

        // Store user input
        this.updateContext({
            userIntent: message.text,
            referenceImages: message.images || [],
            conversationHistory: [
                ...this.state.context.conversationHistory,
                `User: ${message.text}`
            ]
        });

        return this.state;
    }

    private async handleUserConfirm(): Promise<AgentState> {
        if (this.state.phase !== 'AWAITING_CONFIRMATION') {
            return this.state;
        }

        this.transitionTo('EXECUTING');

        // Execute the pending action
        if (this.state.pendingAction && this.onExecuteAction) {
            try {
                const result = await this.executeWithRetry(this.state.pendingAction);
                return this.handleActionSuccess(result);
            } catch (error: any) {
                return this.handleActionFailure(error);
            }
        }

        return this.state;
    }

    private async handleUserReject(): Promise<AgentState> {
        if (this.state.phase !== 'AWAITING_CONFIRMATION') {
            return this.state;
        }

        // Clear pending action and go back to planning
        this.updateState({ pendingAction: undefined });
        this.transitionTo('IDLE');

        return this.state;
    }

    private async handleUserModify(modifications: any): Promise<AgentState> {
        if (this.state.phase !== 'AWAITING_CONFIRMATION' || !this.state.pendingAction) {
            return this.state;
        }

        // Update the pending action with modifications
        const modifiedAction: PendingAction = {
            ...this.state.pendingAction,
            params: { ...this.state.pendingAction.params, ...modifications }
        };

        this.updateState({ pendingAction: modifiedAction });

        // Re-request confirmation with modified action
        return this.state;
    }

    private async handleActionSuccess(result: any): Promise<AgentState> {
        // Store result
        if (result?.assetId) {
            this.updateContext({
                generatedAssets: [...this.state.context.generatedAssets, result.assetId]
            });
        }

        // Check if more steps in plan
        const { planSteps, currentStepIndex } = this.state.context;
        if (planSteps && currentStepIndex < planSteps.length - 1) {
            // Move to next step
            this.updateContext({ currentStepIndex: currentStepIndex + 1 });
            const nextAction = planSteps[currentStepIndex + 1];

            if (nextAction.requiresConfirmation) {
                this.updateState({ pendingAction: nextAction, retryCount: 0 });
                this.transitionTo('AWAITING_CONFIRMATION');
            } else {
                this.updateState({ pendingAction: nextAction, retryCount: 0 });
                this.transitionTo('EXECUTING');
                // Continue execution...
            }
        } else {
            // All steps completed
            this.updateState({ pendingAction: undefined, retryCount: 0 });
            this.transitionTo('COMPLETED');
        }

        return this.state;
    }

    /**
     * Handle action failure - ONLY called after all retries are exhausted
     * Note: Retry logic is handled by executeWithRetry(), not here.
     * This method is for final failure handling only.
     */
    private async handleActionFailure(error: any): Promise<AgentState> {
        const errorMessage = error?.message || String(error);

        // All retries have been exhausted by executeWithRetry - transition to ERROR
        this.updateState({
            error: `Generation failed: ${errorMessage}`,
            pendingAction: undefined,
            retryCount: 0
        });
        this.transitionTo('ERROR');

        return this.state;
    }

    private handleCancel(): AgentState {
        this.updateState({
            ...createInitialAgentState(),
            error: 'Cancelled by user'
        });
        return this.state;
    }

    /**
     * Execute an action with automatic retry
     */
    private async executeWithRetry(action: PendingAction): Promise<any> {
        if (!this.onExecuteAction) {
            throw new Error('No action executor configured');
        }

        let lastError: any;
        this.updateState({ retryCount: 0 });

        for (let attempt = 0; attempt <= this.state.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    this.transitionTo('EXECUTING');
                }
                return await this.onExecuteAction(action);
            } catch (error) {
                lastError = error;

                if (attempt < this.state.maxRetries) {
                    this.updateState({ retryCount: attempt + 1 });
                    this.transitionTo('RETRYING');
                    // Exponential backoff
                    await this.delay(Math.pow(2, attempt) * 1000);
                }
            }
        }

        throw lastError;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Set a pending action that requires confirmation (HITL)
     * If requiresConfirmation is false, execute immediately
     */
    async setPendingAction(action: PendingAction) {
        this.updateState({ pendingAction: action });

        if (action.requiresConfirmation) {
            this.transitionTo('AWAITING_CONFIRMATION');
        } else {
            // Execute immediately without waiting for USER_CONFIRM
            this.transitionTo('EXECUTING');
            if (this.onExecuteAction) {
                try {
                    console.log('[Agent] Auto-executing action (no confirmation required)');
                    const result = await this.executeWithRetry(action);
                    this.handleActionSuccess(result);
                } catch (error: any) {
                    this.handleActionFailure(error);
                }
            }
        }
    }

    /**
     * Set a multi-step execution plan
     */
    setPlan(steps: PendingAction[]) {
        this.updateContext({
            planSteps: steps,
            currentStepIndex: 0
        });

        if (steps.length > 0) {
            this.setPendingAction(steps[0]);
        }
    }

    /**
     * Request clarification from user
     */
    requestClarification(question: string) {
        this.updateContext({
            conversationHistory: [
                ...this.state.context.conversationHistory,
                `Agent: ${question}`
            ]
        });
        this.transitionTo('CLARIFYING');
    }

    /**
     * Reset to initial state
     */
    reset() {
        this.state = createInitialAgentState();
        this.onStateChange?.(this.state);
    }
}

// ==================== Helper Functions ====================

/**
 * Determine if an action requires HITL confirmation
 * 
 * Design decision: Multi-image generation does NOT require confirmation because
 * the user has already expressed their intent when specifying `numberOfImages`.
 * Only expensive/irreversible operations like video generation need confirmation.
 */
export const shouldRequireConfirmation = (action: PendingAction): boolean => {
    // Video generation is expensive, always confirm
    if (action.type === 'GENERATE_VIDEO') {
        return true;
    }

    // Confirm if explicitly marked
    return action.requiresConfirmation;
};

/**
 * Create a generation action
 */
export const createGenerateAction = (
    params: Record<string, any>,
    description: string,
    requiresConfirmation = false
): PendingAction => ({
    type: 'GENERATE_IMAGE',
    params,
    description,
    requiresConfirmation: requiresConfirmation || shouldRequireConfirmation({
        type: 'GENERATE_IMAGE',
        params,
        description,
        requiresConfirmation
    })
});

/**
 * Create a search action
 */
export const createSearchAction = (
    query: string,
    description: string
): PendingAction => ({
    type: 'SEARCH',
    params: { query },
    description,
    requiresConfirmation: false
});

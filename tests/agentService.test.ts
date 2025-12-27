import { describe, it, expect, vi } from 'vitest';
import {
    AgentStateMachine,
    createInitialAgentState,
    createGenerateAction,
    createSearchAction,
    shouldRequireConfirmation
} from '../services/agentService';

describe('AgentService', () => {

    describe('createInitialAgentState', () => {
        it('should create a valid initial state', () => {
            const state = createInitialAgentState();

            expect(state.phase).toBe('IDLE');
            expect(state.retryCount).toBe(0);
            expect(state.maxRetries).toBe(3);
            expect(state.context.userIntent).toBe('');
            expect(state.context.referenceImages).toEqual([]);
            expect(state.context.generatedAssets).toEqual([]);
        });
    });

    describe('createGenerateAction', () => {
        it('should create a generate image action', () => {
            const action = createGenerateAction(
                { prompt: 'A cat', model: 'flash' },
                'Generate a cat image'
            );

            expect(action.type).toBe('GENERATE_IMAGE');
            expect(action.params.prompt).toBe('A cat');
            expect(action.description).toBe('Generate a cat image');
        });

        it('should respect requiresConfirmation override', () => {
            const action = createGenerateAction(
                { prompt: 'test' },
                'test action',
                true
            );

            expect(action.requiresConfirmation).toBe(true);
        });
    });

    describe('createSearchAction', () => {
        it('should create a search action', () => {
            const action = createSearchAction('cats', 'Search for cats');

            expect(action.type).toBe('SEARCH');
            expect(action.params.query).toBe('cats');
            expect(action.requiresConfirmation).toBe(false);
        });
    });

    describe('shouldRequireConfirmation', () => {
        it('should require confirmation for video generation', () => {
            const action = {
                type: 'GENERATE_VIDEO' as const,
                params: {},
                description: 'Generate video',
                requiresConfirmation: false
            };

            expect(shouldRequireConfirmation(action)).toBe(true);
        });

        it('should not require confirmation for image generation', () => {
            const action = {
                type: 'GENERATE_IMAGE' as const,
                params: {},
                description: 'Generate image',
                requiresConfirmation: false
            };

            expect(shouldRequireConfirmation(action)).toBe(false);
        });
    });

    describe('AgentStateMachine', () => {
        it('should initialize with default state', () => {
            const machine = new AgentStateMachine();
            const state = machine.getState();

            expect(state.phase).toBe('IDLE');
        });

        it('should initialize with custom state', () => {
            const customState = {
                ...createInitialAgentState(),
                phase: 'PLANNING' as const
            };
            const machine = new AgentStateMachine(customState);
            const state = machine.getState();

            expect(state.phase).toBe('PLANNING');
        });

        it('should handle USER_MESSAGE event', async () => {
            const onStateChange = vi.fn();
            const machine = new AgentStateMachine(undefined, { onStateChange });

            await machine.processEvent({
                type: 'USER_MESSAGE',
                payload: { text: 'Generate a cat', images: [] }
            });

            const state = machine.getState();
            expect(state.phase).toBe('UNDERSTANDING');
            expect(state.context.userIntent).toBe('Generate a cat');
            expect(onStateChange).toHaveBeenCalled();
        });

        it('should handle CANCEL event', () => {
            const machine = new AgentStateMachine();
            machine.processEvent({ type: 'CANCEL' });

            const state = machine.getState();
            expect(state.phase).toBe('IDLE');
            expect(state.error).toBe('Cancelled by user');
        });

        it('should reset to initial state', () => {
            const machine = new AgentStateMachine({
                ...createInitialAgentState(),
                phase: 'EXECUTING'
            });

            machine.reset();
            const state = machine.getState();

            expect(state.phase).toBe('IDLE');
        });
    });
});

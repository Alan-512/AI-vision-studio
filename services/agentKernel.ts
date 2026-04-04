import type { AgentAction, JobTransitionResult } from '../types';
import type {
  CancelJobCommand,
  ExecuteToolCallsCommand,
  KernelCommand,
  KernelTransitionEvent,
  KernelTransitionResult,
  ResolveRequiresActionCommand,
  ResumeJobCommand,
  StartGenerationCommand,
  SubmitUserTurnCommand,
  TurnRuntimeState
} from './agentKernelTypes';
import { createToolboxRuntime } from './toolboxRuntime';
import {
  attachTurnActiveJob,
  completeTurnRuntimeState,
  createTurnRuntimeState,
  failTurnRuntimeState,
  planTurnToolCalls
} from './turnRuntimeState';

type PlannerResponse =
  | {
      type: 'final_response';
      text: string;
    }
  | {
      type: 'tool_calls';
      toolCalls: AgentAction[];
    };

type PlannerContext = {
  turn: TurnRuntimeState;
  normalizedToolResults?: unknown[];
};

type Planner = (context: PlannerContext) => Promise<PlannerResponse>;
type JobCommandHandler<TCommand> = (command: TCommand) => Promise<JobTransitionResult>;
type StartGenerationHandler = (command: StartGenerationCommand) => Promise<unknown[]>;
type ExecuteToolCallsHandler = (command: ExecuteToolCallsCommand) => Promise<unknown[]>;
type SubmitUserTurnHandler = (command: SubmitUserTurnCommand) => Promise<unknown>;

type AgentKernelTool = {
  name: string;
  toolClass: 'interactive_tool' | 'job_tool' | 'kernel_step';
  execute: (args: unknown) => Promise<{
    status: 'success' | 'error' | 'requires_action';
    content?: Record<string, unknown>;
    jobTransition?: Record<string, unknown>;
    error?: string;
  }>;
  permissionPolicy?: 'allow' | 'deny';
  denyReason?: string;
};

const createEvent = (
  type: KernelTransitionEvent['type'],
  turnId: string,
  payload?: Record<string, unknown>
): KernelTransitionEvent => ({
  type,
  turnId,
  timestamp: Date.now(),
  payload
});

export const createAgentKernel = ({
  planner,
  tools = [],
  resolveRequiresAction,
  cancelJob,
  resumeJob,
  startGeneration,
  executeToolCalls,
  submitUserTurnCommand
}: {
  planner: Planner;
  tools?: AgentKernelTool[];
  resolveRequiresAction?: JobCommandHandler<ResolveRequiresActionCommand>;
  cancelJob?: JobCommandHandler<CancelJobCommand>;
  resumeJob?: JobCommandHandler<ResumeJobCommand>;
  startGeneration?: StartGenerationHandler;
  executeToolCalls?: ExecuteToolCallsHandler;
  submitUserTurnCommand?: SubmitUserTurnHandler;
}) => {
  const toolbox = createToolboxRuntime({ tools });

  const wrapJobCommand = async ({
    type,
    turnId,
    handler,
    command
  }: {
    type: KernelTransitionEvent['type'];
    turnId: string;
    handler?: (command: any) => Promise<JobTransitionResult>;
    command: KernelCommand;
  }): Promise<KernelTransitionResult> => {
    if (!handler) {
      throw new Error(`No kernel handler configured for command ${command.type}`);
    }

    const jobTransition = await handler(command);
    return {
      turn: createTurnRuntimeState({
        turnId,
        sessionId: `kernel:${command.type}`,
        userMessage: command.type
      }),
      events: [
        createEvent(type, turnId, {
          jobId: jobTransition.job.id
        })
      ],
      jobTransition
    };
  };

  return {
    async dispatchCommand(command: KernelCommand): Promise<KernelTransitionResult> {
      const turnId = `kernel:${command.type}:${'jobId' in command ? command.jobId : crypto.randomUUID()}`;

      switch (command.type) {
        case 'SubmitUserTurn':
          if (!submitUserTurnCommand) {
            throw new Error(`No kernel handler configured for command ${command.type}`);
          }

          return {
            turn: command.turn,
            events: [
              createEvent('TurnStarted', command.turn.id),
              createEvent('TurnCompleted', command.turn.id)
            ],
            turnOutput: await submitUserTurnCommand(command)
          };
        case 'ResolveRequiresAction':
          return wrapJobCommand({
            type: 'JobTransitioned',
            turnId,
            handler: resolveRequiresAction,
            command
          });
        case 'CancelJob':
          return wrapJobCommand({
            type: 'JobTransitioned',
            turnId,
            handler: cancelJob,
            command
          });
        case 'ResumeJob':
          return wrapJobCommand({
            type: 'JobTransitioned',
            turnId,
            handler: resumeJob,
            command
          });
        case 'StartGeneration':
          if (!startGeneration) {
            throw new Error(`No kernel handler configured for command ${command.type}`);
          }

          return {
            turn: completeTurnRuntimeState(createTurnRuntimeState({
              turnId,
              sessionId: 'kernel:StartGeneration',
              userMessage: 'StartGeneration'
            }), {
              assistantText: 'StartGeneration'
            }),
            events: [
              createEvent('TurnStarted', turnId),
              createEvent('TurnCompleted', turnId)
            ],
            toolResults: await startGeneration(command)
          };
        case 'ExecuteToolCalls':
          if (!executeToolCalls) {
            throw new Error(`No kernel handler configured for command ${command.type}`);
          }

          return {
            turn: completeTurnRuntimeState(createTurnRuntimeState({
              turnId,
              sessionId: 'kernel:ExecuteToolCalls',
              userMessage: 'ExecuteToolCalls'
            }), {
              assistantText: 'ExecuteToolCalls'
            }),
            events: [
              createEvent('TurnStarted', turnId),
              createEvent('TurnCompleted', turnId)
            ],
            toolResults: await executeToolCalls(command)
          };
        default:
          throw new Error(`dispatchCommand does not handle ${command.type}`);
      }
    },

    async submitUserTurn({
      turnId,
      sessionId,
      userMessage
    }: {
      turnId: string;
      sessionId: string;
      userMessage: string;
    }): Promise<KernelTransitionResult> {
      const events: KernelTransitionEvent[] = [];
      let turn = createTurnRuntimeState({
        turnId,
        sessionId,
        userMessage
      });
      events.push(createEvent('TurnStarted', turn.id));

      const initialPlan = await planner({ turn });
      if (initialPlan.type === 'final_response') {
        turn = completeTurnRuntimeState(turn, {
          assistantText: initialPlan.text
        });
        events.push(createEvent('TurnCompleted', turn.id));
        return {
          turn,
          events
        };
      }

      turn = planTurnToolCalls(turn, {
        toolCalls: initialPlan.toolCalls
      });
      events.push(createEvent('ToolCallsPlanned', turn.id, {
        toolCount: initialPlan.toolCalls.length
      }));

      const toolExecution = await toolbox.executeToolCalls({
        turn,
        toolCalls: initialPlan.toolCalls
      });

      const jobResult = toolExecution.normalizedResults.find(result => result.toolClass === 'job_tool');
      if (jobResult?.jobTransition && typeof jobResult.jobTransition.jobId === 'string') {
        turn = attachTurnActiveJob(turn, {
          jobId: jobResult.jobTransition.jobId
        });
        events.push(createEvent('JobTransitioned', turn.id, {
          jobId: jobResult.jobTransition.jobId
        }));
        return {
          turn,
          events,
          jobTransition: {
            job: {
              id: jobResult.jobTransition.jobId,
              projectId: '',
              type: 'IMAGE_GENERATION',
              status: 'queued',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              source: 'chat',
              steps: [],
              artifacts: []
            },
            events: [],
            toolResult: undefined
          }
        };
      }

      const failedResult = toolExecution.normalizedResults.find(result => result.status === 'error');
      if (failedResult) {
        turn = failTurnRuntimeState(turn, {
          error: failedResult.error || 'Tool execution failed',
          errorType: failedResult.errorType === 'permission_denied' ? 'permission_denied' : 'tool_error'
        });
        events.push(createEvent('TurnFailed', turn.id, {
          error: failedResult.error
        }));
        return {
          turn,
          events
        };
      }

      const reinjectedPlan = await planner({
        turn,
        normalizedToolResults: toolExecution.normalizedResults
      });
      events.push(createEvent('ToolResultsReinjected', turn.id, {
        resultCount: toolExecution.normalizedResults.length
      }));

      if (reinjectedPlan.type === 'final_response') {
        turn = completeTurnRuntimeState(turn, {
          assistantText: reinjectedPlan.text
        });
        events.push(createEvent('TurnCompleted', turn.id));
        return {
          turn,
          events
        };
      }

      turn = failTurnRuntimeState(turn, {
        error: 'Planner returned unexpected follow-up tool calls for the minimal kernel path',
        errorType: 'protocol_error'
      });
      events.push(createEvent('TurnFailed', turn.id));
      return {
        turn,
        events
      };
    }
  };
};

export type StartGenerationBindings = {
  launchControllerInput: Record<string, unknown>;
  requestInput: Record<string, unknown>;
};

const bindingRegistry = new Map<string, StartGenerationBindings>();

export const registerStartGenerationBindings = (key: string, bindings: StartGenerationBindings) => {
  bindingRegistry.set(key, bindings);
};

export const getStartGenerationBindings = (key: string) => bindingRegistry.get(key);

export const clearStartGenerationBindings = (key: string) => {
  bindingRegistry.delete(key);
};

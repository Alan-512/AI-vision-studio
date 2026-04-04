export const launchAppGenerationTasks = async <T>({
  count,
  createLaunchInput,
  launchPreparedTask
}: {
  count: number;
  createLaunchInput: (index: number) => any;
  launchPreparedTask: (input: any) => Promise<T>;
}): Promise<T[]> => {
  const tasksToLaunch: Promise<T>[] = [];

  for (let i = 0; i < count; i++) {
    tasksToLaunch.push(launchPreparedTask(createLaunchInput(i)));
  }

  return Promise.all(tasksToLaunch);
};

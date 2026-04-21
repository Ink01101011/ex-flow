import { ExFlow, type ExNode } from "./index";

type TaskData = { name: string };

const diamondData: ExNode<TaskData>[] = [
  { id: "A", dependsOn: [], data: { name: "Task A" }, priority: 2 },
  { id: "B", dependsOn: ["A"], data: { name: "Task B" }, priority: 1 },
  { id: "C", dependsOn: ["A"], data: { name: "Task C" }, priority: 3 },
  { id: "D", dependsOn: ["B", "C"], data: { name: "Task D" }, priority: 2 },
  { id: "E", dependsOn: ["D"], data: { name: "Task E" }, priority: 1 },
];

const circularData: ExNode<TaskData>[] = [
  { id: "X", dependsOn: ["Z"], data: { name: "Task X" }, priority: 1 },
  { id: "Y", dependsOn: ["X"], data: { name: "Task Y" }, priority: 2 },
  { id: "Z", dependsOn: ["Y"], data: { name: "Task Z" }, priority: 3 },
];

const runCase = (label: string, data: ExNode<TaskData>[]): void => {
  const exFlow = new ExFlow<TaskData>();

  data.forEach((item) => exFlow.addEntity(item));

  try {
    const plan = exFlow.resolveExecutionPlan();
    console.log(`${label} Execution Plan:`, plan);
  } catch (error) {
    console.error(`${label} Error:`, error instanceof Error ? error.message : error);
  }
};

runCase("Diamond", diamondData);
runCase("Circular", circularData);

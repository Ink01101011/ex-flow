import type { ExNode } from "./node";

type InvalidTask = { name: string; exFlowPriority: number };

// @ts-expect-error ExNode rejects user data with reserved exFlowPriority.
type _InvalidNode = ExNode<InvalidTask>;

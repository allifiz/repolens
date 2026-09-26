export type NodeKind =
  | 'file'
  | 'controller'
  | 'service'
  | 'module'
  | 'provider'
  | 'class'
  | 'method'
  | 'endpoint'
  | 'database';

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  file: string;
  line?: number;
  metadata?: Record<string, string | number | boolean | string[]>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type:
    | 'imports'
    | 'injects'
    | 'declares'
    | 'handled_by'
    | 'calls'
    | 'queries';
}

export interface EndpointTraceStep {
  className: string;
  method: string;
  file: string;
  line: number;
}

export interface DatabaseUsage {
  kind: 'prisma' | 'raw_sql';
  target: string;
  file: string;
  line: number;
}

export interface Endpoint {
  id: string;
  nodeId: string;
  method: string;
  path: string;
  controller: string;
  handler: string;
  file: string;
  line: number;
  callChain: EndpointTraceStep[];
  database: DatabaseUsage[];
}

export interface ScanResult {
  project: string;
  rootDir: string;
  generatedAt: string;
  filesScanned: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  endpoints: Endpoint[];
}

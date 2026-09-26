export type NodeKind =
  | 'file'
  | 'controller'
  | 'service'
  | 'module'
  | 'provider'
  | 'class'
  | 'method'
  | 'endpoint'
  | 'database'
  | 'dto'
  | 'guard'
  | 'interceptor'
  | 'external';

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
    | 'queries'
    | 'uses_dto'
    | 'guarded_by'
    | 'intercepted_by'
    | 'calls_external';
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

export interface RequestBinding {
  source: 'body' | 'query' | 'param' | 'headers' | 'request' | 'response' | 'unknown';
  name?: string;
  type?: string;
}

export interface ExternalCall {
  client: string;
  method: string;
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
  request: RequestBinding[];
  guards: string[];
  interceptors: string[];
  responseType?: string;
  callChain: EndpointTraceStep[];
  database: DatabaseUsage[];
  externalCalls: ExternalCall[];
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

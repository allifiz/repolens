export type NodeKind =
  | 'file'
  | 'controller'
  | 'service'
  | 'module'
  | 'provider'
  | 'class';

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  file: string;
  line?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'imports' | 'injects' | 'declares';
}

export interface Endpoint {
  id: string;
  method: string;
  path: string;
  controller: string;
  handler: string;
  file: string;
  line: number;
}

export interface ScanResult {
  project: string;
  generatedAt: string;
  filesScanned: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  endpoints: Endpoint[];
}

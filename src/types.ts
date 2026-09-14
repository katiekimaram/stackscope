export type Evidence = { sourceId: string; source: string; locator: string; excerpt: string };
export type InventoryRecord = { kind: 'hardware' | 'software' | 'system'; category: string; label: string; value: string; evidence: Evidence };
export type Process = { name: string; path: string; publisher: string; version: string; pid?: string; cpuPercent?: number; sampleSeconds?: number; memoryMB?: number | null; measuredAt?: string; evidence: Evidence };
export type Finding = { id: string; code: string; title: string; severity: 'high' | 'medium' | 'low' | 'info'; confidence: string; explanation: string; nextStep: string; occurrences: number; evidence: Evidence[] };
export type Report = { id: string; name: string; format: string; records: InventoryRecord[]; processes: Process[]; findings: Finding[]; warnings: string[]; lineCount: number };
export type Source = { id: string; name: string; text: string; bytes: number; report: Report };
export type ServiceRequest = { path: string; method?: string; body?: unknown; token?: string };
declare global {
  interface Window {
    stackscope?: {
      platform: string;
      deviceIdentity: () => Promise<string>;
      request: (request: ServiceRequest) => Promise<{ status: number; data: any }>;
    };
  }
}

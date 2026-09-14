export type Evidence = { sourceId: string; source: string; locator: string; excerpt: string };
export type InventoryRecord = { kind: 'hardware' | 'software' | 'system'; category: string; label: string; value: string; evidence: Evidence };
export type Process = { name: string; path: string; publisher: string; version: string; pid?: string; cpuPercent?: number; sampleSeconds?: number; memoryMB?: number | null; measuredAt?: string; evidence: Evidence };
export type Finding = { id: string; code: string; title: string; severity: 'high' | 'medium' | 'low' | 'info'; confidence: string; explanation: string; nextStep: string; occurrences: number; evidence: Evidence[] };
export type Report = { id: string; name: string; format: string; records: InventoryRecord[]; processes: Process[]; findings: Finding[]; warnings: string[]; lineCount: number };
export type Source = { id: string; name: string; file: File; bytes: number; report: Report };
export type ServiceRequest = { path: string; method?: string; body?: unknown; token?: string };
declare global {
  interface Window {
    stackscope?: {
      platform: string;
      preferences: () => Promise<{ trayEnabled: boolean }>;
      setTray: (enabled: boolean) => Promise<{ trayEnabled: boolean }>;
      collect: (options: CollectionOptions) => Promise<{ files: { name: string; bytes: number; url: string }[]; warnings: string[] }>;
      cancelCollection: () => Promise<void>;
      releaseCollection: () => Promise<void>;
      onDesktopEvent: (callback: (event: { type: string; message?: string }) => void) => () => void;
      deviceIdentity: () => Promise<string>;
      request: (request: ServiceRequest) => Promise<{ status: number; data: any }>;
    };
  }
}

export type CollectionOptions = { performance: boolean; events: boolean; servicing: boolean; fullReports: boolean };

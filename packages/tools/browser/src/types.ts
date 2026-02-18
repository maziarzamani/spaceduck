// Browser tool type definitions

export interface BrowserToolOptions {
  headless?: boolean;
  maxResultChars?: number;
  defaultTimeout?: number;
}

export interface SnapshotNode {
  ref: number;
  role: string;
  name: string;
  tag?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  children?: SnapshotNode[];
}

export interface WaitOptions {
  selector?: string;
  url?: string;
  state?: "load" | "domcontentloaded" | "networkidle";
  jsCondition?: string;
  timeMs?: number;
  timeout?: number;
}

export interface RefEntry {
  role: string;
  name: string;
}

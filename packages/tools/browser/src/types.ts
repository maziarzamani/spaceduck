// Browser tool type definitions

export interface BrowserToolOptions {
  headless?: boolean;
  maxResultChars?: number;
  defaultTimeout?: number;
}

export interface ScreencastOptions {
  format?: "jpeg" | "png";
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ScreencastFrame {
  base64: string;
  format: "jpeg" | "png";
  url: string;
}

export type ScreencastFrameCallback = (frame: ScreencastFrame) => void;

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

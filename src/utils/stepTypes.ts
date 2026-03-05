export interface StepWorkerMesh {
  name: string;
  color?: unknown;
  position: Float32Array | null;
  normal: Float32Array | null;
  index: Uint32Array | null;
}

export interface StepWorkerResult {
  success: boolean;
  preview: boolean;
  meshes: StepWorkerMesh[];
}

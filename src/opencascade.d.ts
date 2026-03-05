declare module 'opencascade.js' {
  interface OpenCascadeInstance {
    FS: {
      writeFile: (path: string, data: Uint8Array) => void;
      readFile: (path: string) => Uint8Array;
      unlink: (path: string) => void;
    };
    ReadStepFile: (filename: string) => any;
    ToThreeJsGeometry: (shape: any) => any;
  }

  export default function (): Promise<OpenCascadeInstance>;
}

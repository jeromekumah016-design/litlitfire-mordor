// Set NODE_ENV for test environment
if (typeof process !== 'undefined') {
  process.env.NODE_ENV = 'test';
}

// Configure pdfjs for test environment - must be done before any tests
if (typeof global !== 'undefined') {
  try {
    const pdfjsLib = require('pdfjs-dist');
    const version = pdfjsLib.version || '4.0.379';
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.js`;
    console.log('[vitest] pdfjs worker configured:', pdfjsLib.GlobalWorkerOptions.workerSrc);
  } catch (e) {
    console.error('[vitest] Failed to configure pdfjs:', e);
  }
}

// Mock DOM globals for pdfjs in Node environment
if (typeof global !== 'undefined' && !global.DOMMatrix) {
  (global as any).DOMMatrix = class DOMMatrix {
    constructor(public values: number[] = [1, 0, 0, 1, 0, 0]) {}
    get a() { return this.values[0]; }
    get b() { return this.values[1]; }
    get c() { return this.values[2]; }
    get d() { return this.values[3]; }
    get e() { return this.values[4]; }
    get f() { return this.values[5]; }
  };
}

if (typeof global !== 'undefined' && !global.DOMPoint) {
  (global as any).DOMPoint = class DOMPoint {
    constructor(
      public x: number = 0,
      public y: number = 0,
      public z: number = 0,
      public w: number = 1
    ) {}
  };
}

if (typeof global !== 'undefined' && !global.DOMRect) {
  (global as any).DOMRect = class DOMRect {
    constructor(
      public x: number = 0,
      public y: number = 0,
      public width: number = 0,
      public height: number = 0
    ) {
      this.top = y;
      this.left = x;
      this.bottom = y + height;
      this.right = x + width;
    }
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
}

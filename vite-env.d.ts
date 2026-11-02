/// <reference types="vite/client" />

declare module '*.svg' {
  import type { ComponentType, SVGProps } from 'react';
  export const ReactComponent: ComponentType<SVGProps<SVGSVGElement>>;
  const src: string;
  export default src;
}

declare module '@config' {
  const config: Record<string, unknown>;
  export default config;
}

declare module '*.yml' {
  const content: Record<string, unknown>;
  export default content;
}

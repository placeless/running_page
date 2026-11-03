import type { ComponentType, SVGProps } from 'react';

type SvgComponentType = ComponentType<SVGProps<SVGSVGElement>>;
type SvgComponent = {
  default: SvgComponentType;
};

const FailedLoadSvg: SvgComponentType = () => null;

export const loadSvgComponent = async (
  stats: Record<string, () => Promise<unknown>>,
  path: string
): Promise<SvgComponent> => {
  // Generated personal SVGs are intentionally absent from public builds.
  if (!stats[path]) return { default: FailedLoadSvg };
  try {
    const module = await stats[path]();
    return { default: module as SvgComponentType };
  } catch (error) {
    console.error(error);
    return { default: FailedLoadSvg };
  }
};

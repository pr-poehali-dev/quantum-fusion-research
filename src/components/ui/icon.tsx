import React, { Suspense, lazy, useMemo } from 'react';
import { LucideProps } from 'lucide-react';
import dynamicIconImports from 'lucide-react/dynamicIconImports';

interface IconProps extends LucideProps {
  name: string;
  fallback?: string;
}

// PascalCase/camelCase -> kebab-case (имя файла иконки в lucide):
// "ArrowRight" -> "arrow-right", "CircleAlert" -> "circle-alert"
const toKebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();

// Кэш уже созданных ленивых компонентов, чтобы не пересоздавать их на каждый рендер
const cache: Record<string, React.LazyExoticComponent<React.FC<LucideProps>>> = {};

const getLazyIcon = (rawName: string, fallback: string) => {
  const key = toKebab(rawName);
  if (cache[key]) return cache[key];

  const importer =
    (dynamicIconImports as Record<string, () => Promise<{ default: React.FC<LucideProps> }>>)[key] ||
    (dynamicIconImports as Record<string, () => Promise<{ default: React.FC<LucideProps> }>>)[toKebab(fallback)] ||
    (dynamicIconImports as Record<string, () => Promise<{ default: React.FC<LucideProps> }>>)['circle-alert'];

  cache[key] = lazy(importer);
  return cache[key];
};

const Icon: React.FC<IconProps> = ({ name, fallback = 'CircleAlert', size = 24, ...props }) => {
  const LazyIcon = useMemo(() => getLazyIcon(name, fallback), [name, fallback]);
  // Плейсхолдер ровно того же размера — чтобы не было сдвигов макета (CLS), пока иконка грузится
  const box = typeof size === 'number' ? size : 24;

  return (
    <Suspense fallback={<span style={{ display: 'inline-block', width: box, height: box }} />}>
      <LazyIcon size={size} {...props} />
    </Suspense>
  );
};

export default Icon;

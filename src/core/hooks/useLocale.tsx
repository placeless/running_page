import { createContext, use, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { messages, type Locale } from '../i18n';
import { DEFAULT_LOCALE } from '../config';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'zh',
  setLocale: () => {},
  t: (key) => key,
});

export const isLocale = (value: unknown): value is Locale =>
  value === 'zh' || value === 'en';

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    try {
      const stored = localStorage.getItem('locale');
      return isLocale(stored) ? stored : DEFAULT_LOCALE;
    } catch {
      return DEFAULT_LOCALE;
    }
  });

  const updateLocale = useCallback((l: Locale) => {
    if (!isLocale(l)) return;
    setLocale(l);
    try {
      localStorage.setItem('locale', l);
    } catch {
      // Storage may be blocked; the visible locale still updates.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const t = useCallback(
    (key: string) => {
      return messages[locale][key] || key;
    },
    [locale]
  );

  return (
    <LocaleContext value={{ locale, setLocale: updateLocale, t }}>
      {children}
    </LocaleContext>
  );
}

export function useLocale() {
  return use(LocaleContext);
}

export type ThemePreference =
  | 'system'
  | 'light'
  | 'dark'
  | 'sepia'
  | 'solarized'
  | 'mint'
  | 'rose';

export type ThemeAppearance = 'light' | 'dark';

export type TextStylePreference = 'compact' | 'standard' | 'comfortable' | 'large';

export interface AppearanceConfig {
  theme_preference: ThemePreference;
  text_style: TextStylePreference;
}

export const DEFAULT_APPEARANCE_CONFIG: AppearanceConfig = {
  theme_preference: 'system',
  text_style: 'standard',
};

export function normalizeThemePreference(value?: string): ThemePreference {
  if (
    value === 'system' ||
    value === 'light' ||
    value === 'dark' ||
    value === 'sepia' ||
    value === 'solarized' ||
    value === 'mint' ||
    value === 'rose'
  ) {
    return value;
  }
  return DEFAULT_APPEARANCE_CONFIG.theme_preference;
}

export function normalizeTextStylePreference(value?: string): TextStylePreference {
  if (
    value === 'compact' ||
    value === 'standard' ||
    value === 'comfortable' ||
    value === 'large'
  ) {
    return value;
  }
  return DEFAULT_APPEARANCE_CONFIG.text_style;
}

export function resolveThemeAppearance(
  theme: ThemePreference,
  prefersDark: boolean,
): ThemeAppearance {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  if (theme === 'dark') return 'dark';
  return 'light';
}

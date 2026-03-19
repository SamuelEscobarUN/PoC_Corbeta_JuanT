import { describe, it, expect } from 'vitest';
import theme, { palette } from './theme';

describe('Theme', () => {
  it('has the correct primary color', () => {
    expect(theme.palette.primary.main).toBe('#001689');
  });

  it('has the correct secondary (cyan) color', () => {
    expect(theme.palette.secondary.main).toBe('#2ed9c3');
  });

  it('has the correct primary light (blue) color', () => {
    expect(theme.palette.primary.light).toBe('#0055b8');
  });

  it('exports the full palette', () => {
    expect(palette.base).toBe('#001689');
    expect(palette.cyan).toBe('#2ed9c3');
    expect(palette.blue).toBe('#0055b8');
    expect(palette.magenta).toBe('rgb(253, 74, 92)');
  });
});

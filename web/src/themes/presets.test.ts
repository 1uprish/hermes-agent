import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES } from "./presets";

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const pair = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (pair[0] + 0.05) / (pair[1] + 0.05);
}

describe("Cream light surfaces", () => {
  it("keeps body, primary actions and terminal text readable on their backgrounds", () => {
    const theme = BUILTIN_THEMES.cream;
    expect(theme, "Cream must resolve as a selectable built-in").toBeDefined();
    expect(luminance(theme.palette.background.hex)).toBeGreaterThan(0.8);
    for (const [background, foreground] of [
      [theme.palette.background.hex, theme.palette.midground.hex],
      [theme.colorOverrides!.primary!, theme.colorOverrides!.primaryForeground!],
      [theme.colorOverrides!.muted!, theme.colorOverrides!.mutedForeground!],
      [theme.terminalBackground!, theme.terminalForeground!],
    ]) {
      expect(contrast(background, foreground)).toBeGreaterThanOrEqual(4.5);
    }
    expect(theme.typography.fontDisplay).toBe(theme.typography.fontSans);
    expect(theme.typography.fontSans).toContain("sans-serif");
  });
});

import { parseBlocks } from '../ocrParser';
import { TextBlock } from '../types';

const makeBlock = (text: string, y: number = 100, height: number = 20): TextBlock => ({
  text,
  width: 200,
  height,
  x: 50,
  y,
});

describe('parseBlocks', () => {
  it('returns null for empty blocks', () => {
    expect(parseBlocks([], 1920)).toBeNull();
  });

  it('returns null when no fare found', () => {
    const blocks = [
      makeBlock('uber'),
      makeBlock('some random text'),
    ];
    expect(parseBlocks(blocks, 1920)).toBeNull();
  });

  it('returns null when no distance found', () => {
    const blocks = [
      makeBlock('uber'),
      makeBlock('Total 15.50'),
    ];
    expect(parseBlocks(blocks, 1920)).toBeNull();
  });

  it('parses a valid Uber ride offer', () => {
    const blocks = [
      makeBlock('uber', 50, 30),
      makeBlock('Estimated fare', 200, 15),
      makeBlock('15.50', 250, 40),
      makeBlock('8.2 km', 400, 15),
      makeBlock('15 min', 450, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('UBER');
    expect(result!.fare).toBe(15.50);
    expect(result!.distanceKm).toBe(8.2);
    expect(result!.durationMin).toBe(15);
  });

  it('parses a Bolt ride offer', () => {
    const blocks = [
      makeBlock('bolt', 50, 30),
      makeBlock('Gain estimé', 200, 15),
      makeBlock('12.00', 250, 40),
      makeBlock('5.5 km', 400, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('BOLT');
    expect(result!.fare).toBe(12.00);
    expect(result!.distanceKm).toBe(5.5);
  });

  it('parses a Heetch ride offer', () => {
    const blocks = [
      makeBlock('heetch', 50, 30),
      makeBlock('Course', 200, 15),
      makeBlock('9.75', 250, 40),
      makeBlock('3.8 km', 400, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('HEETCH');
    expect(result!.fare).toBe(9.75);
  });

  it('returns UNKNOWN platform when no keywords match', () => {
    const blocks = [
      makeBlock('Total', 200, 15),
      makeBlock('10.00', 250, 40),
      makeBlock('4.0 km', 400, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('UNKNOWN');
  });

  it('rejects insane fare/distance ratios', () => {
    const blocks = [
      makeBlock('uber', 50),
      makeBlock('Total 200.00', 200, 40),
      makeBlock('0.5 km', 400, 15),
    ];
    // 200€ / 0.5km = 400 €/km — way too high
    expect(parseBlocks(blocks, 1920)).toBeNull();
  });

  it('rejects fares below minimum', () => {
    const blocks = [
      makeBlock('uber', 50),
      makeBlock('Total 1.00', 200, 40),
      makeBlock('2.0 km', 400, 15),
    ];
    expect(parseBlocks(blocks, 1920)).toBeNull();
  });

  it('extracts addresses when present', () => {
    const blocks = [
      makeBlock('uber', 50),
      makeBlock('Total 15.50', 200, 40),
      makeBlock('8.2 km', 300, 15),
      makeBlock('12 rue de Rivoli', 600, 15),
      makeBlock('45 avenue des Champs-Élysées', 700, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.pickupAddress).toContain('Rivoli');
    expect(result!.destinationAddress).toContain('Champs');
  });

  it('handles comma decimal format', () => {
    const blocks = [
      makeBlock('bolt', 50),
      makeBlock('Gain 14,50', 200, 40),
      makeBlock('6,3 km', 400, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.fare).toBe(14.50);
    expect(result!.distanceKm).toBe(6.3);
  });

  // ─── Additional edge cases ─────────────────────────────────────────────

  it('returns null for durationMin when no "min" block found', () => {
    const blocks = [
      makeBlock('uber', 50),
      makeBlock('Total 15.50', 200, 40),
      makeBlock('8.2 km', 400, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.durationMin).toBeNull();
  });

  it('prefers larger text blocks as fare (visual importance)', () => {
    const blocks = [
      makeBlock('uber', 50),
      makeBlock('5.00', 200, 10),   // small text — probably not the fare
      makeBlock('25.00', 300, 50),  // big text — likely the fare
      makeBlock('10.0 km', 400, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.fare).toBe(25.00);
  });

  it('uses anchor keyword in preceding block for scoring', () => {
    const blocks = [
      makeBlock('uber', 50),
      makeBlock('Estimated fare', 200, 15),
      makeBlock('18.50', 250, 20),
      makeBlock('8.50', 350, 20),   // similar size but no anchor
      makeBlock('7.0 km', 400, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.fare).toBe(18.50);
  });

  it('rejects distances above max', () => {
    const blocks = [
      makeBlock('uber', 50),
      makeBlock('Total 50.00', 200, 40),
      makeBlock('200.0 km', 400, 15),
    ];
    expect(parseBlocks(blocks, 1920)).toBeNull();
  });

  it('rejects distances below min', () => {
    const blocks = [
      makeBlock('uber', 50),
      makeBlock('Total 5.00', 200, 40),
      makeBlock('0.1 km', 400, 15),
    ];
    expect(parseBlocks(blocks, 1920)).toBeNull();
  });

  it('parses duration correctly from "25 min" format', () => {
    const blocks = [
      makeBlock('uber', 50),
      makeBlock('Total 20.00', 200, 40),
      makeBlock('10.0 km', 300, 15),
      makeBlock('25 min', 400, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result!.durationMin).toBe(25);
  });

  it('rejects duration above 180 minutes', () => {
    const blocks = [
      makeBlock('uber', 50),
      makeBlock('Total 20.00', 200, 40),
      makeBlock('10.0 km', 300, 15),
      makeBlock('200 min', 400, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.durationMin).toBeNull();
  });

  it('ignores addresses in the top 25% of the screen', () => {
    const blocks = [
      makeBlock('uber', 50),
      makeBlock('Total 15.50', 200, 40),
      makeBlock('8.2 km', 300, 15),
      makeBlock('12 rue de Rivoli', 100, 15),  // y=100 → top 5% of 1920px screen
      makeBlock('45 avenue des Champs-Élysées', 700, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    // The Rivoli address is at y=100, which is < 25% of 1920 (480)
    // So it should be filtered out; only Champs-Élysées remains
    expect(result!.pickupAddress).toContain('Champs');
    expect(result!.destinationAddress).toBeUndefined();
  });

  it('handles mixed case platform names', () => {
    const blocks = [
      makeBlock('UBER Trip', 50),
      makeBlock('Total 15.50', 200, 40),
      makeBlock('8.2 km', 400, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    // "UBER" lowercased contains "uber" → should detect
    expect(result!.platform).toBe('UBER');
  });

  it('handles fare right at the boundary values', () => {
    // Exactly at FARE_MIN (3.00) with valid ratio
    const blocks = [
      makeBlock('bolt', 50),
      makeBlock('Gain 3.00', 200, 40),
      makeBlock('2.0 km', 400, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.fare).toBe(3.00);
  });
});

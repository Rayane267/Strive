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
      makeBlock('1500.0 km', 400, 15),
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

  it('picks course distance over pickup distance (UberX FR layout)', () => {
    // Reproduces the real-world Uber screen: pickup "à 6 min (1.2 km)" appears
    // before "Course de 11.8 km" in reading order. The parser must not pick 1.2.
    const blocks = [
      makeBlock('uberx', 300, 30),
      makeBlock('17,18 €', 400, 50),
      makeBlock('Montant net de frais', 500, 15),
      makeBlock('à 6 min (1.2 km)', 600, 15),     // pickup combo — exclude
      makeBlock('65 Route de la Libération', 650, 15),
      makeBlock('Course de 11.8 km', 700, 15),    // course — pick this one
      makeBlock('16 Rue Charles Pathé', 750, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('UBER');
    expect(result!.fare).toBe(17.18);
    expect(result!.distanceKm).toBe(11.8);
    expect(result!.pickupDistanceKm).toBe(1.2);
    expect(result!.pickupDurationMin).toBe(6);
  });

  it('does not pick pickup duration as course duration', () => {
    // "à 6 min (1.2 km)" block contains "6 min" but it's the pickup ETA, not
    // the course duration. Course duration is not visible → must return null.
    const blocks = [
      makeBlock('uberx', 300, 30),
      makeBlock('17,18 €', 400, 50),
      makeBlock('à 6 min (1.2 km)', 600, 15),
      makeBlock('Course de 11.8 km', 700, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.durationMin).toBeNull();
  });

  // ─── Regex tolérance & anti-stats ──────────────────────────────────────

  it('tolerates internal spaces in distance (ML Kit split: "11 . 8 km")', () => {
    const blocks = [
      makeBlock('uber', 50, 30),
      makeBlock('17,18 €', 200, 40),
      makeBlock('65 Route de la Libération', 650, 15),
      makeBlock('Course de 11 . 8 km', 700, 15),
      makeBlock('16 Rue Charles Pathé', 750, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.distanceKm).toBe(11.8);
  });

  it('tolerates internal spaces in price ("17 , 18 €")', () => {
    const blocks = [
      makeBlock('uber', 50, 30),
      makeBlock('17 , 18 €', 200, 40),
      makeBlock('8.2 km', 400, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.fare).toBe(17.18);
  });

  it('never treats a "Course de X km" line as an address', () => {
    const blocks = [
      makeBlock('uber', 50, 30),
      makeBlock('17,18 €', 200, 40),
      makeBlock('65 Route de la Libération', 650, 15),
      makeBlock('Course de 11.8 km', 700, 15),      // ← must NOT be pickup/dest
      makeBlock('16 Rue Charles Pathé', 800, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.pickupAddress).toContain('Libération');
    expect(result!.destinationAddress).toContain('Charles Pathé');
  });

  it('recognizes airport / gare POIs as valid addresses', () => {
    const blocks = [
      makeBlock('uber', 50, 30),
      makeBlock('42,00 €', 200, 40),
      makeBlock('Aéroport Charles de Gaulle Terminal 2', 600, 15),
      makeBlock('Gare de Lyon Paris', 700, 15),
      makeBlock('35.0 km', 800, 15),
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.pickupAddress).toContain('Aéroport');
    expect(result!.destinationAddress).toContain('Gare');
  });

  // ─── Défense fragmentation ML Kit (bloc "Course de 11." + "8 km") ──────

  it('restitches a fragmented decimal distance ("Course de 11." + "8 km")', () => {
    // Cas réel Uber : ML Kit coupe "Course de 11.8 km" en deux blocs côte à côte.
    // Le premier finit par "11." (x≈50..250), le second démarre plus à droite
    // avec juste "8 km" (x≈280..380). Le parser doit recoller → 11.8 km.
    const blocks: TextBlock[] = [
      { text: 'uber',                      x: 50,  y: 50,  width: 80,  height: 30 },
      { text: '17,18 €',                   x: 50,  y: 200, width: 120, height: 40 },
      { text: '65 Route de la Libération', x: 50,  y: 650, width: 300, height: 15 },
      { text: 'Course de 11.',             x: 50,  y: 700, width: 200, height: 15 },
      { text: '8 km',                      x: 280, y: 700, width: 80,  height: 15 },
      { text: '16 Rue Charles Pathé',      x: 50,  y: 800, width: 250, height: 15 },
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.distanceKm).toBe(11.8);
  });

  it('restitches a fragmented distance with comma separator ("11," + "8 km")', () => {
    const blocks: TextBlock[] = [
      { text: 'bolt',                      x: 50,  y: 50,  width: 80,  height: 30 },
      { text: 'Gain 14,50',                x: 50,  y: 200, width: 150, height: 40 },
      { text: '12 rue de Rivoli',          x: 50,  y: 600, width: 200, height: 15 },
      { text: 'Course 11,',                x: 50,  y: 700, width: 140, height: 15 },
      { text: '8 km',                      x: 220, y: 700, width: 80,  height: 15 },
      { text: '25 rue de Vaugirard',       x: 50,  y: 800, width: 250, height: 15 },
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.distanceKm).toBe(11.8);
  });

  it('does not restitch across different rows (distance stays raw integer)', () => {
    // "Course de 11." est sur une ligne différente de "8 km" → pas de recollage.
    // Résultat : distance = 8 (valeur brute), test exprime que la garde reste locale.
    const blocks: TextBlock[] = [
      { text: 'uber',                      x: 50,  y: 50,  width: 80,  height: 30 },
      { text: 'Total 15,00',               x: 50,  y: 200, width: 150, height: 40 },
      { text: '12 rue de Rivoli',          x: 50,  y: 600, width: 200, height: 15 },
      { text: 'Course de 11.',             x: 50,  y: 680, width: 200, height: 15 },
      { text: '8 km',                      x: 280, y: 740, width: 80,  height: 15 }, // Δy > 1.5× height
      { text: '25 rue de Vaugirard',       x: 50,  y: 820, width: 250, height: 15 },
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.distanceKm).toBe(8);
  });

  it('does not restitch when previous block has no trailing digit+separator', () => {
    // Le bloc de gauche finit par "course" (pas par "NN." ou "NN,") → pas de
    // recollage. La distance reste l'entier brut.
    const blocks: TextBlock[] = [
      { text: 'uber',                      x: 50,  y: 50,  width: 80,  height: 30 },
      { text: 'Total 15,00',               x: 50,  y: 200, width: 150, height: 40 },
      { text: '12 rue de Rivoli',          x: 50,  y: 600, width: 200, height: 15 },
      { text: 'Course',                    x: 50,  y: 700, width: 100, height: 15 },
      { text: '8 km',                      x: 180, y: 700, width: 80,  height: 15 },
      { text: '25 rue de Vaugirard',       x: 50,  y: 800, width: 250, height: 15 },
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.distanceKm).toBe(8);
  });

  it('restitches when the dot was dropped by OCR ("Course de 11" + "8 km")', () => {
    // ML Kit perd parfois complètement le point décimal — le bloc de gauche
    // finit par "11" (pas de "."), et la valeur brute est "8 km". Le stitcher
    // permissif doit recoller en 11.8 car le raw int est un seul chiffre.
    const blocks: TextBlock[] = [
      { text: 'uber',                      x: 50,  y: 50,  width: 80,  height: 30 },
      { text: '17,18 €',                   x: 50,  y: 200, width: 120, height: 40 },
      { text: '65 Route de la Libération', x: 50,  y: 650, width: 300, height: 15 },
      { text: 'Course de 11',              x: 50,  y: 700, width: 180, height: 15 },
      { text: '8 km',                      x: 260, y: 700, width: 80,  height: 15 },
      { text: '16 Rue Charles Pathé',      x: 50,  y: 800, width: 250, height: 15 },
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.distanceKm).toBe(11.8);
  });

  it('intra-block restitch when dot is lost inside the same block ("Course de 11 8 km")', () => {
    // Cas où ML Kit garde tout dans un seul bloc mais perd le point décimal,
    // donnant "Course de 11 8 km". Le stitch intra-bloc doit recoller en 11.8.
    const blocks: TextBlock[] = [
      { text: 'uber',                      x: 50,  y: 50,  width: 80,  height: 30 },
      { text: '17,18 €',                   x: 50,  y: 200, width: 120, height: 40 },
      { text: '65 Route de la Libération', x: 50,  y: 650, width: 300, height: 15 },
      { text: 'Course de 11 8 km',         x: 50,  y: 700, width: 260, height: 15 },
      { text: '16 Rue Charles Pathé',      x: 50,  y: 800, width: 250, height: 15 },
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.distanceKm).toBe(11.8);
  });

  it('intra-block stitch is anchored on the matched km raw (no cross-pair)', () => {
    // Bloc "4 1 2 km" — DISTANCE_REGEX matche "2 km". L'intra-stitch cherche
    // une paire "X 2 km" — ici "1 2 km" donne 1.2. On NE DOIT PAS prendre
    // "4 1" ou "4 2" car la 2ᵉ capture doit coller au rawInt ("2").
    const blocks: TextBlock[] = [
      { text: 'uber',                      x: 50,  y: 50,  width: 80,  height: 30 },
      { text: 'Total 20,00',               x: 50,  y: 200, width: 150, height: 40 },
      { text: '12 rue de Rivoli',          x: 50,  y: 600, width: 200, height: 15 },
      { text: '10 km',                     x: 50,  y: 700, width: 80,  height: 15 },  // course
      { text: '4 1 2 km',                  x: 50,  y: 750, width: 120, height: 15 },  // pickup fragmenté
      { text: '25 rue de Vaugirard',       x: 50,  y: 800, width: 250, height: 15 },
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    // Course = 10, pickup fragmenté "1.2" reconstitué — pas un 4.1 ou 4.2 farfelu
    expect(result!.distanceKm).toBe(10);
  });

  it('does not permissively restitch for multi-digit raw ("Total 12" + "50 km")', () => {
    // Le permissif est réservé aux raw int 1 chiffre pour éviter de transformer
    // un "50 km" légitime en 12.50 à cause d'un voisin bidon à gauche.
    const blocks: TextBlock[] = [
      { text: 'uber',                      x: 50,  y: 50,  width: 80,  height: 30 },
      { text: 'Total 40,00',               x: 50,  y: 200, width: 150, height: 40 },
      { text: '12 rue de Rivoli',          x: 50,  y: 600, width: 140, height: 15 },
      { text: 'Course 12',                 x: 50,  y: 700, width: 100, height: 15 },
      { text: '50 km',                     x: 180, y: 700, width: 80,  height: 15 },
      { text: '25 rue de Vaugirard',       x: 50,  y: 800, width: 250, height: 15 },
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    // raw = "50" (length 2) → permissif ne s'applique pas, on garde 50
    expect(result!.distanceKm).toBe(50);
  });

  it('strictly sorts addresses by Y ascending (pickup always top)', () => {
    // Given intentionally out of reading order — parser must still put the
    // smallest Y first as pickup.
    const blocks = [
      makeBlock('bolt', 50, 30),
      makeBlock('15,00 €', 200, 40),
      makeBlock('8.0 km', 400, 15),
      makeBlock('25 rue de Vaugirard', 900, 15),   // destination (lower)
      makeBlock('12 rue de Rivoli', 500, 15),       // pickup (higher)
    ];
    const result = parseBlocks(blocks, 1920);
    expect(result).not.toBeNull();
    expect(result!.pickupAddress).toContain('Rivoli');
    expect(result!.destinationAddress).toContain('Vaugirard');
  });
});

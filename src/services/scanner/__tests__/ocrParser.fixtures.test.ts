/**
 * Runner TypeScript des fixtures OCR partagées (fixtures/ocr/*.json).
 *
 * Ces JSON sont le CONTRAT commun des 3 parsers (TS / Swift / Kotlin) :
 * même entrée (blocks + screenHeight), même sortie attendue. Tout fix de
 * parser commence par une fixture — voir fixtures/ocr/README.md.
 *
 * Remplace l'ancien ocrParser.test.ts (cas convertis 1:1 en JSON).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseBlocks } from '../ocrParser';
import { TextBlock } from '../types';

interface FixtureExpected {
  platform: string;
  fare: number;
  distanceKm: number;
  durationMin?: number | null;
  pickupAddressContains?: string | null;
  destinationAddressContains?: string | null;
  pickupDistanceKm?: number;
  pickupDurationMin?: number;
}

interface FixtureCase {
  name: string;
  description?: string;
  screenHeight: number;
  blocks: TextBlock[];
  expected: FixtureExpected | null;
}

const FIXTURES_DIR = path.resolve(__dirname, '../../../../fixtures/ocr');

const fixtureFiles = fs
  .readdirSync(FIXTURES_DIR)
  .filter(f => f.endsWith('.json'))
  .sort();

// Garde-fou : si le dossier disparaît ou se vide, on veut un échec bruyant,
// pas une suite verte qui ne teste rien.
test('fixture corpus is present', () => {
  expect(fixtureFiles.length).toBeGreaterThan(0);
});

for (const file of fixtureFiles) {
  const cases: FixtureCase[] = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'),
  );

  describe(`fixtures/ocr/${file}`, () => {
    for (const c of cases) {
      it(c.name, () => {
        const result = parseBlocks(c.blocks, c.screenHeight);

        if (c.expected === null) {
          expect(result).toBeNull();
          return;
        }

        expect(result).not.toBeNull();
        const exp = c.expected;
        expect(result!.platform).toBe(exp.platform);
        expect(result!.fare).toBe(exp.fare);
        expect(result!.distanceKm).toBe(exp.distanceKm);

        if ('durationMin' in exp) {
          expect(result!.durationMin).toBe(exp.durationMin);
        }
        if ('pickupAddressContains' in exp) {
          if (exp.pickupAddressContains === null) {
            expect(result!.pickupAddress).toBeUndefined();
          } else {
            expect(result!.pickupAddress).toContain(exp.pickupAddressContains);
          }
        }
        if ('destinationAddressContains' in exp) {
          if (exp.destinationAddressContains === null) {
            expect(result!.destinationAddress).toBeUndefined();
          } else {
            expect(result!.destinationAddress).toContain(exp.destinationAddressContains);
          }
        }
        if ('pickupDistanceKm' in exp) {
          expect(result!.pickupDistanceKm).toBe(exp.pickupDistanceKm);
        }
        if ('pickupDurationMin' in exp) {
          expect(result!.pickupDurationMin).toBe(exp.pickupDurationMin);
        }
      });
    }
  });
}

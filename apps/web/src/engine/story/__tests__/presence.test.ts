import VO_MANIFEST_RAW from '../../../../public/vo/manifest.json';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRESENCE_LINES, SPEAKER_META, linesFor, reinforcementLine, type PresenceTrigger } from '../presence';

const SCENE = readFileSync(resolve(__dirname, '../../scene/ContractZeroScene.tsx'), 'utf8');

const VO_MANIFEST = VO_MANIFEST_RAW as Record<string, { text: string }>;

describe('presence lines', () => {
  it('gives every line a unique id (ids become VO filenames)', () => {
    const ids = PRESENCE_LINES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names a known speaker on every line', () => {
    for (const l of PRESENCE_LINES) expect(SPEAKER_META[l.speaker]).toBeTruthy();
  });

  it('keeps every line readable as a combat subtitle', () => {
    for (const l of PRESENCE_LINES) {
      expect(l.text.trim().length).toBeGreaterThan(0);
      expect(l.text.length).toBeLessThan(160);
    }
  });

  it('has a line for every trigger the scene fires', () => {
    const fired = new Set<string>();
    for (const m of SCENE.matchAll(/say(?:Again)?\((?:[^)]*?\?\s*)?'([a-zA-Z]+)'(?:\s*:\s*'([a-zA-Z]+)')?/g)) {
      fired.add(m[1]);
      if (m[2]) fired.add(m[2]);
    }
    expect(fired.size).toBeGreaterThan(5);
    for (const t of fired) {
      expect(linesFor(t as PresenceTrigger).length, `no line for trigger "${t}"`).toBeGreaterThan(0);
    }
  });
});

describe('mission radio from the server', () => {
  it("uses a contract's own lines for a trigger and the defaults for the rest", async () => {
    const radio = { rivalFirstWord: [{ id: 'dyn-rival', speaker: 'ashen', text: 'This is the Ashen Compact.' }] }
    const own = linesFor('rivalFirstWord', radio)
    expect(own).toHaveLength(1)
    expect(own[0]).toMatchObject({ id: 'dyn-rival', speaker: 'ashen', trigger: 'rivalFirstWord' })
    expect(SPEAKER_META.ashen.name).toBe('ASHEN COMPACT')
    expect(linesFor('opBreach', radio)).toEqual(linesFor('opBreach'))
  })

  it('ignores lines from a speaker the client cannot voice, or empty ones', () => {
    const radio = { opStart: [{ id: 'x', speaker: 'stranger', text: 'hi' }, { id: 'y', speaker: 'handler', text: '  ' }] }
    expect(linesFor('opStart', radio)).toEqual(linesFor('opStart'))
  })

  it('gives every operation kind its beats, with the target speaking in each', async () => {
    const { buildOperationMission } = await import('../../fps/convoy')
    const base = { id: 't', target: 'vanguard', cargo: { resource: 'ammo' as const, units: 40 }, defense: 3, seed: 4, zone: 'DUSTLINE' as const, issuer: 'Vex Exchange' }
    for (const kind of ['raid', 'sabotage', 'recovery'] as const) {
      const beats = buildOperationMission({ ...base, kind }).objectives.flatMap((o) => o.beats ?? [])
      expect(beats, kind).toContain('opBreach')
      expect(beats, kind).toContain('rivalFirstWord')
      expect(beats, kind).toContain('opPushIn')
      for (const b of beats) expect(linesFor(b).length, `${kind}: ${b}`).toBeGreaterThan(0)
    }
  })
})

describe('radio from real state', () => {
  it('first contact, low ammunition and reinforcements each have a default line', () => {
    for (const t of ['firstContact', 'lowAmmo', 'reinforcements'] as PresenceTrigger[]) expect(linesFor(t).length, t).toBeGreaterThan(0);
  });
  it('the reinforcement line carries the real number of guards, never an invented one', () => {
    expect(reinforcementLine(1).text).toBe('One more guard coming in. Finish up.');
    expect(reinforcementLine(3).text).toBe('3 more guards coming in. Finish up.');
    expect(reinforcementLine(0).text).toContain('One more');   // never "0 more": it is only said when guards arrived
    // Counts 1-12 are pre-voiced under their own id, so the voice says the same number
    // as the subtitle; beyond that the line plays as its subtitle.
    expect(reinforcementLine(2).id).toBe('reinforce-2');
    expect(reinforcementLine(12).id).toBe('reinforce-12');
    expect(reinforcementLine(13).id).toBe('dyn-reinforce');
    for (let n = 1; n <= 12; n++) expect(VO_MANIFEST[reinforcementLine(n).id]?.text, `reinforce-${n}`).toBe(reinforcementLine(n).text);
  });
  it('the scene says each from the state that makes it true', () => {
    expect(SCENE).toMatch(/sayAgain\('lowAmmo'/);
    expect(SCENE).toMatch(/Number\.isFinite\(sim\.reserve\)/);          // only where the reserve is finite
    expect(SCENE).toMatch(/reinforced\(sim\.reinforce\(/);               // the count is what the sim spawned
    expect(SCENE).toMatch(/if \(spawned > 0\)/);                          // and nothing is said if none arrived
    expect(SCENE).toMatch(/say\('firstContact'\)/);
  });
  it('Halcyon has a voice on the channel', () => {
    expect(SPEAKER_META.halcyon.name).toBe('HALCYON DESK');
  });
});

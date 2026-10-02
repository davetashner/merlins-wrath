import { controllerTuningFor, loadGameContent, PLAYER_CONTROLLER_ID } from '@content/index';
import { describe, expect, it } from 'vitest';
import { CONTROLLER_HOT_EVENT, readControllerFile } from './controller-reload';

const FILE = 'src/content/data/controller/player.json';
const profile = loadGameContent().get('controller', PLAYER_CONTROLLER_ID);
const text = (value: unknown) => JSON.stringify(value);

describe('controller hot reload (mw-e02.3)', () => {
  it('names its dev-server event', () => {
    expect(CONTROLLER_HOT_EVENT).toBe('vesper:controller');
  });

  it('reads a saved file into the tuning the player moves with, or a class’s', () => {
    const saved = { $schema: '../controller.schema.json', ...profile, gravity: 30 };
    const reload = readControllerFile({ file: FILE, text: text(saved) });
    expect(reload).toEqual({
      ok: true,
      id: PLAYER_CONTROLLER_ID,
      tuning: { ...controllerTuningFor(profile), gravity: 30 },
    });
    const thief = readControllerFile({ file: FILE, text: text(saved) }, 'thief');
    expect(thief.ok && thief.tuning.speeds.crouch).toBe(2.6);
  });

  it('changes nothing for a file that fails validation, naming the file and field', () => {
    expect(readControllerFile({ file: FILE, text: text({ ...profile, gravity: -9.8 }) })).toEqual({
      ok: false,
      problems: [`${FILE}: gravity: Too small: expected number to be >0`],
    });
    expect(readControllerFile({ file: FILE, text: '[]' })).toEqual({
      ok: false,
      problems: [`${FILE}: (root): Invalid input: expected object, received array`],
    });
    const broken = readControllerFile({ file: FILE, text: '{ "id": ' });
    expect(broken.ok).toBe(false);
    expect(!broken.ok && broken.problems[0]).toMatch(
      /^src\/content\/data\/controller\/player\.json: invalid JSON: /,
    );
  });
});

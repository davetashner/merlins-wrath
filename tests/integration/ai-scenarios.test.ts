// mw-e11.3: the AI scenario harness's example scenario on the frozen fixture guard's content. The
// guard stands at its post in a lit hall (fixtures/ai-scenarios/guard-hall.json); the player, hidden
// behind a wall, walks across the hall in front of it through the torchlight and out behind the other
// wall. Through the harness’s senses (perception, mw-e11.5, with a stand-in awareness) the guard notices
// the player and climbs the alert ladder.
import { describe, expect, it } from 'vitest';
import { compileCreatures, controllerTuningFor, PLAYER_CONTROLLER_ID } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import { markExercised } from '@content/testing';
import {
  aiScenario,
  buildFactionTable,
  compileBehaviours,
  factionSpecFromDef,
  type ScenarioDeps,
} from '@sim/index';
import guardHall from './fixtures/ai-scenarios/guard-hall.json';

const content = loadFixtureContent();
const deps: ScenarioDeps = {
  creatures: compileCreatures(content.all('creature'), content),
  factions: buildFactionTable(content.all('faction').map(factionSpecFromDef)),
  behaviours: compileBehaviours(content.all('behaviour')),
  controller: controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID)),
};

describe('AI scenarios on the fixture guard (mw-e11.3)', () => {
  it('AC-3: the player walking through the guard’s view in light makes it Suspicious within 1.5 s', ({
    task,
  }) => {
    markExercised(task, 'behaviour', 'fixture-guard');
    markExercised(task, 'creature', 'fixture-guard');
    const scenario = aiScenario(
      {
        name: 'guard-hall',
        layout: guardHall,
        player: [{ wait: 0.5 }, { to: [11, 6] }],
        duration: 6,
      },
      deps,
    );
    scenario.during(0, 1).expect('guard1').state('Unaware'); // behind the wall
    scenario.during(0, 6).expect('guard1').enters('Suspicious', 'Unaware');
    scenario.at(1).expect('guard1').doing('patrol'); // standing its post (a one-point route)
    const result = scenario.check();

    const seen = result.timeline.find((e) => e.kind === 'sight' && e.agent === 'guard1' && e.seen);
    const suspicious = result.timeline.find((e) => e.kind === 'state' && e.to === 'suspicious');
    if (seen?.kind !== 'sight' || suspicious === undefined) throw new Error(result.report);
    expect(seen.light).toBeGreaterThan(0.4); // in the torchlight, not only the hall's ambient 0.2
    expect(suspicious.time - seen.time).toBeGreaterThan(0);
    expect(suspicious.time - seen.time).toBeLessThanOrEqual(1.5);
  });
});

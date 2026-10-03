// AI scenario harness (mw-e11.3): scripted, deterministic tests of creature behaviour over time.
export {
  parsePlayerScript,
  parseScenarioLayout,
  ScenarioLoadError,
  type PlayerStep,
  type PlayerStepInput,
  type ScenarioLayout,
  type ScenarioLayoutInput,
  type PlayerStance,
} from './layout';
export {
  aiScenario,
  AiScenario,
  formatReport,
  ScenarioFailedError,
  type ExpectationResult,
  type MomentExpectation,
  type ScenarioDeps,
  type ScenarioResult,
  type ScenarioSpec,
  type StateName,
  type TimelineEntry,
  type WindowExpectation,
} from './scenario';
export {
  perceptionSenses,
  type ScenarioSenses,
  type SensedStimulus,
  type SensesContext,
} from './senses';
export { fuzzAlertMachine, type AlertFuzzOptions, type AlertFuzzReport } from './alert-fuzz';

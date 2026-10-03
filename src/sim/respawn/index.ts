// The player's death and respawn (mw-e01.8): the death beat, the respawn-rule resolver and the
// player.died / player.respawned events.
export {
  announceRespawn,
  deathBeatProgress,
  deathBeatTicks,
  DEFAULT_DEATH_BEAT_SECONDS,
  installPlayerDeath,
  isPlayerDead,
  PlayerDeath,
  playerDeathBeatEnded,
  playerDied,
  playerRespawned,
  type PlayerDeathBeatEnded,
  type PlayerDeathOptions,
  type PlayerDeathState,
  type PlayerDied,
  type PlayerRespawned,
} from './death';
export {
  FALLBACK_RESPAWN,
  RESPAWN_MODES,
  RespawnRules,
  type RespawnContext,
  type RespawnDestination,
  type RespawnFact,
  type RespawnMode,
  type RespawnResolution,
  type RespawnRule,
} from './rules';

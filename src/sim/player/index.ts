// The player in the sim (mw-e02.23): spawn, mouse-look yaw and ActionFrame → controller wiring.
export {
  installPlayer,
  NoPlayerStartError,
  PLAYER_LOOK_SENSITIVITY,
  PLAYER_START_TAG,
  PlayerLook,
  playerLookSystem,
  playerStart,
  spawnYaw,
  wrapYaw,
  type PlayerOptions,
} from './player';

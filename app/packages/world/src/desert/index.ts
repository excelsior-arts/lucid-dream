/* @lucid/world/desert — a desert to stand a trip in.
 *
 * Sand that takes a print and slides off a crest, a sea, a sky with an hour
 * and a moon, a horizon of dunes and a range behind them, a camera that
 * follows and an orbit that takes over, keys that walk, a frame loop that
 * sleeps, a graphics budget that lowers itself, and the sound of all of it.
 * Nothing in here knows which trip it is in: the landscape arrives as
 * numbers (landscape.ts), what stands in it as landmarks, what walks on it
 * as a gait and footfalls, and what plays over it as a mix.
 *
 * It is Burning Man's engine, lifted out of that piece on 2026-10-07 with its
 * arithmetic intact -- that trip's ground-identity test holds every height to
 * the double it was -- so that the next trip starts from the desert and not
 * from the figure.
 */

export {Geography} from './landscape';
export type {DuneRidge, HorizonField, Landscape, MapPoint, Peak} from './landscape';
export {compileRidge, crestPoints, heap, ridgeRelief, duneRelief} from './layout';
export type {Compiled} from './layout';
export {HorizonDunes} from './horizon-dunes';

export {SandField, SAND_CELL} from './sand/field';
export type {SandBurst, SandContact} from './sand/field';
export {SandTerrain} from './sand/terrain';
export {SandGrains} from './sand/grains';
export {SandParticleBatch} from './sand/particle-batch';
export {SandContacts} from './sand/contacts';
export type {Footfalls} from './sand/contacts';
export {
  ATLAS_MIN, ATLAS_SIZE, ATLAS_STEP, FAR_ATLAS_MIN, FAR_ATLAS_SIZE, FAR_ATLAS_STEP,
  FAR_HEIGHT_RANGE, HEIGHT_MIN, HEIGHT_RANGE, Survey,
} from './sand/height-atlas';
export {playaSurface} from './sand/playa-surface';

export {createDesert} from './scene/desert';
export type {Landmark} from './scene/desert';
export {MountainRange} from './scene/mountains';
export {keepDiffuse185} from './scene/fresnel-186';
export {CoastalSea} from './scene/sea';
export type {SeaLight, SeaQuality} from './scene/sea';
export {SeaSky} from './scene/sea-sky';
export {WaveReadback} from './scene/wave-readback';
export {sampleSkyGradient} from './scene/sky-gradient';
export type {SkyGradient} from './scene/sky-gradient';
export {shadowAnchor} from './scene/shadow-anchor';
export {shadowStrength} from './scene/shadow-strength';

export {SmoothOrbit} from './camera/smooth-orbit';
export {FollowCamera} from './camera/follow-camera';
export type {CameraShot} from './camera/follow-camera';
export {viewportFraming} from './camera/viewport-framing';
export {WalkKeys} from './camera/walk-keys';
export type {Walking} from './camera/walk-keys';

export {FrameLoop} from './loop/frame-loop';
export {AdaptiveQuality, QUALITY, qualityMode, renderPixelRatio} from './loop/quality';
export type {QualityMode, QualityTier} from './loop/quality';

export {Walker} from './walker';
export type {Gait, Stride} from './walker';
export {moveAroundObstacles, obstacleDistance, WALKER_CLEARANCE} from './obstacles';
export type {WalkObstacle} from './obstacles';
export type {MotionState, Vec3} from './runtime/types';
export {ParticleBuffer} from './runtime/particle-buffer';
export {SurfaceSampler} from './runtime/surface-sampler';

export {DesertSound, QUIET} from './sound/desert-sound';
export type {Mix, SoundLayer, Transport} from './sound/desert-sound';
export {
  SurfPlayer, surfExposure, surfOpenness, surfApproach, shoreRise, surfSamples, surfFullAt,
  SURF_LOOP_SECONDS, EAR_HEIGHT, CREST_FADE,
} from './sound/surf';
export type {Ground, Shore, SurfExposure, SurfListener} from './sound/surf';
export {musicSource} from './sound/music-source';
export type {MusicSource} from './sound/music-source';
export {signedMusic} from './sound/signer';
export {holdAt} from './sound/hold';

export {buildStage} from './stage';
export type {StageWords} from './stage';

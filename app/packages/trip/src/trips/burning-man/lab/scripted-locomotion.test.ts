// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {ScriptedWalk} from '../experience/rehearsal';
import {Walker} from '../experience/walker';
import {DEFAULT_SCORE, sampleScore, validateScore} from '../experience/score';
import {lookPivot, lookSpan, sampleLook} from '../experience/look-around';
import {motionAt} from '../character/manual-gait';

const score = validateScore({...DEFAULT_SCORE, stage_04_look: 19,
  stage_04_look_pivot: 2.4, stage_04_look_hold: 4, stage_05_fall: 47});

describe('scripted captured look-around', () => {
  it('plays all four stepping turns and holds without travelling or moving the fall', () => {
    const route = new ScriptedWalk(score);
    const slot = lookSpan(score) / 4;
    const standing = route.sample(score.stage_04_look + 0.01).position;
    for (let i = 0; i < 4; i++) {
      const at = score.stage_04_look + i * slot;
      const turn = route.sample(at + lookPivot(score) / 2);
      expect(turn.gesture?.clip).toBe('turnleft90');
      expect(turn.gesture!.time).toBeGreaterThan(0.4);
      expect(turn.gesture!.time).toBeLessThan(0.5);
      const yaw = motionAt('turnleft90', turn.gesture!.time);
      expect(turn.facing).toBeCloseTo(-Math.PI / 2 + (i + yaw) * Math.PI / 2, 6);
      expect(turn.speed).toBe(0);
      expect(turn.position.x).toBeCloseTo(standing.x, 9);
      expect(turn.position.z).toBeCloseTo(standing.z, 9);
      const held = route.sample(at + lookPivot(score) + 1);
      expect(held.gesture?.clip).toBe('stand');
      expect(held.facing).toBeCloseTo(-Math.PI / 2 + (i + 1) * Math.PI / 2, 6);
    }
    expect(route.sample(score.stage_05_fall).gesture).toBeUndefined();
    expect(sampleScore(score.stage_05_fall, score).clip).toBe('kneefall');
  });

  it('reproduces animation time as well as heading through forward/backward seeks', () => {
    const route = new ScriptedWalk(score);
    const times = [19, 19.73, 21.4, 24, 25.4, 28.17, 40.1, 46.99];
    const poses = times.map(t => route.sample(t));
    route.sample(score.duration);
    for (let i = times.length - 1; i >= 0; i--) expect(route.sample(times[i]!)).toEqual(poses[i]);
    const sampled = route.sample(19.73);
    sampled.gesture!.time = 999;
    expect(route.sample(19.73)).toEqual(poses[1]);
  });

  it('matches live fixed steps and rehearsal at different update rates', () => {
    const route = new ScriptedWalk(score);
    for (const hz of [30, 60, 120]) {
      const walker = new Walker(() => 0); walker.reset(0, 0);
      for (let frame = 0; frame < 23 * hz; frame++) {
        const at = frame / hz, end = (frame + 1) / hz;
        walker.step(-1, 0, 1 / hz, sampleScore(at, score).mobility, score);
        walker.look(end, score, [-1, 0]);
        if (end >= 19 && frame % 10 === 0) {
          const expected = route.sample(end);
          expect(walker.state.facing).toBeCloseTo(expected.facing, 6);
          expect(walker.state.gesture?.clip).toBe(expected.gesture?.clip);
          expect(walker.state.gesture!.time).toBeCloseTo(expected.gesture!.time, 6);
        }
      }
    }
  });

  it('fits retimed score slots and omits a look with insufficient room', () => {
    for (const pivot of [0.5, 2.4, 5]) {
      const tuned = {...score, stage_04_look_pivot: pivot, stage_05_fall: 80};
      const sample = sampleLook(19 + pivot / 2, tuned, [-1, 0])!;
      expect(sample.gesture.clip).toBe('turnleft90');
      expect(sample.gesture.time).toBeCloseTo(0.466667, 5);
      expect(sampleLook(19 + pivot + 0.1, tuned, [-1, 0])?.gesture.clip).toBe('stand');
    }
    expect(sampleLook(20, {...score, stage_05_fall: 20}, [-1, 0])).toBeNull();
    expect(sampleLook(18, score, [-1, 0])).toBeNull();
  });

  it('hands control back to WASD without leaving the scripted turn attached', () => {
    const walker = new Walker(() => 0); walker.reset(0, 0);
    walker.look(20.2, score, [-1, 0]);
    const before = walker.state.facing;
    walker.step(Math.sin(before), Math.cos(before), 1 / 60, 1, score, true);
    expect(walker.state.gesture?.clip).toBe('startwalk');
    expect(walker.state.facing).toBeCloseTo(before, 8);
    expect(new ScriptedWalk(score, 'sea', true).sample(20.2).gesture).toBeUndefined();
  });
});

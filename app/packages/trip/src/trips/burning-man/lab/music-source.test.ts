// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {musicSource} from '@lucid/world/desert';
import {DEFAULT_SCORE, validateScore} from '../experience/score';

describe('the score music field', () => {
  it('accepts no music and a local audio file', () => {
    expect(musicSource('')).toEqual({kind: 'none'});
    expect(musicSource('   ')).toEqual({kind: 'none'});
    expect(musicSource('audio/song.mp3')).toEqual({kind: 'file', path: 'audio/song.mp3'});
    expect(musicSource('./sounds/take.m4a')?.kind).toBe('file');
    expect(musicSource('song.wav')?.kind).toBe('file');
  });
  it('refuses anything that is not a local audio asset', () => {
    for (const bad of [
      'https://example.com/song.mp3',
      'song.txt',
      'javascript:alert(1)',
      42,
      null,
    ])
      expect(musicSource(bad)).toBe(null);
  });
  it('lets a score carry a file path and still refuses nonsense', () => {
    expect(validateScore({...DEFAULT_SCORE, music: ''}).music).toBe('');
    expect(validateScore({...DEFAULT_SCORE, music: 'audio/song.mp3'}).music).toBe('audio/song.mp3');
    expect(() => validateScore({...DEFAULT_SCORE, music: 'https://example.com/song.mp3'})).toThrow();
  });
});

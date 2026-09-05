import {expect, test} from 'vitest';
import type {Order} from '../../shell/console';
import {near} from './near';

const ALL: Order[] = [
  {name: 'ai_models_start', about: '', app: ''},
  {name: 'ai_models_stop', about: '', app: ''},
  {name: 'lamp_dim', about: '', app: ''},
  {name: 'server_restart', about: '', app: ''},
  {name: 'session_new', about: '', app: ''},
];

test('nothing is offered until a slash is typed', () => {
  expect(near('lamp', ALL)).toEqual([]);
});

test('the verb is what somebody types, and the verb is last', () => {
  /* Subject-first names — lamp_dim, ai_models_start — are what makes the
     list fall into families when it is read down. Under a prefix match that
     costs the other half: somebody wanting to start something types "start"
     and finds nothing at all, which looks exactly like the command not
     existing. */
  expect(near('/start', ALL).map((o) => o.name)).toEqual(['ai_models_start']);
  expect(near('/new', ALL).map((o) => o.name)).toEqual(['session_new']);
});

test('and a name typed from the beginning still comes first', () => {
  expect(near('/s', ALL).map((o) => o.name))
    .toEqual(['server_restart', 'session_new', 'ai_models_start', 'ai_models_stop']);
});

test('a word nothing answers to offers nothing', () => {
  expect(near('/tidy', ALL)).toEqual([]);
});

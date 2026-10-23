/* Hold an AudioParam where it is at a time, so a ramp can start from there.
 *
 * `cancelAndHoldAtTime` is the one call for it, and Firefox has none (157
 * still): a press that faded a voice there threw "cancelAndHoldAtTime is not
 * a function" on every voice. Where it is missing, the value now is read and
 * set at that time after the schedule is cleared -- the same hold for a call
 * made at the current time, which is how every caller here uses it. */
export function holdAt(param: AudioParam, at: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(at);
    return;
  }
  const value = param.value;
  param.cancelScheduledValues(at);
  param.setValueAtTime(value, at);
}

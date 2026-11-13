import { evaluateExpression as ev } from './expression';

describe('evaluateExpression', () => {
  it.each([
    ['20', 20],
    ['-4.5', -4.5],
    ['20+5', 25],
    ['100/4', 25],
    ['2*(3+4)', 14],
    ['10 - 2 * 3', 4],
    ['1,5', 1.5],
    ['.5', 0.5],
  ])('%s = %d', (input, expected) => expect(ev(input)).toBeCloseTo(expected));

  it.each(['', 'abc', '2+', '(1', '1/0', 'alert(1)', '2**3'])('rejects %s', (input) => expect(ev(input)).toBeNull());
});

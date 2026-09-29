import { describe, expect, it } from 'vitest';
import { frameCount, parsePastedParts, stepsAt } from '../src/logic/shipment.js';

describe('shipment form', () => {
  it('reads the production plan as pasted from the spreadsheet, merged model cells included', () => {
    // As the owner pasted it (29 Sep 2026): columns split by runs of spaces, empty plan cells.
    const text = [
      '        Part size            Production Plan    ',
      'Model    Item Ref.    L (mm)    W(mm)    H(mm)    04/Oct    05/Oct',
      '77S85H    BN69-25994A Cushion Side    500    152    200        ',
      '    BN69-25993A Cushion Top    1872    152    350        ',
      '55QN80H    BN69-28085A Cushion Top    1335    110    400    1750    1750',
      '    BN69-28085A Cushion Bot    1335    110    400    1750    1750',
      '32F6000    BN69-26767A Cushion Top    788    102    185    4200    800',
    ].join('\n');
    expect(parsePastedParts(text)).toEqual([
      { name: '77S85H BN69-25994A Cushion Side', length: 500, width: 152, height: 200, quantity: 0, mayTilt: true },
      { name: '77S85H BN69-25993A Cushion Top', length: 1872, width: 152, height: 350, quantity: 0, mayTilt: true },
      { name: '55QN80H BN69-28085A Cushion Top', length: 1335, width: 110, height: 400, quantity: 1750, mayTilt: true },
      { name: '55QN80H BN69-28085A Cushion Bot', length: 1335, width: 110, height: 400, quantity: 1750, mayTilt: true },
      { name: '32F6000 BN69-26767A Cushion Top', length: 788, width: 102, height: 185, quantity: 4200, mayTilt: true },
    ]);
  });

  it('reads tab-separated cells and thousands separators', () => {
    expect(parsePastedParts('Carton A\t600\t400\t400\t"1,200"'.replace(/"/g, ''))).toEqual([{ name: 'Carton A', length: 600, width: 400, height: 400, quantity: 1200, mayTilt: true }]);
  });

  it('plays containers together or one after another', () => {
    const steps = [3, 5];
    expect(frameCount(steps, 'together')).toBe(5);
    expect(frameCount(steps, 'in-turn')).toBe(8);
    expect(stepsAt(steps, 0, 'together')).toEqual([0, 0]);
    expect(stepsAt(steps, 3, 'together')).toEqual([null, 3]);
    expect(stepsAt(steps, 2, 'in-turn')).toEqual([2, 0]);
    expect(stepsAt(steps, 4, 'in-turn')).toEqual([null, 1]);
    expect(stepsAt(steps, 8, 'in-turn')).toEqual([null, null]);
    expect(stepsAt(steps, null, 'in-turn')).toEqual([null, null]);
  });
});

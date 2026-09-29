import { describe, expect, it } from 'vitest';
import { frameCount, parsePastedParts, parsePastedPlan, rowsForColumn, stepsAt } from '../src/logic/shipment.js';

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

  it('keeps empty plan cells in place: each quantity stays under its own day', () => {
    // The six-day plan as the owner pasted it (29 Sep 2026): tabs became four spaces each.
    const text = [
      '        Part size            Production Plan                    ',
      'Model    Item Ref.    L (mm)    W(mm)    H(mm)    04/Oct    05/Oct    06/Oct    07/Oct    08/Oct    09/Oct',
      '77S85H    BN69-25994A Cushion Side    500    152    200                1400    1400    1200',
      '    BN69-25993A Cushion Top    1872    152    350                700    700    600',
      '    BN69-25993A Cushion Bot    1872    152    350                700    700    600',
      '55QN80H    BN69-28085A Cushion Top    1335    110    400    1750    1750    1750    1750        ',
      '    BN69-28085A Cushion Bot    1335    110    400    1750    1750    1750    1750        ',
      '32F6000    BN69-26767A Cushion Top    788    102    185    4200    800                ',
      '    BN69-26767A Cushion Bot    788    102    185    4200    800                ',
    ].join('\n');
    const plan = parsePastedPlan(text);
    expect(plan.columns).toEqual(['04/Oct', '05/Oct', '06/Oct', '07/Oct', '08/Oct', '09/Oct']);
    expect(plan.rows.map((r) => [r.name, r.plan])).toEqual([
      ['77S85H BN69-25994A Cushion Side', [0, 0, 0, 1400, 1400, 1200]],
      ['77S85H BN69-25993A Cushion Top', [0, 0, 0, 700, 700, 600]],
      ['77S85H BN69-25993A Cushion Bot', [0, 0, 0, 700, 700, 600]],
      ['55QN80H BN69-28085A Cushion Top', [1750, 1750, 1750, 1750, 0, 0]],
      ['55QN80H BN69-28085A Cushion Bot', [1750, 1750, 1750, 1750, 0, 0]],
      ['32F6000 BN69-26767A Cushion Top', [4200, 800, 0, 0, 0, 0]],
      ['32F6000 BN69-26767A Cushion Bot', [4200, 800, 0, 0, 0, 0]],
    ]);
    expect(rowsForColumn(plan.rows, 3).map((r) => r.quantity)).toEqual([1400, 700, 700, 1750, 1750, 0, 0]);
    // The same plan copied straight from the spreadsheet (tabs, empty cells between them).
    const tabbed = parsePastedPlan('Model\tItem\tL\tW\tH\t04/Oct\t05/Oct\n77S85H\tSide\t500\t152\t200\t\t1400');
    expect(tabbed.columns).toEqual(['04/Oct', '05/Oct']);
    expect(tabbed.rows[0]!.plan).toEqual([0, 1400]);
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

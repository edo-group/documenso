import { describe, expect, it } from 'vitest';

import { getRecipientIdAssignments } from './recipients';

describe('getRecipientIdAssignments', () => {
  it('gives a new recipient the id it was saved under', () => {
    const local = [{ formId: 'a' }];
    const saved = [{ id: 12, clientId: 'a' }];

    expect(getRecipientIdAssignments(local, saved)).toEqual([{ index: 0, id: 12 }]);
  });

  it('keeps two of the same person apart', () => {
    // The same email can appear on an envelope twice on purpose, so the local
    // id is the only thing that says which row is which.
    const local = [{ formId: 'a' }, { formId: 'b' }];
    const saved = [
      { id: 20, clientId: 'b' },
      { id: 21, clientId: 'a' },
    ];

    expect(getRecipientIdAssignments(local, saved)).toEqual([
      { index: 1, id: 20 },
      { index: 0, id: 21 },
    ]);
  });

  it('leaves a recipient that already has an id alone', () => {
    const local = [{ formId: 'a', id: 5 }];
    const saved = [{ id: 5, clientId: 'a' }];

    expect(getRecipientIdAssignments(local, saved)).toEqual([]);
  });

  it('ignores saved recipients it cannot place', () => {
    // A recipient created elsewhere comes back with no local id, and a row the
    // editor has since removed no longer has anywhere to put one.
    const local = [{ formId: 'a' }];

    expect(getRecipientIdAssignments(local, [{ id: 30, clientId: null }])).toEqual([]);
    expect(getRecipientIdAssignments(local, [{ id: 30 }])).toEqual([]);
    expect(getRecipientIdAssignments(local, [{ id: 30, clientId: 'gone' }])).toEqual([]);
  });

  it('assigns nothing when there is nothing to assign', () => {
    expect(getRecipientIdAssignments([], [])).toEqual([]);
  });
});
